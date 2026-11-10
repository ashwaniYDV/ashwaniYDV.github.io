/**
 * Parse and analyse pg_stat_statements exports (CSV with a header, or a JSON array).
 *
 * Column names follow PostgreSQL 13+ (total_exec_time, mean_exec_time, ...);
 * the PostgreSQL 12 and older names (total_time, mean_time, ...) are accepted too.
 * Pure functions, no React, so they can be unit-tested with Node.
 */

export const BLOCK_BYTES = 8192;

const COLUMNS = "queryid, calls, rows";

/** Copyable SQL for the chosen output format and server version. */
export function exportSql({ format = "csv", legacy = false, limit = 200 } = {}) {
  const t = legacy
    ? "total_time AS total_exec_time, mean_time AS mean_exec_time, stddev_time AS stddev_exec_time,\n       min_time AS min_exec_time, max_time AS max_exec_time"
    : "total_exec_time, mean_exec_time, stddev_exec_time, min_exec_time, max_exec_time";
  const select =
    `SELECT ${COLUMNS}, ${t},\n` +
    "       shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written,\n" +
    "       temp_blks_read, temp_blks_written,\n" +
    "       pg_get_userbyid(userid) AS username,\n" +
    "       (SELECT datname FROM pg_database d WHERE d.oid = s.dbid) AS dbname,\n" +
    "       query\n" +
    "FROM pg_stat_statements s\n" +
    `ORDER BY ${legacy ? "total_time" : "total_exec_time"} DESC\n` +
    `LIMIT ${limit}`;

  if (format === "json") {
    return (
      "-- Unaligned, tuples only, so the output is plain JSON:\n" +
      "\\pset format unaligned\n\\pset tuples_only on\n" +
      `\\o statements.json\nSELECT json_agg(x) FROM (\n${select}\n) x;\n\\o`
    );
  }
  // \copy is a psql meta-command and must be written on one line.
  const oneLine = select.replace(/\s*\n\s*/g, " ");
  return `\\copy (${oneLine}) TO 'statements.csv' WITH (FORMAT csv, HEADER)`;
}

// ---------- CSV / JSON input ----------

/** RFC 4180-ish CSV: quoted fields, "" escapes, newlines inside quotes. */
export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Strip psql's aligned-output decorations around a JSON value ("+" wraps, header, row count). */
function extractJson(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const continued = lines.filter((l) => /\s\+\s*$/.test(l)).length;
  const cleaned = continued > 0 ? lines.map((l) => l.replace(/\s\+\s*$/, "")).join("\n") : lines.join("\n");
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  return start === -1 || end < start ? null : cleaned.slice(start, end + 1);
}

/** Canonical field <- accepted source column names (lower-case). */
const ALIASES = {
  queryid: ["queryid", "query_id"],
  query: ["query", "query_text"],
  calls: ["calls"],
  total: ["total_exec_time", "total_time"],
  mean: ["mean_exec_time", "mean_time"],
  stddev: ["stddev_exec_time", "stddev_time"],
  min: ["min_exec_time", "min_time"],
  max: ["max_exec_time", "max_time"],
  rows: ["rows"],
  sharedHit: ["shared_blks_hit"],
  sharedRead: ["shared_blks_read"],
  sharedDirtied: ["shared_blks_dirtied"],
  sharedWritten: ["shared_blks_written"],
  tempRead: ["temp_blks_read"],
  tempWritten: ["temp_blks_written"],
  user: ["username", "usename", "rolname", "user", "userid"],
  db: ["dbname", "datname", "database", "dbid"],
};

const NUMERIC = ["calls", "total", "mean", "stddev", "min", "max", "rows", "sharedHit", "sharedRead", "sharedDirtied", "sharedWritten", "tempRead", "tempWritten"];

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

function normalise(record) {
  const lower = {};
  for (const [k, v] of Object.entries(record)) lower[k.trim().toLowerCase()] = v;
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const name = names.find((n) => lower[n] !== undefined && lower[n] !== null);
    if (name !== undefined) out[field] = lower[name];
  }
  for (const f of NUMERIC) out[f] = toNumber(out[f]);
  out.query = out.query === undefined ? "" : String(out.query);
  if (out.queryid !== undefined) out.queryid = String(out.queryid);
  if (out.user !== undefined) out.user = String(out.user);
  if (out.db !== undefined) out.db = String(out.db);
  return out;
}

function detectDelimiter(firstLine) {
  const counts = [",", "\t", "|", ";"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * Parse pasted text. Returns { error } or { rows, legacy, columns, missing }.
 * `rows` are analysed statements (see analyse()).
 */
export function parseStatements(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { error: "empty" };

  let records;
  let columns;
  // Plain JSON, or psql aligned output: a one-column header, a dashed rule, then the JSON.
  if (/^[[{]/.test(trimmed) || /^[^\n,|]+\n\s*-+\s*\n\s*[[{]/.test(trimmed)) {
    const json = extractJson(trimmed);
    if (!json) return { error: "No JSON array found." };
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return { error: `Invalid JSON: ${e.message}` };
    }
    records = Array.isArray(data) ? data : [data];
    if (!records.length || typeof records[0] !== "object" || records[0] === null) {
      return { error: "Expected a JSON array of objects (one per statement)." };
    }
    columns = Object.keys(records[0]);
  } else {
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    const table = parseCsv(trimmed, detectDelimiter(firstLine));
    if (table.length < 2) return { error: "Expected a header row and at least one data row." };
    columns = table[0].map((c) => c.trim());
    records = table.slice(1).map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])));
  }

  const lowerCols = columns.map((c) => c.toLowerCase());
  const has = (field) => ALIASES[field].some((n) => lowerCols.includes(n));
  const missing = ["calls", "total"].filter((f) => !has(f));
  if (missing.length) {
    return {
      error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing
        .map((f) => ALIASES[f].join(" or "))
        .join(", ")}. Use the export query above.`,
    };
  }
  const legacy = lowerCols.includes("total_time") && !lowerCols.includes("total_exec_time");
  const rows = analyse(records.map(normalise));
  return { rows, legacy, columns, optional: { buffers: has("sharedHit"), temp: has("tempWritten"), stddev: has("stddev"), rows: has("rows") } };
}

// ---------- analysis ----------

export const THRESHOLDS = {
  highMeanMs: 100,
  veryHighMeanMs: 1000,
  lowHitRatio: 0.9,
  minBlocksForRatio: 1000,
  tempSpillBlocks: 1280, // 10 MB
  nPlusOneCalls: 10000,
  nPlusOneMeanMs: 1,
  stddevFactor: 2,
};

const fmtCount = (n) => Math.round(n).toLocaleString("en-US");

export function fmtBytes(blocks) {
  const bytes = blocks * BLOCK_BYTES;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
  return `${Math.round(bytes / 1024)} kB`;
}

/** Derived fields and flags for each statement. */
export function analyse(list) {
  const totalTime = list.reduce((s, r) => s + (r.total ?? 0), 0);
  return list.map((r, index) => {
    const calls = r.calls ?? 0;
    const total = r.total ?? 0;
    const mean = r.mean ?? (calls > 0 ? total / calls : 0);
    const hit = r.sharedHit ?? 0;
    const read = r.sharedRead ?? 0;
    const row = {
      ...r,
      id: index,
      calls,
      total,
      mean,
      pct: totalTime > 0 ? total / totalTime : 0,
      hitRatio: hit + read > 0 ? hit / (hit + read) : undefined,
      rowsPerCall: r.rows !== undefined && calls > 0 ? r.rows / calls : undefined,
      tempWritten: r.tempWritten ?? 0,
    };
    row.flags = flagsFor(row);
    return row;
  });
}

export function flagsFor(r) {
  const T = THRESHOLDS;
  const flags = [];
  const add = (id, severity, label, detail) => flags.push({ id, severity, label, detail });

  if (r.tempWritten >= T.tempSpillBlocks) {
    add(
      "temp",
      r.tempWritten >= T.tempSpillBlocks * 100 ? "high" : "medium",
      "Temp spill",
      `Wrote ${fmtBytes(r.tempWritten)} of temp files (${fmtBytes(r.tempWritten / Math.max(r.calls, 1))} per call). ` +
        "Sorts, hashes or aggregates did not fit in work_mem. Run EXPLAIN (ANALYZE, BUFFERS) to find the spilling node.",
    );
  }
  const blocks = (r.sharedHit ?? 0) + (r.sharedRead ?? 0);
  if (r.hitRatio !== undefined && blocks >= T.minBlocksForRatio && r.hitRatio < T.lowHitRatio) {
    add(
      "hit",
      r.hitRatio < 0.5 ? "high" : "medium",
      "Low cache hit ratio",
      `Only ${(r.hitRatio * 100).toFixed(1)}% of ${fmtCount(blocks)} shared blocks were found in shared_buffers; ` +
        `${fmtBytes(r.sharedRead ?? 0)} came from the OS cache or disk. Look for large scans that an index could avoid.`,
    );
  }
  if (r.mean >= T.highMeanMs) {
    add(
      "mean",
      r.mean >= T.veryHighMeanMs ? "high" : "medium",
      "High mean time",
      `Each call takes ${r.mean.toFixed(r.mean >= 100 ? 0 : 1)} ms on average. EXPLAIN (ANALYZE, BUFFERS) one execution with typical parameters.`,
    );
  }
  if (r.calls >= T.nPlusOneCalls && r.mean < T.nPlusOneMeanMs) {
    add(
      "n1",
      r.pct >= 0.05 ? "medium" : "low",
      "N+1 candidate",
      `${fmtCount(r.calls)} calls at ${(r.mean * 1000).toFixed(0)} µs each. Many tiny calls often mean a loop in the application ` +
        "issuing one query per item; batching (IN / ANY($1) / a join) saves round trips.",
    );
  }
  if (r.stddev !== undefined && r.calls >= 10 && r.mean >= 1 && r.stddev > T.stddevFactor * r.mean) {
    add(
      "stddev",
      "low",
      "Unstable timing",
      `Standard deviation ${r.stddev.toFixed(1)} ms is ${(r.stddev / r.mean).toFixed(1)}× the mean` +
        (r.max !== undefined ? ` (max ${r.max.toFixed(0)} ms)` : "") +
        ". Some parameter values, plan changes, lock waits or cold caches make a few calls much slower.",
    );
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Sortable columns: key -> value getter. */
export const SORTERS = {
  total: (r) => r.total,
  pct: (r) => r.pct,
  mean: (r) => r.mean,
  calls: (r) => r.calls,
  rows: (r) => r.rows ?? -1,
  sharedHit: (r) => r.sharedHit ?? -1,
  sharedRead: (r) => r.sharedRead ?? -1,
  hitRatio: (r) => (r.hitRatio === undefined ? 2 : r.hitRatio),
  tempWritten: (r) => r.tempWritten,
  flags: (r) => r.flags.reduce((s, f) => s + { high: 100, medium: 10, low: 1 }[f.severity], 0),
  query: (r) => r.query.toLowerCase(),
};

export function sortRows(rows, key, dir = "desc") {
  const get = SORTERS[key] ?? SORTERS.total;
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return a.id - b.id;
  });
}

/** Rows whose query text, queryid, user or db contain `needle`; `flag` limits to rows with that flag id. */
export function filterRows(rows, needle, flag) {
  const n = needle.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!flag || r.flags.some((f) => f.id === flag)) &&
      (!n || [r.query, r.queryid, r.user, r.db].some((v) => v && v.toLowerCase().includes(n))),
  );
}
