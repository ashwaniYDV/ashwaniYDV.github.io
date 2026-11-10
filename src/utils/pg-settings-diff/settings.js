/**
 * Parse PostgreSQL settings listings and diff them.
 *
 * Accepted input:
 *   - psql `SHOW ALL` (aligned or unaligned/-A): name | setting | description
 *   - `SELECT name, setting, unit FROM pg_settings` as psql aligned/unaligned or CSV (header optional)
 *   - plain "name = value" lines (postgresql.conf style)
 * Values with units are normalised (memory to bytes, time to ms) so
 * `128MB` (SHOW) and `16384` with unit `8kB` (pg_settings) compare equal.
 */

const MEMORY = { B: 1, kB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
const TIME = { us: 0.001, ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };

/** "8kB" -> { kind: "memory", factor: 8192 }; "ms" -> { kind: "time", factor: 1 }. */
export function parseUnit(unit) {
  const m = /^\s*(\d+)?\s*(B|kB|MB|GB|TB|us|ms|s|min|h|d)\s*$/.exec(unit ?? "");
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  if (m[2] in MEMORY) return { kind: "memory", factor: n * MEMORY[m[2]] };
  return { kind: "time", factor: n * TIME[m[2]] };
}

const BOOL = { on: "on", true: "on", yes: "on", off: "off", false: "off", no: "off" };

/**
 * Canonical comparable form of a value: { key, display }.
 * key is what equality uses; display is a human form like "128MB" or "5s".
 */
export function normalise(value, unit) {
  const raw = (value ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower in BOOL) return { key: `bool:${BOOL[lower]}`, display: BOOL[lower] };

  const num = /^(-?\d+(?:\.\d+)?)\s*(B|kB|MB|GB|TB|us|ms|s|min|h|d)?$/.exec(raw);
  if (num) {
    const n = Number(num[1]);
    const u = num[2] ? parseUnit(num[2]) : unit ? parseUnit(unit) : null;
    // -1 (and 0 for many settings) are sentinels ("disabled" / "use default"): keep them unit-less.
    if (u && n !== -1 && n !== 0) {
      const base = n * u.factor;
      return { key: `${u.kind}:${base}`, display: u.kind === "memory" ? fmtMemory(base) : fmtTime(base), base, kind: u.kind };
    }
    return { key: `num:${n}`, display: String(n) };
  }
  return { key: `str:${raw}`, display: raw };
}

/** Largest unit that represents bytes exactly, like PostgreSQL's own SHOW output. */
export function fmtMemory(bytes) {
  if (bytes === 0) return "0";
  for (const [u, f] of [["TB", MEMORY.TB], ["GB", MEMORY.GB], ["MB", MEMORY.MB], ["kB", MEMORY.kB]]) {
    if (Math.abs(bytes) >= f && bytes % f === 0) return `${bytes / f}${u}`;
  }
  return `${bytes}B`;
}

export function fmtTime(ms) {
  if (ms === 0) return "0";
  for (const [u, f] of [["d", TIME.d], ["h", TIME.h], ["min", TIME.min], ["s", TIME.s], ["ms", TIME.ms]]) {
    if (Math.abs(ms) >= f && ms % f === 0) return `${ms / f}${u}`;
  }
  return `${ms * 1000}us`;
}

// ---------- parsing ----------
function parseCsvLine(line, delimiter = ",") {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const NAME = /^[a-z_][a-z0-9_.]*$/i;
const UNIT_RE = /^(\d+)?(B|kB|MB|GB|TB|us|ms|s|min|h|d)$/;

/**
 * Parse one listing. Returns { settings: Map(name -> { name, value, unit, norm }), format, skipped }.
 */
export function parseSettings(text) {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const settings = new Map();
  let format = null;
  let columns = null; // header names when present
  let skipped = 0;

  const content = lines.filter((l) => l.trim() && !/^\s*[-+]+\s*$/.test(l) && !/^\s*\(\d+ rows?\)\s*$/.test(l));
  const pipe = content.filter((l) => l.includes("|")).length;
  const comma = content.filter((l) => l.includes(",")).length;
  const tab = content.filter((l) => l.includes("\t")).length;
  const eq = content.filter((l) => /^\s*[a-z_][a-z0-9_.]*\s*=/i.test(l)).length;
  const delimiter =
    pipe >= content.length * 0.6 ? "|" : tab >= content.length * 0.6 ? "\t" : eq >= content.length * 0.6 && eq > comma ? "=" : comma >= content.length * 0.6 ? "," : "|";
  format = { "|": "psql", "\t": "tsv", ",": "csv", "=": "conf" }[delimiter];

  for (const line of content) {
    let cells;
    if (delimiter === "=") {
      const at = line.indexOf("=");
      if (at === -1) {
        skipped++;
        continue;
      }
      let value = line.slice(at + 1).replace(/\s+#.*$/, "").trim();
      if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
      cells = [line.slice(0, at).trim(), value];
    } else if (delimiter === ",") cells = parseCsvLine(line, ",");
    else cells = line.split(delimiter).map((c) => c.trim());

    if (!columns && cells[0]?.toLowerCase() === "name" && /^(setting|value|current_setting)$/i.test(cells[1] ?? "")) {
      columns = cells.map((c) => c.toLowerCase());
      continue;
    }
    const name = cells[0];
    if (!name || !NAME.test(name) || cells.length < 2) {
      skipped++;
      continue;
    }
    let value;
    let unit;
    const unitAt = columns ? columns.indexOf("unit") : -1;
    if (columns && unitAt !== -1) {
      // name, setting, unit[, ...]: anything between name and unit is the setting (it may contain the delimiter).
      const tail = columns.length - unitAt;
      const unitIdx = Math.max(unitAt, cells.length - tail);
      value = cells.slice(1, unitIdx).join(delimiter === "," ? "," : delimiter);
      unit = cells[unitIdx] || undefined;
    } else if (columns) {
      // SHOW ALL: name | setting | description
      value = cells.length > columns.length ? cells.slice(1, cells.length - (columns.length - 2)).join(delimiter) : cells[1];
    } else if (cells.length === 3 && (cells[2] === "" || UNIT_RE.test(cells[2]))) {
      // header-less pg_settings: name, setting, unit
      value = cells[1];
      unit = cells[2] || undefined;
    } else value = cells[1];

    const v = (value ?? "").trim();
    settings.set(name.toLowerCase(), { name: name.toLowerCase(), value: v, unit, norm: normalise(v, unit) });
  }
  return { settings, format, skipped, hasUnits: Boolean(columns?.includes("unit")) };
}

// ---------- diff ----------
/**
 * Rows sorted by name: { name, left, right, status: "equal"|"changed"|"left"|"right", normalised }.
 * `normalised` is true when raw values differ but compare equal after unit/boolean normalisation.
 */
export function diffSettings(leftText, rightText) {
  const a = parseSettings(leftText).settings;
  const b = parseSettings(rightText).settings;
  const names = [...new Set([...a.keys(), ...b.keys()])].sort();
  return names.map((name) => {
    const l = a.get(name);
    const r = b.get(name);
    if (!r) return { name, left: l, right: null, status: "left" };
    if (!l) return { name, left: null, right: r, status: "right" };
    const equal = l.norm.key === r.norm.key;
    return { name, left: l, right: r, status: equal ? "equal" : "changed", normalised: equal && (l.value !== r.value || l.unit !== r.unit) };
  });
}

export function filterDiff(rows, { search = "", hideEqual = true } = {}) {
  const n = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!hideEqual || r.status !== "equal") &&
      (!n || r.name.includes(n) || [r.left?.value, r.right?.value].some((v) => v && v.toLowerCase().includes(n))),
  );
}

/** Shown value: the raw value, plus the unit for unit-less pg_settings numbers. */
export function shownValue(s) {
  if (!s) return "";
  if (s.unit && /^-?\d+(\.\d+)?$/.test(s.value) && s.value !== "-1") return `${s.value} × ${s.unit}`;
  return s.value;
}

const STATUS_TEXT = { equal: "same", changed: "changed", left: "only left", right: "only right" };

const mdCell = (v) => (v === "" || v === undefined || v === null ? " " : String(v).replace(/\|/g, "\\|").replace(/\n/g, " "));

export function toMarkdown(rows, { leftLabel = "Left", rightLabel = "Right" } = {}) {
  const head = `| Setting | ${mdCell(leftLabel)} | ${mdCell(rightLabel)} | Status |\n| --- | --- | --- | --- |`;
  const body = rows.map((r) => {
    const fmt = (s) => {
      if (!s) return "—";
      const shown = shownValue(s);
      return s.norm.display !== shown && (s.norm.kind || s.unit) ? `${shown} (${s.norm.display})` : shown;
    };
    return `| \`${r.name}\` | ${mdCell(fmt(r.left))} | ${mdCell(fmt(r.right))} | ${STATUS_TEXT[r.status]}${r.normalised ? " (after unit normalisation)" : ""} |`;
  });
  return [head, ...body].join("\n");
}
