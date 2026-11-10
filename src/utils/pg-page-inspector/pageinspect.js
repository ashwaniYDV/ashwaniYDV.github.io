/**
 * Pure helpers for the page & tuple inspector (no React).
 *
 * Parses psql output of the pageinspect extension:
 *   - heap_page_items(get_raw_page(...))
 *   - page_header(get_raw_page(...))
 *   - bt_page_items(...)
 * in aligned, expanded (\x), unaligned (\a) or CSV (\pset format csv) form,
 * and decodes the flag words following src/include/access/htup_details.h
 * and src/include/storage/itemid.h of PostgreSQL.
 */

export const DEFAULT_PAGE_SIZE = 8192;
export const PAGE_HEADER_SIZE = 24; // SizeOfPageHeaderData
export const ITEM_ID_SIZE = 4; // sizeof(ItemIdData)
export const HEAP_TUPLE_HEADER_SIZE = 23; // SizeofHeapTupleHeader

// ---------- flag tables (htup_details.h) ----------
/** t_infomask bits. `group` is used to colour/sort them in the UI. */
export const INFOMASK_FLAGS = [
  { bit: 0x0001, name: "HEAP_HASNULL", group: "layout", desc: "Has null attribute(s); a null bitmap (t_bits) follows the header." },
  { bit: 0x0002, name: "HEAP_HASVARWIDTH", group: "layout", desc: "Has variable-width attribute(s)." },
  { bit: 0x0004, name: "HEAP_HASEXTERNAL", group: "layout", desc: "Has attribute(s) stored out of line (TOAST)." },
  { bit: 0x0008, name: "HEAP_HASOID_OLD", group: "layout", desc: "Has an OID field (tables WITH OIDS, before PostgreSQL 12)." },
  { bit: 0x0010, name: "HEAP_XMAX_KEYSHR_LOCK", group: "xmax", desc: "xmax is a key-share locker." },
  { bit: 0x0020, name: "HEAP_COMBOCID", group: "xmin", desc: "t_cid is a combo command id (inserted and deleted in the same transaction)." },
  { bit: 0x0040, name: "HEAP_XMAX_EXCL_LOCK", group: "xmax", desc: "xmax is an exclusive locker." },
  { bit: 0x0080, name: "HEAP_XMAX_LOCK_ONLY", group: "xmax", desc: "xmax, if valid, only locked the row; it did not update or delete it." },
  { bit: 0x0100, name: "HEAP_XMIN_COMMITTED", group: "xmin", desc: "Hint: the inserting transaction (t_xmin) committed." },
  { bit: 0x0200, name: "HEAP_XMIN_INVALID", group: "xmin", desc: "Hint: t_xmin is invalid or aborted. Together with XMIN_COMMITTED it means frozen." },
  { bit: 0x0400, name: "HEAP_XMAX_COMMITTED", group: "xmax", desc: "Hint: the deleting/updating transaction (t_xmax) committed." },
  { bit: 0x0800, name: "HEAP_XMAX_INVALID", group: "xmax", desc: "Hint: t_xmax is invalid or aborted (the row is not deleted)." },
  { bit: 0x1000, name: "HEAP_XMAX_IS_MULTI", group: "xmax", desc: "t_xmax is a MultiXactId (several lockers, possibly one updater)." },
  { bit: 0x2000, name: "HEAP_UPDATED", group: "xmin", desc: "This is the UPDATEd version of a row (it was created by an UPDATE)." },
  { bit: 0x4000, name: "HEAP_MOVED_OFF", group: "legacy", desc: "Moved to another place by pre-9.0 VACUUM FULL (binary upgrade only)." },
  { bit: 0x8000, name: "HEAP_MOVED_IN", group: "legacy", desc: "Moved from another place by pre-9.0 VACUUM FULL (binary upgrade only)." },
];

export const HEAP_HASNULL = 0x0001;
export const HEAP_COMBOCID = 0x0020;
export const HEAP_XMAX_KEYSHR_LOCK = 0x0010;
export const HEAP_XMAX_EXCL_LOCK = 0x0040;
export const HEAP_XMAX_LOCK_ONLY = 0x0080;
export const HEAP_XMAX_SHR_LOCK = HEAP_XMAX_EXCL_LOCK | HEAP_XMAX_KEYSHR_LOCK;
export const HEAP_LOCK_MASK = HEAP_XMAX_SHR_LOCK | HEAP_XMAX_EXCL_LOCK | HEAP_XMAX_KEYSHR_LOCK;
export const HEAP_XMIN_COMMITTED = 0x0100;
export const HEAP_XMIN_INVALID = 0x0200;
export const HEAP_XMIN_FROZEN = HEAP_XMIN_COMMITTED | HEAP_XMIN_INVALID;
export const HEAP_XMAX_COMMITTED = 0x0400;
export const HEAP_XMAX_INVALID = 0x0800;
export const HEAP_XMAX_IS_MULTI = 0x1000;
export const HEAP_UPDATED = 0x2000;

/** t_infomask2 bits (the low 11 bits are the attribute count). */
export const HEAP_NATTS_MASK = 0x07ff;
export const INFOMASK2_FLAGS = [
  { bit: 0x2000, name: "HEAP_KEYS_UPDATED", group: "xmax", desc: "Tuple was deleted, or updated with key columns modified (also set by SELECT ... FOR UPDATE)." },
  { bit: 0x4000, name: "HEAP_HOT_UPDATED", group: "hot", desc: "Tuple was HOT-updated: the new version is on this page and no index entry was added." },
  { bit: 0x8000, name: "HEAP_ONLY_TUPLE", group: "hot", desc: "Heap-only tuple: a HOT version that no index points to directly." },
];
export const HEAP_KEYS_UPDATED = 0x2000;
export const HEAP_HOT_UPDATED = 0x4000;
export const HEAP_ONLY_TUPLE = 0x8000;

/** lp_flags values (storage/itemid.h). */
export const LP_FLAGS = {
  0: { name: "LP_UNUSED", short: "UNUSED", desc: "Unused line pointer (lp_len is always 0); free for reuse." },
  1: { name: "LP_NORMAL", short: "NORMAL", desc: "Used line pointer pointing at a tuple (lp_len > 0)." },
  2: { name: "LP_REDIRECT", short: "REDIRECT", desc: "HOT redirect: lp_off holds the line pointer number of the chain's next live member; lp_len is 0." },
  3: { name: "LP_DEAD", short: "DEAD", desc: "Dead line pointer: its tuple storage was reclaimed by pruning; waiting for VACUUM to remove index entries." },
};

/** pd_flags bits (storage/bufpage.h). */
export const PD_FLAGS = [
  { bit: 0x0001, name: "PD_HAS_FREE_LINES", desc: "There are unused line pointers before pd_lower." },
  { bit: 0x0002, name: "PD_PAGE_FULL", desc: "Not enough free space for a new tuple (hint for pruning)." },
  { bit: 0x0004, name: "PD_ALL_VISIBLE", desc: "All tuples on the page are visible to everyone." },
];

export const decodeFlags = (value, table) => table.map((f) => ({ ...f, set: (value & f.bit) !== 0 }));

/** HEAP_XMAX_IS_LOCKED_ONLY(): locker only, including the pg_upgrade'd pre-9.3 EXCL_LOCK form. */
export const xmaxIsLockedOnly = (infomask) =>
  (infomask & HEAP_XMAX_LOCK_ONLY) !== 0 || (infomask & (HEAP_XMAX_IS_MULTI | HEAP_LOCK_MASK)) === HEAP_XMAX_EXCL_LOCK;

/** Row lock strength encoded by a lock-only xmax. */
export function lockStrength(infomask, infomask2) {
  if (!xmaxIsLockedOnly(infomask) || infomask & HEAP_XMAX_INVALID) return null;
  if (infomask & HEAP_XMAX_IS_MULTI) return "several lockers (MultiXact)";
  const lock = infomask & HEAP_LOCK_MASK;
  if (lock === HEAP_XMAX_SHR_LOCK) return "FOR SHARE";
  if (lock === HEAP_XMAX_KEYSHR_LOCK) return "FOR KEY SHARE";
  if (lock === HEAP_XMAX_EXCL_LOCK) return infomask2 & HEAP_KEYS_UPDATED ? "FOR UPDATE" : "FOR NO KEY UPDATE";
  return "lock (unknown strength)";
}

// ---------- value parsing ----------
/** Parse an integer cell: decimal, 0x hex, or a 16-bit bit string (e.g. t_infomask::bit(16)). */
export function parseIntCell(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (s === "") return null;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16);
  if (/^[01]{6,}$/.test(s)) return parseInt(s, 2);
  if (/^-?\d+$/.test(s)) return Number(s);
  return null;
}

/** "(0,5)" -> { block: 0, offset: 5 } */
export function parseTid(text) {
  const m = /^\(?\s*(\d+)\s*,\s*(\d+)\s*\)?$/.exec(String(text ?? "").trim());
  return m ? { block: Number(m[1]), offset: Number(m[2]) } : null;
}

const fmtTid = (t) => (t ? `(${t.block},${t.offset})` : "");

/** Parse a CSV line (RFC 4180 quoting). */
export function splitCsv(line) {
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
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------- table detection ----------
const KINDS = [
  { kind: "heap", first: ["lp"], needs: ["lp", "lp_flags"] },
  { kind: "header", first: ["lsn"], needs: ["lower", "upper"] },
  { kind: "btree", first: ["itemoffset"], needs: ["itemoffset"] },
];

const isFooter = (line) => /^\(\d+ rows?\)$/.test(line.trim());
const isAlignedRule = (line) => /^[-+]+$/.test(line.trim()) && line.includes("-");

function headerKind(cols) {
  const names = cols.map((c) => c.trim().toLowerCase());
  for (const k of KINDS) if (k.first.includes(names[0]) && k.needs.every((n) => names.includes(n))) return k.kind;
  return null;
}

function splitRow(line, format) {
  if (format === "csv") return splitCsv(line);
  return line.split("|");
}

/**
 * Find every pageinspect result set in `text`.
 * Returns [{ kind: "heap"|"header"|"btree", columns: [...], rows: [{col: string|null}] }].
 */
export function parseTables(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const tables = [];
  let cur = null;
  let expanded = null; // { kind?, record: {}, columns: [] }

  const flushExpanded = () => {
    if (!expanded) return;
    if (Object.keys(expanded.record).length) expanded.records.push(expanded.record);
    expanded.record = {};
  };
  const finishExpanded = () => {
    if (!expanded) return;
    flushExpanded();
    const kind = expanded.records.length ? headerKind(Object.keys(expanded.records[0])) : null;
    if (kind) tables.push({ kind, columns: Object.keys(expanded.records[0]), rows: expanded.records, format: "expanded" });
    expanded = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    // psql expanded display: "-[ RECORD 1 ]--+-----" then "col | value" lines.
    if (/^-\[ RECORD \d+ \]/.test(line.trim())) {
      cur = null;
      if (!expanded) expanded = { records: [], record: {} };
      else flushExpanded();
      continue;
    }
    if (expanded) {
      const m = /^\s*([a-z_0-9]+)\s*\|\s?(.*)$/i.exec(line);
      if (m) {
        const v = m[2].trim();
        expanded.record[m[1].toLowerCase()] = v === "" ? null : v;
        continue;
      }
      if (line.trim() === "" || isFooter(line)) continue;
      finishExpanded();
    }

    const trimmed = line.trim();
    if (trimmed === "" || isFooter(trimmed)) {
      cur = null;
      continue;
    }
    // A header line starts a new table in any format.
    const format = trimmed.includes("|") ? "pipe" : trimmed.includes(",") ? "csv" : null;
    if (format) {
      const cols = splitRow(trimmed, format).map((c) => c.trim().toLowerCase());
      const kind = headerKind(cols);
      if (kind) {
        cur = { kind, columns: cols, rows: [], format };
        tables.push(cur);
        continue;
      }
    }
    if (!cur) continue;
    if (isAlignedRule(trimmed)) {
      cur.format = cur.format === "pipe" ? "aligned" : cur.format;
      continue;
    }
    const cells = splitRow(cur.format === "csv" ? trimmed : line, cur.format === "csv" ? "csv" : "pipe");
    if (cells.length < cur.columns.length - 1) continue; // stray text
    const row = {};
    cur.columns.forEach((c, i) => {
      const v = (cells[i] ?? "").trim();
      row[c] = v === "" ? null : v;
    });
    cur.rows.push(row);
  }
  finishExpanded();
  return tables.filter((t) => t.rows.length);
}

// ---------- heap decoding ----------
/** Null bitmap text ("10100000") -> list of null attribute numbers (1-based). Bit '0' means NULL. */
export function nullAttributes(tBits, natts) {
  if (!tBits) return [];
  const out = [];
  const n = natts ?? tBits.length;
  for (let i = 0; i < Math.min(n, tBits.length); i++) if (tBits[i] === "0") out.push(i + 1);
  return out;
}

/** Hex bytes from t_data ("\\x0100..." or "01 00 ..."). */
export function hexBytes(text) {
  if (!text) return [];
  const s = String(text).replace(/^\\x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-f]*$/i.test(s) || s.length % 2) return [];
  const out = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

/** Little-endian integer of the first n bytes (n <= 6 to stay exact). */
export function leInt(bytes, n = 4, signed = true) {
  if (bytes.length < n) return null;
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + bytes[i];
  if (signed && bytes[n - 1] & 0x80) v -= 2 ** (8 * n);
  return v;
}

/**
 * Summarise one heap tuple's state from its hint bits alone (no clog access).
 * Returns { label, tone, notes[] }.
 */
export function tupleState(t) {
  const notes = [];
  if (t.lpFlags === 0) return { label: "unused", tone: "muted", notes: ["Free line pointer."] };
  if (t.lpFlags === 3) return { label: "dead (pruned)", tone: "dead", notes: ["Storage reclaimed; index entries still point here until VACUUM."] };
  if (t.lpFlags === 2) return { label: `redirect → lp ${t.lpOff}`, tone: "hot", notes: ["Start of a pruned HOT chain."] };
  if (t.infomask === null) return { label: "normal", tone: "live", notes };

  const im = t.infomask;
  const frozen = (im & HEAP_XMIN_FROZEN) === HEAP_XMIN_FROZEN;
  let xmin;
  if (frozen) xmin = "frozen";
  else if (im & HEAP_XMIN_INVALID) xmin = "aborted";
  else if (im & HEAP_XMIN_COMMITTED) xmin = "committed";
  else xmin = "unknown";

  const lockOnly = xmaxIsLockedOnly(im);
  let xmax;
  if (im & HEAP_XMAX_INVALID || !t.xmax) xmax = "none";
  else if (lockOnly) xmax = "locker";
  else if (im & HEAP_XMAX_COMMITTED) xmax = "committed";
  else xmax = "unknown";

  if (frozen) notes.push("xmin is frozen: visible to every snapshot as far as the inserter is concerned.");
  if (xmin === "unknown") notes.push(`No xmin hint bits yet: readers must check pg_xact for xid ${t.xmin}.`);
  if (xmax === "unknown") notes.push(`No xmax hint bits yet: readers must check pg_xact for xid ${t.xmax}.`);
  const lock = lockStrength(im, t.infomask2 ?? 0);
  if (lock) notes.push(`xmax ${t.xmax} only locks the row (${lock}).`);
  if (im & HEAP_COMBOCID) notes.push("t_field3 holds a combo command id (cmin and cmax are in backend-local memory).");
  if (t.infomask2 & HEAP_ONLY_TUPLE) notes.push("Heap-only tuple: reached through a HOT chain, not from an index.");
  if (t.infomask2 & HEAP_HOT_UPDATED) notes.push("HOT-updated: the next version is on this page (follow t_ctid).");
  if (t.ctid && t.selfTid && (t.ctid.block !== t.selfTid.block || t.ctid.offset !== t.selfTid.offset) && !lockOnly)
    notes.push(`t_ctid points to a newer version at ${fmtTid(t.ctid)}.`);

  let label;
  let tone;
  if (xmin === "aborted") [label, tone] = ["aborted insert", "dead"];
  else if (xmax === "committed") [label, tone] = [t.infomask2 & HEAP_HOT_UPDATED || (t.ctid && t.selfTid && fmtTid(t.ctid) !== fmtTid(t.selfTid)) ? "updated (old version)" : "deleted", "dead"];
  else if (xmax === "unknown") [label, tone] = ["being deleted/updated?", "warn"];
  else if (xmin === "unknown") [label, tone] = ["inserted, not yet hinted", "warn"];
  else if (xmax === "locker") [label, tone] = ["live, locked", "live"];
  else [label, tone] = [frozen ? "live (frozen)" : "live", "live"];
  return { label, tone, notes };
}

/** Build decoded tuple objects from heap_page_items rows. */
export function decodeHeapRows(rows) {
  const tuples = rows.map((r) => {
    const lp = parseIntCell(r.lp);
    const infomask = parseIntCell(r.t_infomask);
    const infomask2 = parseIntCell(r.t_infomask2);
    const tuple = {
      lp,
      lpOff: parseIntCell(r.lp_off) ?? 0,
      lpFlags: parseIntCell(r.lp_flags) ?? 0,
      lpLen: parseIntCell(r.lp_len) ?? 0,
      xmin: parseIntCell(r.t_xmin),
      xmax: parseIntCell(r.t_xmax),
      field3: parseIntCell(r.t_field3),
      ctid: parseTid(r.t_ctid),
      ctidText: r.t_ctid ?? null,
      infomask,
      infomask2,
      hoff: parseIntCell(r.t_hoff),
      bits: r.t_bits ?? null,
      oid: r.t_oid ?? null,
      data: r.t_data ?? null,
      natts: infomask2 === null ? null : infomask2 & HEAP_NATTS_MASK,
      raw: r,
    };
    tuple.infomaskFlags = infomask === null ? [] : decodeFlags(infomask, INFOMASK_FLAGS);
    tuple.infomask2Flags = infomask2 === null ? [] : decodeFlags(infomask2, INFOMASK2_FLAGS);
    tuple.nulls = infomask !== null && infomask & HEAP_HASNULL ? nullAttributes(tuple.bits, tuple.natts) : [];
    return tuple;
  });
  // The page's own block number: most tuples' t_ctid point at themselves.
  const votes = new Map();
  tuples.forEach((t) => {
    if (t.ctid && t.ctid.offset === t.lp) votes.set(t.ctid.block, (votes.get(t.ctid.block) ?? 0) + 1);
  });
  const block = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  tuples.forEach((t) => {
    t.selfTid = { block, offset: t.lp };
    t.state = tupleState(t);
  });
  return { tuples, block };
}

/**
 * HOT / update chains on the page.
 * Edges: REDIRECT lp -> lp_off; NORMAL tuple with t_ctid != self -> target (same block) or an external TID.
 * Returns { edges: [{from, to, kind, external?}], chains: [[lp, ...]] } where kind is "redirect" | "hot" | "update".
 */
export function buildChains(tuples, block) {
  const byLp = new Map(tuples.map((t) => [t.lp, t]));
  const edges = [];
  for (const t of tuples) {
    if (t.lpFlags === 2) {
      edges.push({ from: t.lp, to: t.lpOff, kind: "redirect" });
    } else if (t.lpFlags === 1 && t.ctid && !(t.ctid.block === block && t.ctid.offset === t.lp)) {
      if (t.infomask !== null && xmaxIsLockedOnly(t.infomask)) continue; // a locker does not move t_ctid
      const hot = t.infomask2 !== null && (t.infomask2 & HEAP_HOT_UPDATED) !== 0;
      if (t.ctid.block === block) edges.push({ from: t.lp, to: t.ctid.offset, kind: hot ? "hot" : "update" });
      else edges.push({ from: t.lp, to: null, external: fmtTid(t.ctid), kind: "update" });
    }
  }
  const next = new Map(edges.map((e) => [e.from, e]));
  const hasIncoming = new Set(edges.filter((e) => e.to !== null).map((e) => e.to));
  const chains = [];
  for (const e of edges) {
    if (hasIncoming.has(e.from)) continue;
    const chain = [{ lp: e.from }];
    const seen = new Set([e.from]);
    let cur = e;
    while (cur) {
      if (cur.to === null) {
        chain.push({ external: cur.external, kind: cur.kind });
        break;
      }
      chain.push({ lp: cur.to, kind: cur.kind, missing: !byLp.has(cur.to) });
      if (seen.has(cur.to)) break; // cycle guard (corrupt input)
      seen.add(cur.to);
      cur = next.get(cur.to);
    }
    chains.push(chain);
  }
  return { edges, chains };
}

// ---------- page header / layout ----------
export function decodeHeader(row) {
  if (!row) return null;
  const flags = parseIntCell(row.flags) ?? 0;
  return {
    lsn: row.lsn ?? null,
    checksum: parseIntCell(row.checksum),
    flags,
    flagList: decodeFlags(flags, PD_FLAGS),
    lower: parseIntCell(row.lower),
    upper: parseIntCell(row.upper),
    special: parseIntCell(row.special),
    pagesize: parseIntCell(row.pagesize) ?? DEFAULT_PAGE_SIZE,
    version: parseIntCell(row.version),
    pruneXid: parseIntCell(row.prune_xid),
  };
}

/**
 * Byte regions of the page, in offset order:
 * [{ kind: "header"|"linp"|"free"|"tuple"|"special"|"gap"|"items", start, end, lp? }]
 * `header` may be null; then pd_lower/pd_upper are inferred from the line pointers.
 */
export function pageLayout({ header, tuples = [], itemCount }) {
  const pagesize = header?.pagesize ?? DEFAULT_PAGE_SIZE;
  const nItems = itemCount ?? tuples.length;
  const stored = tuples.filter((t) => t.lpFlags === 1 && t.lpLen > 0);
  const lower = header?.lower ?? PAGE_HEADER_SIZE + ITEM_ID_SIZE * nItems;
  const special = header?.special ?? pagesize;
  const upper = header?.upper ?? (stored.length ? Math.min(...stored.map((t) => t.lpOff)) : special);
  const regions = [
    { kind: "header", start: 0, end: PAGE_HEADER_SIZE },
    { kind: "linp", start: PAGE_HEADER_SIZE, end: lower },
    { kind: "free", start: lower, end: upper },
  ];
  if (stored.length) {
    const sorted = [...stored].sort((a, b) => a.lpOff - b.lpOff);
    let pos = upper;
    for (const t of sorted) {
      if (t.lpOff > pos) regions.push({ kind: "gap", start: pos, end: t.lpOff });
      regions.push({ kind: "tuple", start: t.lpOff, end: t.lpOff + t.lpLen, lp: t.lp, tone: t.state?.tone });
      pos = Math.max(pos, t.lpOff + t.lpLen);
    }
    if (special > pos) regions.push({ kind: "gap", start: pos, end: special });
  } else if (special > upper) {
    regions.push({ kind: "items", start: upper, end: special });
  }
  if (pagesize > special) regions.push({ kind: "special", start: special, end: pagesize });
  return {
    pagesize,
    lower,
    upper,
    special,
    free: Math.max(0, upper - lower),
    regions: regions.filter((r) => r.end > r.start),
    inferred: !header,
  };
}

// ---------- btree ----------
export const BT_IS_POSTING = 0x2000;

/** Decode bt_page_items rows. */
export function decodeBtreeRows(rows) {
  return rows.map((r) => {
    const ctid = parseTid(r.ctid);
    const tids = r.tids ? (String(r.tids).match(/\(\d+,\d+\)/g) ?? []) : [];
    const htid = r.htid ?? null;
    const bytes = hexBytes(r.data);
    const posting = tids.length > 0 && ctid && (ctid.offset & BT_IS_POSTING) !== 0;
    const pivot = "htid" in r && !htid && !tids.length; // PG 13+: pivot tuples have no heap TID
    return {
      itemoffset: parseIntCell(r.itemoffset),
      ctid,
      ctidText: r.ctid ?? null,
      itemlen: parseIntCell(r.itemlen),
      nulls: r.nulls ?? null,
      vars: r.vars ?? null,
      data: r.data ?? null,
      dead: r.dead ?? null,
      htid,
      tids,
      posting,
      pivot,
      int4: bytes.length >= 4 ? leInt(bytes, 4) : null,
      bytes,
      raw: r,
    };
  });
}

// ---------- top level ----------
/** Parse the whole input. Returns { heap?, header?, btree?, error? }. */
export function inspect(text) {
  if (!String(text ?? "").trim()) return { error: "empty" };
  const tables = parseTables(text);
  if (!tables.length)
    return {
      error:
        "No pageinspect output found. Paste the result of heap_page_items(), page_header() or bt_page_items() including its header line.",
    };
  const headerTable = tables.find((t) => t.kind === "header");
  const heapTable = tables.find((t) => t.kind === "heap");
  const btreeTable = tables.find((t) => t.kind === "btree");
  const header = decodeHeader(headerTable?.rows[0]);
  const result = { header, tables };
  if (heapTable) {
    const { tuples, block } = decodeHeapRows(heapTable.rows);
    result.heap = { tuples, block, ...buildChains(tuples, block), layout: pageLayout({ header, tuples }) };
  }
  if (btreeTable) {
    const items = decodeBtreeRows(btreeTable.rows);
    result.btree = { items, layout: pageLayout({ header, itemCount: items.length }) };
  }
  if (!heapTable && !btreeTable && header) result.layout = pageLayout({ header, tuples: [] });
  return result;
}

export const hex16 = (v) => (v === null || v === undefined ? "—" : `0x${v.toString(16).toUpperCase().padStart(4, "0")}`);
export const bin16 = (v) => (v === null || v === undefined ? "" : v.toString(2).padStart(16, "0"));
