/**
 * Autovacuum trigger maths (pure logic, no React).
 *
 * Mirrors the rules documented in "Routine Vacuuming > The Autovacuum Daemon":
 *   vacuum   when n_dead_tup          > vacuum_threshold  + vacuum_scale_factor  * reltuples
 *            (PG18: the right side is capped at autovacuum_vacuum_max_threshold)
 *   insert   when n_ins_since_vacuum  > insert_threshold  + insert_scale_factor  * reltuples
 *            (PG18: reltuples counts only the not-all-frozen part of the table)
 *   analyze  when n_mod_since_analyze > analyze_threshold + analyze_scale_factor * reltuples
 * reltuples = -1 (never vacuumed/analyzed, PG14+) is treated as 0.
 */

export const VERSIONS = [13, 14, 15, 16, 17, 18];

export const SETTING_KEYS = [
  "autovacuum_vacuum_threshold",
  "autovacuum_vacuum_scale_factor",
  "autovacuum_analyze_threshold",
  "autovacuum_analyze_scale_factor",
  "autovacuum_vacuum_insert_threshold",
  "autovacuum_vacuum_insert_scale_factor",
  "autovacuum_vacuum_max_threshold",
];

export const DEFAULT_SETTINGS = {
  autovacuum_vacuum_threshold: 50,
  autovacuum_vacuum_scale_factor: 0.2,
  autovacuum_analyze_threshold: 50,
  autovacuum_analyze_scale_factor: 0.1,
  autovacuum_vacuum_insert_threshold: 1000,
  autovacuum_vacuum_insert_scale_factor: 0.2,
  autovacuum_vacuum_max_threshold: 100000000,
};

const num = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(/_/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/** Merge global settings with per-table reloptions overrides. */
export function effectiveSettings(globals, overrides = {}) {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = num(overrides[k] ?? globals[k], DEFAULT_SETTINGS[k]);
  return out;
}

/**
 * Evaluate one table.
 * table: { reltuples, n_dead_tup, n_mod_since_analyze, n_ins_since_vacuum, frozenFraction? (0..1, PG18), enabled? }
 * Returns { vacuum, insert, analyze } each { threshold, count, ratio, triggers, disabled, remaining, capped? }.
 */
export function evaluate(table, settings, version) {
  const s = effectiveSettings(settings);
  const rawTuples = num(table.reltuples);
  const reltuples = rawTuples < 0 ? 0 : rawTuples;
  const frozen = version >= 18 ? Math.min(1, Math.max(0, num(table.frozenFraction))) : 0;

  const make = (count, threshold, extra = {}) => {
    const disabled = extra.disabled || false;
    const ratio = disabled ? 0 : threshold > 0 ? count / threshold : count > 0 ? Infinity : 0;
    return {
      count,
      threshold,
      ratio,
      disabled,
      triggers: !disabled && count > threshold,
      remaining: disabled ? null : Math.max(0, Math.floor(threshold) + 1 - count),
      ...extra,
    };
  };

  let vacThreshold = s.autovacuum_vacuum_threshold + s.autovacuum_vacuum_scale_factor * reltuples;
  let capped = false;
  if (version >= 18 && s.autovacuum_vacuum_max_threshold >= 0 && vacThreshold > s.autovacuum_vacuum_max_threshold) {
    vacThreshold = s.autovacuum_vacuum_max_threshold;
    capped = true;
  }
  const insDisabled = s.autovacuum_vacuum_insert_threshold < 0;
  const insThreshold = s.autovacuum_vacuum_insert_threshold + s.autovacuum_vacuum_insert_scale_factor * reltuples * (1 - frozen);
  const anlThreshold = s.autovacuum_analyze_threshold + s.autovacuum_analyze_scale_factor * reltuples;

  const disabled = table.enabled === false;
  return {
    reltuples,
    neverAnalyzed: rawTuples < 0,
    disabled,
    vacuum: make(num(table.n_dead_tup), vacThreshold, { capped, disabled }),
    insert: make(num(table.n_ins_since_vacuum), insThreshold, { disabled: disabled || insDisabled }),
    analyze: make(num(table.n_mod_since_analyze), anlThreshold, { disabled }),
  };
}

/** Quote an identifier only when needed (lower-case, no specials, not obviously reserved). */
export function quoteIdent(name) {
  if (/^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

const RESERVED = new Set(["user", "order", "table", "group", "select", "where", "from", "limit", "offset", "default", "check", "column", "end", "all", "primary", "references", "desc", "asc"]);

/** "schema.table" or "table" -> quoted, qualified name. Already-quoted input is passed through. */
export function qualifiedName(schema, table) {
  const t = String(table || "").trim();
  if (!t) return "my_table";
  if (t.includes('"')) return schema ? `${quoteIdent(schema)}.${t}` : t;
  if (!schema && t.includes(".")) {
    const [sch, ...rest] = t.split(".");
    return `${quoteIdent(sch)}.${quoteIdent(rest.join("."))}`;
  }
  return schema ? `${quoteIdent(schema)}.${quoteIdent(t)}` : quoteIdent(t);
}

/** Trim a float for SQL output (no exponent, up to 6 decimals). */
export function fmtFactor(f) {
  if (f === 0) return "0";
  const s = f.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "0" ? "0.000001" : s;
}

/**
 * ALTER TABLE that makes autovacuum (and optionally analyze) fire at about `target` rows.
 * mode "fixed": scale_factor = 0, threshold = target (independent of table growth).
 * mode "scale": keep the base threshold, solve the scale factor for the current reltuples.
 * Returns { sql, note }.
 */
export function tuneStatement({ schema, table, reltuples, settings, vacuumTarget, analyzeTarget, mode = "fixed" }) {
  const s = effectiveSettings(settings);
  const rows = Math.max(0, num(reltuples));
  const parts = [];
  const notes = [];
  const plan = (kind, target) => {
    const t = Math.floor(num(target, NaN));
    if (!Number.isFinite(t) || t < 0) return;
    const base = s[`autovacuum_${kind}_threshold`];
    if (mode === "scale" && rows > 0 && t > base) {
      parts.push(`autovacuum_${kind}_scale_factor = ${fmtFactor((t - base) / rows)}`);
      notes.push(`${kind}: ${base} + factor × ${Math.round(rows).toLocaleString("en-US")} rows ≈ ${t.toLocaleString("en-US")}; grows with the table.`);
    } else {
      parts.push(`autovacuum_${kind}_scale_factor = 0`, `autovacuum_${kind}_threshold = ${t}`);
      if (mode === "scale") notes.push(`${kind}: target is at or below the base threshold (or the table is empty), so a fixed threshold is used.`);
      else notes.push(`${kind}: fires after ${t.toLocaleString("en-US")} rows regardless of table size.`);
    }
  };
  plan("vacuum", vacuumTarget);
  plan("analyze", analyzeTarget);
  if (!parts.length) return { sql: "", note: "Enter a target row count." };
  const sql = `ALTER TABLE ${qualifiedName(schema, table)} SET (\n  ${parts.join(",\n  ")}\n);`;
  return { sql, note: notes.join(" ") };
}

/** RESET statement to go back to the global settings. */
export function resetStatement(schema, table) {
  return `ALTER TABLE ${qualifiedName(schema, table)} RESET (\n  autovacuum_vacuum_threshold, autovacuum_vacuum_scale_factor,\n  autovacuum_analyze_threshold, autovacuum_analyze_scale_factor\n);`;
}

// ---------------- bulk paste ----------------

export const BULK_QUERY = `SELECT s.schemaname, s.relname,
       c.reltuples::bigint AS reltuples,
       s.n_dead_tup, s.n_mod_since_analyze, s.n_ins_since_vacuum,
       c.relpages,  -- PG18: add c.relallfrozen,
       array_to_string(c.reloptions, ' ') AS reloptions
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY s.n_dead_tup DESC
LIMIT 200;`;

const ALIASES = {
  schemaname: "schema",
  schema: "schema",
  nspname: "schema",
  relname: "table",
  table: "table",
  table_name: "table",
  tablename: "table",
  reltuples: "reltuples",
  n_live_tup: "n_live_tup",
  n_dead_tup: "n_dead_tup",
  n_mod_since_analyze: "n_mod_since_analyze",
  n_ins_since_vacuum: "n_ins_since_vacuum",
  relpages: "relpages",
  relallfrozen: "relallfrozen",
  reloptions: "reloptions",
};

/** Split one CSV/TSV line, honouring double quotes. */
function splitDelimited(line, sep) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Pull autovacuum_* overrides out of a reloptions text like `{autovacuum_vacuum_scale_factor=0.01,fillfactor=90}`. */
export function parseReloptions(text) {
  const overrides = {};
  let enabled = true;
  const re = /(autovacuum_[a-z_]+|toast\.autovacuum_[a-z_]+)\s*=\s*([^,}\s]+)/g;
  for (const m of String(text || "").matchAll(re)) {
    const [, key, value] = m;
    if (key.startsWith("toast.")) continue;
    if (key === "autovacuum_enabled") enabled = !/^(f|false|off|0|no)$/i.test(value);
    else if (SETTING_KEYS.includes(key)) overrides[key] = Number(value);
  }
  return { overrides, enabled };
}

/**
 * Parse pasted psql aligned output, CSV or TSV with a header row.
 * Returns { rows: [{ schema, table, reltuples, ... , overrides, enabled }], error?, skipped }.
 */
export function parseBulk(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], error: "empty", skipped: 0 };

  const aligned = lines.some((l) => /^[-+]+$/.test(l.trim())) || (lines[0].includes("|") && !lines[0].includes(","));
  const sep = aligned ? "|" : lines[0].includes("\t") ? "\t" : ",";
  const body = lines.filter((l) => !/^[-+\s]+$/.test(l) && !/^\(\d+ rows?\)$/.test(l.trim()));
  const split = (l) => {
    if (sep !== "|") return splitDelimited(l, sep);
    let cells = l.split("|").map((c) => c.trim());
    // psql with border 2 has leading/trailing pipes.
    if (cells.length && cells[0] === "" && l.trim().startsWith("|")) cells = cells.slice(1);
    if (cells.length && cells[cells.length - 1] === "" && l.trim().endsWith("|")) cells = cells.slice(0, -1);
    return cells;
  };

  const header = split(body[0]).map((h) => ALIASES[h.toLowerCase().replace(/^"|"$/g, "")] || null);
  if (!header.includes("table")) return { rows: [], error: "Header row needs a relname (or table) column.", skipped: 0 };
  if (!header.includes("n_dead_tup") && !header.includes("n_mod_since_analyze") && !header.includes("n_ins_since_vacuum")) {
    return { rows: [], error: "Header row needs at least one of n_dead_tup, n_mod_since_analyze, n_ins_since_vacuum.", skipped: 0 };
  }

  const rows = [];
  let skipped = 0;
  for (const line of body.slice(1)) {
    const cells = split(line);
    const rec = {};
    header.forEach((key, i) => {
      if (key) rec[key] = cells[i] ?? "";
    });
    if (!rec.table) {
      skipped++;
      continue;
    }
    const reltuples = rec.reltuples !== undefined && rec.reltuples !== "" ? num(rec.reltuples) : num(rec.n_live_tup);
    const relpages = num(rec.relpages);
    const relallfrozen = num(rec.relallfrozen);
    const { overrides, enabled } = parseReloptions(rec.reloptions);
    rows.push({
      schema: rec.schema || "",
      table: rec.table,
      reltuples,
      n_dead_tup: num(rec.n_dead_tup),
      n_mod_since_analyze: num(rec.n_mod_since_analyze),
      n_ins_since_vacuum: num(rec.n_ins_since_vacuum),
      frozenFraction: relpages > 0 ? Math.min(1, relallfrozen / relpages) : 0,
      overrides,
      enabled,
    });
  }
  if (!rows.length) return { rows, error: "No data rows found under the header.", skipped };
  return { rows, skipped };
}

/** Evaluate every parsed row; sorted by how close the nearest trigger is. */
export function evaluateBulk(rows, globals, version) {
  return rows
    .map((row) => {
      const settings = effectiveSettings(globals, row.overrides);
      const result = evaluate(row, settings, version);
      const urgency = Math.max(result.vacuum.ratio, result.insert.ratio, result.analyze.ratio);
      return { row, settings, result, urgency, hasOverrides: Object.keys(row.overrides).length > 0 };
    })
    .sort((a, b) => b.urgency - a.urgency);
}
