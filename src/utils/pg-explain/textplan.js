/**
 * Convert PostgreSQL text-format EXPLAIN output into the object shape that
 * `EXPLAIN (FORMAT JSON)` produces, so the rest of the analyser can treat
 * both formats the same way.
 *
 * Handles plain EXPLAIN and EXPLAIN ANALYZE, with or without BUFFERS,
 * VERBOSE, SETTINGS, WAL and TIMING OFF; psql's "QUERY PLAN" header, dashed
 * rule and "(N rows)" footer; per-line quoted exports; InitPlan / SubPlan /
 * CTE headers; parallel worker lines; and the summary section (Planning,
 * Planning Time, Execution Time, Triggers, JIT, Settings).
 *
 * Nesting follows the indentation of the "->" markers, exactly as
 * explain.c writes it: a node's properties sit two columns right of its
 * name, and so do the "->" markers of its children.
 */

// Trailing "(cost=...)", "(actual ...)" and "(never executed)" groups of a node line.
const PAREN_RE = /\s*\((cost=[^)]*|actual\b[^)]*|never executed)\)/g;
const PROPERTY_RE = /^([A-Za-z][A-Za-z0-9 /_-]*?):(?:\s+(.*))?$/;
const SUBPLAN_RE = /^(?:(InitPlan|SubPlan)\s+\d+\b.*|CTE\s+\S+)$/;

const AGG_STRATEGY = { HashAggregate: "Hashed", GroupAggregate: "Sorted", MixedAggregate: "Mixed", Aggregate: "Plain" };
const JOIN_RE = /^(Nested Loop|Hash|Merge)(?: (Left|Right|Full|Semi|Anti|Right Semi|Right Anti))? Join$/;
const MEMBER_PARENTS = new Set(["Append", "Merge Append", "BitmapAnd", "BitmapOr"]);
const ALIAS_ONLY_SCANS = new Set(["Subquery Scan", "Values Scan", "Table Function Scan", "Named Tuplestore Scan"]);

const toNum = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Plain number, boolean or the string itself. */
function scalar(value) {
  if (value === undefined) return "";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

/** Split "a, f(b, c), d" on top-level commas (ignores commas inside brackets and quotes). */
export function splitList(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last || out.length) out.push(last);
  return out;
}

/** Split on spaces outside double quotes. */
function tokens(s) {
  return s.match(/(?:"(?:[^"]|"")*"|[^\s"])+/g) ?? [];
}

const unquote = (ident) => (/^".*"$/.test(ident) ? ident.slice(1, -1).replace(/""/g, '"') : ident);

/** "public.orders" -> { schema: "public", name: "orders" } (dots inside quotes are kept). */
function qualified(ident) {
  const parts = ident.match(/(?:"(?:[^"]|"")*"|[^."])+/g) ?? [ident];
  const name = unquote(parts[parts.length - 1]);
  return parts.length > 1 ? { schema: unquote(parts[parts.length - 2]), name } : { name };
}

/** Fill Node Type and friends from the node's display name, e.g. "Parallel Index Scan Backward using i on t x". */
function parseNodeName(name, raw) {
  let rest = name.trim();
  raw["Parallel Aware"] = false;
  if (rest.startsWith("Parallel ")) {
    raw["Parallel Aware"] = true;
    rest = rest.slice(9);
  }
  if (rest.startsWith("Async ")) {
    raw["Async Capable"] = true;
    rest = rest.slice(6);
  }

  let target = null;
  let index = null;
  const on = rest.indexOf(" on ");
  if (on >= 0) {
    target = rest.slice(on + 4).trim();
    rest = rest.slice(0, on);
  }
  const using = rest.indexOf(" using ");
  if (using >= 0) {
    index = unquote(rest.slice(using + 7).trim());
    rest = rest.slice(0, using);
  }
  if (/ Backward$/.test(rest)) {
    raw["Scan Direction"] = "Backward";
    rest = rest.slice(0, -9);
  } else if (index) {
    raw["Scan Direction"] = "Forward";
  }

  let type = rest;
  const partial = type.match(/^(Partial|Finalize) ((?:Hash|Group|Mixed)?Aggregate)$/);
  if (partial) type = partial[2];

  let m;
  if (AGG_STRATEGY[type]) {
    raw["Node Type"] = "Aggregate";
    raw.Strategy = AGG_STRATEGY[type];
    raw["Partial Mode"] = partial ? partial[1] : "Simple";
  } else if ((m = type.match(JOIN_RE))) {
    raw["Node Type"] = m[1] === "Nested Loop" ? "Nested Loop" : `${m[1]} Join`;
    raw["Join Type"] = m[2] ?? "Inner";
  } else if (type === "Nested Loop") {
    raw["Node Type"] = "Nested Loop";
    raw["Join Type"] = "Inner";
  } else if ((m = type.match(/^(Hash)?SetOp(?: (Intersect|Except)( All)?)?$/))) {
    raw["Node Type"] = "SetOp";
    raw.Strategy = m[1] ? "Hashed" : "Sorted";
    if (m[2]) raw.Command = `${m[2]}${m[3] ?? ""}`;
  } else if (/^(Insert|Update|Delete|Merge)$/.test(type) && target) {
    raw["Node Type"] = "ModifyTable";
    raw.Operation = type;
  } else {
    raw["Node Type"] = type;
  }

  if (index) raw["Index Name"] = index;
  if (!target) return;
  const nodeType = raw["Node Type"];
  if (nodeType === "Bitmap Index Scan") {
    raw["Index Name"] = unquote(target);
    return;
  }
  const [first = "", alias] = tokens(target);
  const ident = qualified(first);
  if (nodeType === "CTE Scan" || nodeType === "WorkTable Scan") {
    raw["CTE Name"] = ident.name;
  } else if (nodeType === "Function Scan") {
    raw["Function Name"] = ident.name;
    if (ident.schema) raw.Schema = ident.schema;
  } else if (!ALIAS_ONLY_SCANS.has(nodeType)) {
    raw["Relation Name"] = ident.name;
    if (ident.schema) raw.Schema = ident.schema;
  }
  raw.Alias = alias ? unquote(alias) : ident.name;
}

/** "(cost=1.00..2.50 rows=10 width=4)" / "(actual time=0.1..0.2 rows=10 loops=1)" / "(never executed)". */
function parseParens(group, raw) {
  if (group === "never executed") {
    Object.assign(raw, { "Actual Startup Time": 0, "Actual Total Time": 0, "Actual Rows": 0, "Actual Loops": 0 });
    return;
  }
  if (group.startsWith("cost=")) {
    const m = group.match(/cost=([\d.]+)\.\.([\d.]+)/);
    if (m) {
      raw["Startup Cost"] = toNum(m[1]);
      raw["Total Cost"] = toNum(m[2]);
    }
    const rows = group.match(/rows=([\d.]+)/);
    const width = group.match(/width=(\d+)/);
    if (rows) raw["Plan Rows"] = toNum(rows[1]);
    if (width) raw["Plan Width"] = toNum(width[1]);
    return;
  }
  parseActual(group, raw);
}

function parseActual(s, raw) {
  if (/never executed/.test(s)) {
    parseParens("never executed", raw);
    return;
  }
  const time = s.match(/time=([\d.]+)\.\.([\d.]+)/);
  const rows = s.match(/rows=([\d.]+)/);
  const loops = s.match(/loops=([\d.]+)/);
  if (time) {
    raw["Actual Startup Time"] = toNum(time[1]);
    raw["Actual Total Time"] = toNum(time[2]);
  }
  if (rows) raw["Actual Rows"] = toNum(rows[1]);
  if (loops) raw["Actual Loops"] = toNum(loops[1]);
}

/** "shared hit=1 read=2 dirtied=3 written=4, local hit=5, temp read=6 written=7". */
function parseBuffers(value, raw) {
  for (const part of value.split(",")) {
    const [kind, ...pairs] = part.trim().split(/\s+/);
    const Kind = kind ? kind[0].toUpperCase() + kind.slice(1) : "";
    if (!["Shared", "Local", "Temp"].includes(Kind)) continue;
    for (const pair of pairs) {
      const [op, n] = pair.split("=");
      if (!op || n === undefined) continue;
      raw[`${Kind} ${op[0].toUpperCase()}${op.slice(1)} Blocks`] = toNum(n) ?? 0;
    }
  }
}

/** PG 16+: "shared read=1.2 write=0.3, temp read=..."; older: "read=1.2 write=0.3". */
function parseIoTimings(value, raw) {
  for (const part of value.split(",")) {
    const words = part.trim().split(/\s+/);
    let prefix = "";
    if (["shared", "local", "temp"].includes(words[0])) {
      prefix = `${words[0][0].toUpperCase()}${words[0].slice(1)} `;
      words.shift();
    }
    for (const pair of words) {
      const [op, n] = pair.split("=");
      if (op === "read" || op === "write") raw[`${prefix}I/O ${op === "read" ? "Read" : "Write"} Time`] = toNum(n) ?? 0;
    }
  }
}

/** "Buckets: 1024 (originally 512)  Batches: 2  Memory Usage: 9kB" -> [["Buckets", "1024 (originally 512)"], ...]. */
function pairs(s) {
  return s
    .split(/\s{2,}/)
    .map((p) => p.match(/^([^:]+):\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1].trim(), m[2].trim()]);
}

const kB = (v) => toNum(String(v).replace(/kB$/, ""));

function parseProperty(s, raw) {
  const m = s.match(PROPERTY_RE);
  if (!m) {
    (raw.Details ??= []).push(s);
    return;
  }
  const key = m[1];
  const value = (m[2] ?? "").trim();
  switch (key) {
    case "Buffers":
      parseBuffers(value, raw);
      return;
    case "I/O Timings":
      parseIoTimings(value, raw);
      return;
    case "WAL":
      for (const pair of value.split(/\s+/)) {
        const [k, n] = pair.split("=");
        const name = { records: "WAL Records", fpi: "WAL FPI", bytes: "WAL Bytes", buffers: "WAL Buffers Full" }[k];
        if (name) raw[name] = toNum(n) ?? 0;
      }
      return;
    case "Sort Method": {
      const sm = value.match(/^(.*?)\s{2,}(Memory|Disk):\s*(\d+)kB/);
      if (sm) {
        raw["Sort Method"] = sm[1];
        raw["Sort Space Type"] = sm[2];
        raw["Sort Space Used"] = toNum(sm[3]);
      } else raw["Sort Method"] = value;
      return;
    }
    case "Buckets":
      for (const [k, v] of pairs(s)) {
        const n = v.match(/^(\d+)(?: \(originally (\d+)\))?/);
        if (k === "Buckets" && n) {
          raw["Hash Buckets"] = toNum(n[1]);
          raw["Original Hash Buckets"] = toNum(n[2] ?? n[1]);
        } else if (k === "Batches" && n) {
          raw["Hash Batches"] = toNum(n[1]);
          raw["Original Hash Batches"] = toNum(n[2] ?? n[1]);
        } else if (k === "Memory Usage") raw["Peak Memory Usage"] = kB(v);
        else raw[k] = scalar(v);
      }
      return;
    case "Batches": // HashAggregate (PG 13+)
      for (const [k, v] of pairs(s)) {
        if (k === "Batches") raw["HashAgg Batches"] = toNum(v);
        else if (k === "Memory Usage") raw["Peak Memory Usage"] = kB(v);
        else if (k === "Disk Usage") raw["Disk Usage"] = kB(v);
        else raw[k] = scalar(v);
      }
      return;
    case "Hits": // Memoize
      for (const [k, v] of pairs(s)) {
        if (k === "Memory Usage") raw["Peak Memory Usage"] = kB(v);
        else raw[`Cache ${k}`] = toNum(v) ?? v;
      }
      return;
    case "Heap Blocks":
      for (const pair of value.split(/\s+/)) {
        const [k, n] = pair.split("=");
        if (k === "exact") raw["Exact Heap Blocks"] = toNum(n) ?? 0;
        else if (k === "lossy") raw["Lossy Heap Blocks"] = toNum(n) ?? 0;
      }
      return;
    case "Output":
    case "Sort Key":
    case "Presorted Key":
    case "Group Key":
    case "Hash Key":
      raw[key] = splitList(value);
      return;
    default:
      raw[key] = scalar(value);
  }
}

/** "work_mem = '64MB', random_page_cost = '1.1'" -> { work_mem: "64MB", ... }. */
function parseSettings(value) {
  const out = {};
  for (const item of splitList(value)) {
    const m = item.match(/^([\w.]+)\s*=\s*'?(.*?)'?$/);
    if (m) out[m[1]] = m[2].replace(/''/g, "'");
  }
  return out;
}

function parseJitLine(s, jit) {
  const m = s.match(PROPERTY_RE);
  if (!m) return;
  const [, key, value = ""] = m;
  if (key === "Functions") jit.Functions = toNum(value);
  else if (key === "Options") {
    jit.Options = {};
    for (const opt of value.split(",")) {
      const [k, v] = opt.trim().split(/\s+/);
      if (k) jit.Options[k] = v === "true";
    }
  } else if (key === "Timing") {
    jit.Timing = {};
    for (const t of value.matchAll(/(\w+) ([\d.]+) ms/g)) {
      if (t[1] !== "Deform") jit.Timing[t[1]] = toNum(t[2]);
    }
  } else jit[key] = scalar(value);
}

function parseSummaryLine(s, top) {
  const ms = (v) => toNum(v.replace(/\s*ms$/, ""));
  let m;
  if ((m = s.match(/^Planning Time:\s*(.*)$/))) top["Planning Time"] = ms(m[1]);
  else if ((m = s.match(/^Execution Time:\s*(.*)$/))) top["Execution Time"] = ms(m[1]);
  else if ((m = s.match(/^Settings:\s*(.*)$/))) top.Settings = parseSettings(m[1]);
  else if ((m = s.match(/^Trigger (.+?):\s*time=([\d.]+)\s+calls=(\d+)/))) {
    const name = m[1].replace(/^for constraint /, "");
    const trig = { "Trigger Name": name, Time: toNum(m[2]), Calls: toNum(m[3]) };
    const on = name.match(/^(.*) on (\S+)$/);
    if (on) Object.assign(trig, { "Trigger Name": on[1], Relation: on[2] });
    if (/^for constraint /.test(m[1])) trig["Constraint Name"] = trig["Trigger Name"];
    top.Triggers.push(trig);
  } else if ((m = s.match(/^Serialization:\s*(.*)$/))) {
    const ser = {};
    for (const pair of m[1].split(/\s+/)) {
      const [k, v] = pair.split("=");
      if (k === "time") ser.Time = toNum(v.replace(/ms$/, ""));
      else if (k === "output") ser["Output Volume"] = kB(v);
      else if (k === "format") ser.Format = v;
    }
    top.Serialization = ser;
  } else if ((m = s.match(PROPERTY_RE))) top[m[1]] = scalar((m[2] ?? "").trim());
}

/** Drop psql decoration and blank lines; unwrap per-line quoted exports. Returns [{ col, text }]. */
function cleanLines(text) {
  let lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").map((l) => l.replace(/\s+$/, ""));
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length && nonEmpty.every((l) => /^\s*".*"$/.test(l))) {
    lines = lines.map((l) => (l.trim() ? l.replace(/^\s*"(.*)"$/, "$1").replace(/""/g, '"') : l));
  }
  return lines
    .filter(
      (l) =>
        l.trim() &&
        !/^\s*QUERY PLAN\s*$/.test(l) &&
        !/^\s*[-+]{3,}\s*$/.test(l) &&
        !/^\s*\(\d+ rows?\)$/.test(l) &&
        !/^\s*EXPLAIN\b/i.test(l) &&
        !/^\w+[=-][#>]/.test(l),
    )
    .map((l) => {
      const col = l.search(/\S/);
      return { col, text: l.slice(col) };
    });
}

/** Cheap check used before deciding between the JSON and text parsers. */
export function looksLikeTextPlan(text) {
  const lines = cleanLines(text);
  if (!lines.length || /^[[{]/.test(lines[0].text)) return false;
  PAREN_RE.lastIndex = 0;
  return lines.some((l) => l.text.startsWith("->")) || PAREN_RE.test(lines[0].text);
}

function newNode(text) {
  const raw = {};
  PAREN_RE.lastIndex = 0;
  const first = PAREN_RE.exec(text);
  const name = first ? text.slice(0, first.index) : text;
  parseNodeName(name.replace(/^->\s*/, ""), raw);
  PAREN_RE.lastIndex = 0; // matchAll copies lastIndex from the shared regex
  for (const m of text.matchAll(PAREN_RE)) parseParens(m[1], raw);
  return raw;
}

const BUFFER_FIELDS = ["Shared", "Local", "Temp"].flatMap((k) =>
  (k === "Temp" ? ["Read", "Written"] : ["Hit", "Read", "Dirtied", "Written"]).map((op) => `${k} ${op} Blocks`),
);

/** Post-process one statement: parent relationships, empty Plans, zero buffers where text omitted them. */
function finish(raw, hasBuffers) {
  const plans = raw.Plans ?? [];
  let ordinal = 0;
  for (const child of plans) {
    if (!child["Parent Relationship"]) {
      child["Parent Relationship"] = MEMBER_PARENTS.has(raw["Node Type"])
        ? "Member"
        : raw["Node Type"] === "Subquery Scan"
          ? "Subquery"
          : ordinal === 0
            ? "Outer"
            : "Inner";
      ordinal++;
    }
    finish(child, hasBuffers);
  }
  if (!plans.length) delete raw.Plans;
  // Text format skips an all-zero "Buffers:" line; JSON always has the keys.
  if (hasBuffers) for (const k of BUFFER_FIELDS) raw[k] ??= 0;
}

/**
 * Parse text-format EXPLAIN. Returns { data: [statement, ...] } in FORMAT JSON
 * shape, or { error } when the text isn't a recognisable plan.
 */
export function parseTextPlan(text) {
  const lines = cleanLines(text);
  if (!lines.length) return { error: "empty" };

  const statements = [];
  let cur = null;

  const startStatement = (line) => {
    const root = newNode(line.text);
    const top = { Plan: root, Triggers: [] };
    cur = { top, base: line.col, stack: [{ raw: root, textCol: line.col }], pending: null, worker: null, summary: null, hasBuffers: false };
    statements.push(cur);
  };

  // Deepest open node whose name starts left of `col`; closes the ones below it.
  const ownerAt = (col) => {
    while (cur.stack.length > 1 && cur.stack[cur.stack.length - 1].textCol >= col) cur.stack.pop();
    return cur.stack[cur.stack.length - 1];
  };

  for (const line of lines) {
    const { col, text: s } = line;
    PAREN_RE.lastIndex = 0;
    const isArrow = s.startsWith("->");

    if (!cur) {
      if (PROPERTY_RE.test(s) && !PAREN_RE.test(s)) continue; // stray summary text before the plan
      startStatement(line);
      continue;
    }

    // Summary section: lines at the root's own indentation (Planning Time, JIT, ...).
    if (!isArrow && col <= cur.base) {
      PAREN_RE.lastIndex = 0;
      if (cur.summary && PAREN_RE.test(s) && !PROPERTY_RE.test(s)) {
        startStatement(line); // a second statement in the same paste
        continue;
      }
      const head = s.match(/^(Planning|JIT):$/);
      if (head) {
        cur.summary = head[1];
        cur.top[head[1]] = {};
      } else {
        cur.summary = "top";
        parseSummaryLine(s, cur.top);
      }
      continue;
    }
    if (cur.summary) {
      if (cur.summary === "Planning") {
        const m = s.match(/^Memory:\s*used=(\d+)kB\s+allocated=(\d+)kB/);
        if (m) Object.assign(cur.top.Planning, { "Memory Used": toNum(m[1]), "Memory Allocated": toNum(m[2]) });
        else parseProperty(s, cur.top.Planning);
      } else if (cur.summary === "JIT") parseJitLine(s, cur.top.JIT);
      continue;
    }

    if (isArrow) {
      const parent = ownerAt(col);
      const raw = newNode(s);
      const pending = cur.pending;
      if (pending && pending.owner === parent.raw && pending.col < col) {
        raw["Parent Relationship"] = pending.kind;
        raw["Subplan Name"] = pending.name;
      }
      cur.pending = null;
      cur.worker = null;
      (parent.raw.Plans ??= []).push(raw);
      cur.stack.push({ raw, textCol: col + s.match(/^->\s*/)[0].length });
      continue;
    }

    if (SUBPLAN_RE.test(s)) {
      const owner = ownerAt(col);
      cur.pending = { owner: owner.raw, col, kind: s.startsWith("CTE") ? "InitPlan" : s.split(/\s/)[0], name: s };
      cur.worker = null;
      continue;
    }

    const owner = ownerAt(col);
    const worker = s.match(/^Worker (\d+):\s+(.*)$/);
    if (worker) {
      const list = (owner.raw.Workers ??= []);
      const number = Number(worker[1]);
      let w = list.find((x) => x["Worker Number"] === number);
      if (!w) list.push((w = { "Worker Number": number }));
      if (/^(actual\b|never executed)/.test(worker[2])) parseActual(worker[2], w);
      else parseProperty(worker[2], w);
      cur.worker = { owner: owner.raw, col, w };
      continue;
    }
    if (cur.worker && cur.worker.owner === owner.raw && col > cur.worker.col) {
      parseProperty(s, cur.worker.w);
      continue;
    }
    cur.worker = null;
    if (/^Buffers:/.test(s)) cur.hasBuffers = true;
    parseProperty(s, owner.raw);
  }

  if (!statements.length) return { error: "No plan found." };
  const data = statements.map((st) => {
    finish(st.top.Plan, st.hasBuffers);
    return st.top;
  });
  return { data };
}
