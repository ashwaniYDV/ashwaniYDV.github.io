/**
 * Transaction ID / MultiXact wraparound math (pure, no React).
 *
 * XIDs are 32-bit and compared modulo 2^32, so at most 2^31 − 1 transactions can be "in the past".
 * The server computes, from the oldest datfrozenxid (varsup.c SetTransactionIdLimit):
 *   wrapLimit = oldest + 2^31 − 1
 *   stopLimit = wrapLimit − 3,000,000   (PG 14+; 1,000,000 before)   -> refuses new XIDs
 *   warnLimit = wrapLimit − 40,000,000  (PG 14-18; stopLimit − 10M before; 100M in PG 19 devel)
 * MultiXacts (multixact.c SetMultiXactIdLimit) use the same 2^31 horizon with stop 3M / warn 40M
 * on PG 14-18 (stop 100 / warn stop − 10M before; warn 100M in PG 19 devel).
 */
import { parseTable } from "./table.js";

export const WRAP = 2 ** 31 - 1; // 2,147,483,647

export const KINDS = {
  xid: {
    id: "xid",
    label: "XID",
    freezeSetting: "autovacuum_freeze_max_age",
    failsafeSetting: "vacuum_failsafe_age",
    defaults: { freezeMaxAge: 200_000_000, failsafeAge: 1_600_000_000 },
    minFreeze: 100_000,
    margins: {
      pg14: { stop: 3_000_000, warn: 40_000_000 },
      pg19: { stop: 3_000_000, warn: 100_000_000 },
      legacy: { stop: 1_000_000, warn: 11_000_000 },
    },
  },
  mxid: {
    id: "mxid",
    label: "MultiXact",
    freezeSetting: "autovacuum_multixact_freeze_max_age",
    failsafeSetting: "vacuum_multixact_failsafe_age",
    defaults: { freezeMaxAge: 400_000_000, failsafeAge: 1_600_000_000 },
    minFreeze: 10_000,
    margins: {
      pg14: { stop: 3_000_000, warn: 40_000_000 },
      pg19: { stop: 3_000_000, warn: 100_000_000 },
      legacy: { stop: 100, warn: 10_000_100 },
    },
  },
};

export const VERSIONS = [
  { id: "legacy", label: "PG 13 and older" },
  { id: "pg14", label: "PG 14–18" },
  { id: "pg19", label: "PG 19 devel" },
];

/** Thresholds as ages (not XID values). `version` is "pg14" (14-18), "pg19" or "legacy" (13 and older). */
export function thresholds(kind, { freezeMaxAge, failsafeAge, version = "pg14" }) {
  const k = KINDS[kind];
  const m = k.margins[version] ?? k.margins.pg14;
  const freeze = freezeMaxAge;
  // VACUUM silently uses at least 105% of the freeze max age as the failsafe trigger (vacuum.c).
  const failsafe = version === "legacy" ? null : Math.max(failsafeAge, Math.floor(freeze * 1.05));
  return { freeze, failsafe, warn: WRAP - m.warn, stop: WRAP - m.stop, wrap: WRAP };
}

/** Validate settings; returns a map of field -> message. */
export function validateSettings(kind, { freezeMaxAge, failsafeAge }) {
  const errors = {};
  // Both settings are capped at 2,000,000,000 (freeze max age) and 2,100,000,000 (failsafe) by guc_tables.c.
  if (!Number.isFinite(freezeMaxAge) || !Number.isInteger(freezeMaxAge)) errors.freezeMaxAge = "Enter a whole number.";
  else if (freezeMaxAge < KINDS[kind].minFreeze || freezeMaxAge > 2_000_000_000)
    errors.freezeMaxAge = `${KINDS[kind].freezeSetting} must be between ${KINDS[kind].minFreeze.toLocaleString("en-US")} and 2,000,000,000.`;
  if (!Number.isFinite(failsafeAge) || !Number.isInteger(failsafeAge)) errors.failsafeAge = "Enter a whole number.";
  else if (failsafeAge < 0 || failsafeAge > 2_100_000_000)
    errors.failsafeAge = `${KINDS[kind].failsafeSetting} must be between 0 and 2,100,000,000.`;
  return errors;
}

/** "200M", "1.6B", "200,000,000", "2e9" -> number. */
export function parseCount(text) {
  const s = String(text ?? "").trim().replace(/[,_\s]/g, "");
  if (!s) return NaN;
  const m = /^(\d+(?:\.\d+)?(?:e\d+)?)([kmb])?$/i.exec(s);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

export const SEVERITIES = ["ok", "watch", "high", "critical", "stopped"];

/** Severity for one age. */
export function severity(age, t) {
  if (age >= t.stop) return "stopped";
  if (age >= t.warn || (t.failsafe !== null && age >= t.failsafe)) return "critical";
  if (age >= WRAP / 2) return "high";
  if (age >= t.freeze) return "watch";
  return "ok";
}

export const SEVERITY_TEXT = {
  ok: "OK",
  watch: "Anti-wraparound vacuum due",
  high: "High: past half the XID space",
  critical: "Critical",
  stopped: "Stopped: no new IDs",
};

const NAME_COLS = ["datname", "relname", "table", "table_name", "relation", "name", "oid", "nspname"];

/**
 * Pick the age column for `kind` from parsed headers.
 * psql labels `age(datfrozenxid)` just "age" and `mxid_age(datminmxid)` "mxid_age".
 */
export function pickAgeColumn(columns, rows, kind) {
  const isNumeric = (c) => rows.length > 0 && rows.every((r) => r[c] === "" || /^-?\d+$/.test(r[c].replace(/,/g, "")));
  const numeric = columns.filter(isNumeric);
  const multi = (c) => /mxid|multi|minmxid/.test(c);
  if (kind === "mxid") return numeric.find(multi) ?? (numeric.length === 1 && !/xid/.test(numeric[0]) ? numeric[0] : null);
  const xidCols = numeric.filter((c) => !multi(c));
  return (
    xidCols.find((c) => /xid_age|frozenxid|^age$|xid/.test(c)) ??
    xidCols.find((c) => /age/.test(c)) ??
    (xidCols.length === 1 ? xidCols[0] : null)
  );
}

/**
 * Parse pasted age output and score every row.
 * Returns `{ rows, ageColumn, nameColumns }` or `{ error }`.
 */
export function analyze(text, kind, settings) {
  const table = parseTable(text);
  if (table.error) return { error: table.error };
  const { columns, rows } = table;
  if (!rows.length) return { error: "Found a header but no data rows." };
  const ageColumn = pickAgeColumn(columns, rows, kind);
  if (!ageColumn) {
    return {
      error:
        kind === "mxid"
          ? "No MultiXact age column found. Include mxid_age(datminmxid) or mxid_age(relminmxid) in the query."
          : "No XID age column found. Include age(datfrozenxid) or age(relfrozenxid) in the query.",
    };
  }
  const nameColumns = columns.filter((c) => c !== ageColumn && NAME_COLS.includes(c));
  const fallbackName = columns.find((c) => c !== ageColumn && !/age|size|bytes/.test(c));
  const t = thresholds(kind, settings);
  const rate = settings.ratePerDay > 0 ? settings.ratePerDay : null;
  const out = rows
    .filter((r) => r[ageColumn] !== "")
    .map((r, i) => {
      const age = Number(r[ageColumn].replace(/,/g, ""));
      const name = nameColumns.length
        ? nameColumns.map((c) => r[c]).filter(Boolean).join(".")
        : fallbackName
          ? r[fallbackName]
          : `row ${i + 1}`;
      const pct = (limit) => (limit ? (age / limit) * 100 : null);
      const days = (limit) => (rate && limit !== null ? Math.max(0, (limit - age) / rate) : null);
      return {
        name,
        age,
        raw: r,
        severity: severity(age, t),
        pctFreeze: pct(t.freeze),
        pctFailsafe: t.failsafe === null ? null : pct(t.failsafe),
        pctStop: pct(t.stop),
        remaining: t.stop - age,
        daysToFreeze: days(t.freeze),
        daysToFailsafe: t.failsafe === null ? null : days(t.failsafe),
        daysToStop: days(t.stop),
      };
    })
    .sort((a, b) => b.age - a.age);
  return { rows: out, ageColumn, columns, thresholds: t };
}

export const QUERIES = {
  database: `-- Per database (run in any database)
SELECT datname,
       age(datfrozenxid)    AS xid_age,
       mxid_age(datminmxid) AS mxid_age
FROM pg_database
ORDER BY 2 DESC;`,
  relation: `-- Per table, in the database with the highest age
SELECT c.oid::regclass       AS relname,
       age(c.relfrozenxid)    AS xid_age,
       mxid_age(c.relminmxid) AS mxid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY 2 DESC   -- ORDER BY 3 DESC for MultiXacts
LIMIT 20;`,
  rate: {
    xid: `-- XIDs/day: run twice, hours apart; (xid2 - xid1) / days
SELECT now(), pg_current_xact_id();   -- PG 13+ (older: txid_current())`,
    mxid: `-- MultiXacts/day: run twice, hours apart (value as of last checkpoint)
SELECT now(), next_multixact_id FROM pg_control_checkpoint();`,
  },
  settings: `SHOW autovacuum_freeze_max_age;
SHOW vacuum_failsafe_age;             -- PG 14+
SHOW autovacuum_multixact_freeze_max_age;
SHOW vacuum_multixact_failsafe_age;   -- PG 14+`,
};
