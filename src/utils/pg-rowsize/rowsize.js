/**
 * Heap row, page and btree size estimator (pure logic, no React).
 *
 * Based on the public on-disk format (docs "Database Page Layout", pg_type
 * typlen/typalign, src/include/access/htup_details.h, itup.h, varatt.h):
 *   - 8kB pages with a 24-byte page header and a 4-byte line pointer per tuple
 *   - heap tuple header 23 bytes + null bitmap (only when the row has a NULL),
 *     padded to MAXALIGN (8)
 *   - each column aligned to its typalign (c=1, s=2, i=4, d=8) in declared order;
 *     varlena values under 127 bytes use a 1-byte header and are not aligned
 *   - the whole tuple is padded to MAXALIGN on the page
 *   - rows above ~2kB (TOAST_TUPLE_THRESHOLD, 2032 bytes) get large values moved out of line
 */

export const BLOCK = 8192;
export const PAGE_HEADER = 24;
export const ITEM_ID = 4;
export const HEAP_HEADER = 23;
export const MAXALIGN = 8;
export const TOAST_THRESHOLD = 2032;
export const TOAST_POINTER = 18;
export const TOAST_CHUNK = 1996;
export const MAX_HEAP_TUPLES = 291;
export const BTREE_SPECIAL = 16;
export const BTREE_MAX_ITEM = 2704;
export const VARLENA_SHORT_MAX = 127;

const align = (off, a) => (a <= 1 ? off : Math.ceil(off / a) * a);
const maxalign = (n) => align(n, MAXALIGN);

/**
 * Column types. `len` = typlen (-1 = varlena), `align` = typalign in bytes,
 * `storage` = default attstorage (p plain, m main, x extended), `sql` = DDL name.
 */
export const TYPES = {
  bool: { label: "boolean", len: 1, align: 1, sql: "boolean" },
  int2: { label: "smallint (int2)", len: 2, align: 2, sql: "smallint" },
  int4: { label: "integer (int4)", len: 4, align: 4, sql: "integer" },
  int8: { label: "bigint (int8)", len: 8, align: 8, sql: "bigint" },
  float4: { label: "real (float4)", len: 4, align: 4, sql: "real" },
  float8: { label: "double precision (float8)", len: 8, align: 8, sql: "double precision" },
  numeric: { label: "numeric(p,s)", len: -1, align: 4, storage: "m", sql: "numeric" },
  date: { label: "date", len: 4, align: 4, sql: "date" },
  time: { label: "time", len: 8, align: 8, sql: "time" },
  timestamp: { label: "timestamp", len: 8, align: 8, sql: "timestamp" },
  timestamptz: { label: "timestamptz", len: 8, align: 8, sql: "timestamptz" },
  interval: { label: "interval", len: 16, align: 8, sql: "interval" },
  uuid: { label: "uuid", len: 16, align: 1, sql: "uuid" },
  text: { label: "text", len: -1, align: 4, storage: "x", sql: "text" },
  varchar: { label: "varchar", len: -1, align: 4, storage: "x", sql: "varchar" },
  bytea: { label: "bytea", len: -1, align: 4, storage: "x", sql: "bytea" },
  jsonb: { label: "jsonb", len: -1, align: 4, storage: "x", sql: "jsonb" },
  array: { label: "array", len: -1, align: 4, storage: "x", sql: "[]" },
};

/** Element types allowed inside arrays. */
export const ELEM_TYPES = ["int2", "int4", "int8", "float4", "float8", "bool", "date", "timestamp", "timestamptz", "uuid", "text"];

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Bytes of a numeric(p,s) value at full precision: 2-byte header + 2 bytes per base-10000 digit group. */
export function numericDataBytes(precision, scale) {
  const p = Math.max(1, Math.floor(num(precision, 12)));
  const s = Math.min(p, Math.max(0, Math.floor(num(scale, 0))));
  return 2 + 2 * (Math.ceil((p - s) / 4) + Math.ceil(s / 4));
}

/** Bytes after the varlena header for a 1-D array without NULL elements. */
export function arrayDataBytes(elemType, count, elemAvgLen) {
  const n = Math.max(0, Math.floor(num(count)));
  if (n === 0) return 12; // empty array: ndim = 0, no dimensions
  const header = 20; // ndim, dataoffset, elemtype, then dims + lbound for 1 dimension, padded to 24 with the 4-byte length word
  const elem = TYPES[elemType] ?? TYPES.int4;
  if (elem.len > 0) return header + n * align(elem.len, elem.align);
  // varlena elements keep a 4-byte header inside arrays, aligned to 4
  const one = 4 + Math.max(0, num(elemAvgLen));
  return header + (n - 1) * align(one, 4) + one;
}

/** Array typalign: 'd' for 8-byte-aligned elements, otherwise 'i'. */
const arrayAlign = (elemType) => ((TYPES[elemType]?.align ?? 4) === 8 ? 8 : 4);

/**
 * Stored size of one non-null value of column `col`.
 * Returns { len, align, varlena, short, dataBytes, storage }.
 */
export function valueSize(col) {
  const t = TYPES[col.type] ?? TYPES.int4;
  if (t.len > 0) return { len: t.len, align: t.align, varlena: false, short: false, dataBytes: t.len, storage: "p" };
  let data;
  let typAlign = t.align;
  if (col.type === "numeric") data = numericDataBytes(col.precision, col.scale);
  else if (col.type === "array") {
    data = arrayDataBytes(col.elemType, col.elemCount, col.avgLen);
    typAlign = arrayAlign(col.elemType);
  } else data = Math.max(0, Math.floor(num(col.avgLen)));
  if (data + 1 <= VARLENA_SHORT_MAX) return { len: data + 1, align: 1, varlena: true, short: true, dataBytes: data, storage: t.storage };
  return { len: data + 4, align: typAlign, varlena: true, short: false, dataBytes: data, storage: t.storage };
}

const nullProb = (col) => Math.min(1, Math.max(0, num(col.nullPct) / 100));

/** Header size (t_hoff) with or without a null bitmap. */
export const heapHeader = (natts, hasNulls) => maxalign(HEAP_HEADER + (hasNulls ? Math.ceil(natts / 8) : 0));

/**
 * Layout when every column is present: per-column offset and padding.
 * `sizes` lets the caller pass TOAST-adjusted sizes.
 */
export function layoutAllPresent(cols, sizes = cols.map(valueSize)) {
  let off = 0;
  let padding = 0;
  const rows = cols.map((col, i) => {
    const s = sizes[i];
    const start = align(off, s.align);
    const pad = start - off;
    padding += pad;
    off = start + s.len;
    return { col, size: s, offset: start, pad };
  });
  const data = off;
  const tail = maxalign(data) - data;
  return { rows, data, tail, padding, aligned: maxalign(data) };
}

/**
 * Exact expected data size (incl. alignment and the final MAXALIGN) when each
 * column is NULL independently with its own probability. Dynamic programming
 * over the offset modulo 8, since alignment only depends on that.
 */
export function expectedData(cols, sizes = cols.map(valueSize)) {
  let dist = new Array(MAXALIGN).fill(0);
  dist[0] = 1;
  let expected = 0;
  let expectedPad = 0;
  cols.forEach((col, i) => {
    const p = nullProb(col);
    const q = 1 - p;
    const { len, align: a } = sizes[i];
    const next = new Array(MAXALIGN).fill(0);
    for (let r = 0; r < MAXALIGN; r++) {
      if (!dist[r]) continue;
      const pad = (a - (r % a)) % a;
      next[r] += dist[r] * p;
      next[(r + pad + len) % MAXALIGN] += dist[r] * q;
      expected += dist[r] * q * (pad + len);
      expectedPad += dist[r] * q * pad;
    }
    dist = next;
  });
  const tail = dist.reduce((sum, pr, r) => sum + pr * ((MAXALIGN - r) % MAXALIGN), 0);
  return { data: expected, padding: expectedPad, tail, aligned: expected + tail };
}

/**
 * Decide which values go to TOAST: while the all-present tuple is above the
 * threshold, move the largest extended (then main) varlena out of line.
 * Assumes values do not compress (an upper bound). Returns sizes + toasted flags.
 */
export function applyToast(cols) {
  const sizes = cols.map(valueSize);
  const toasted = cols.map(() => false);
  const natts = cols.length;
  const anyNullable = cols.some((c) => nullProb(c) > 0);
  const tupleLen = () => heapHeader(natts, anyNullable) + layoutAllPresent(cols, sizes).data;
  for (const storage of ["x", "m"]) {
    while (tupleLen() > TOAST_THRESHOLD) {
      let best = -1;
      sizes.forEach((s, i) => {
        if (!toasted[i] && s.varlena && s.storage === storage && s.len > TOAST_POINTER && (best < 0 || s.len > sizes[best].len)) best = i;
      });
      if (best < 0) break;
      toasted[best] = true;
      sizes[best] = { ...sizes[best], len: TOAST_POINTER, align: 1, short: true };
    }
  }
  return { sizes, toasted };
}

/** Suggested order: fixed-width by alignment (8, 4, 2, 1), then varlena; stable within groups. */
export function suggestOrder(cols) {
  const rank = (col) => {
    const s = valueSize(col);
    if (!s.varlena) return 10 - s.align; // 2, 6, 8, 9
    return s.short ? 30 : 20 - s.align; // long varlena before short ones
  };
  return cols
    .map((col, i) => ({ col, i, r: rank(col) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.col);
}

/** Pages needed for `count` items of `itemBytes` with a usable byte budget per page. */
const pagesFor = (count, perPage) => (count <= 0 ? 0 : Math.ceil(count / Math.max(1, perPage)));

/** Btree size for the index columns (in declared order). */
export function estimateBtree(indexCols, rowCount) {
  if (!indexCols.length) return null;
  const sizes = indexCols.map(valueSize);
  const pAnyNull = 1 - indexCols.reduce((acc, c) => acc * (1 - nullProb(c)), 1);
  const header = 8 * (1 - pAnyNull) + 16 * pAnyNull; // IndexTupleData 8, + null bitmap -> 16
  const data = expectedData(indexCols, sizes).aligned;
  const tuple = header + data;
  const maxTuple = 16 + layoutAllPresent(indexCols, sizes).aligned;
  const usable = BLOCK - PAGE_HEADER - BTREE_SPECIAL;
  const leafPerPage = Math.max(1, Math.floor((usable - BLOCK * 0.1) / (tuple + ITEM_ID)) - 1); // fillfactor 90, minus high key
  const innerPerPage = Math.max(2, Math.floor((usable - BLOCK * 0.3) / (tuple + ITEM_ID))); // non-leaf fill 70%
  const leaf = pagesFor(rowCount, leafPerPage);
  let level = leaf;
  let inner = 0;
  let levels = 1;
  while (level > 1) {
    level = Math.ceil(level / innerPerPage);
    inner += level;
    levels++;
  }
  const pages = leaf + inner + 1; // + metapage
  return { tuple, maxTuple, leafPerPage, leaf, inner, levels, pages, bytes: pages * BLOCK, tooBig: maxTuple > BTREE_MAX_ITEM };
}

/** Full estimate for a column list. */
export function estimate({ columns, rowCount, fillfactor = 100 }) {
  const cols = columns.filter((c) => TYPES[c.type]);
  if (!cols.length) return { error: "Add at least one column." };
  if (cols.length > 1600) return { error: "PostgreSQL allows at most 1600 columns." };
  const rows = Math.max(0, Math.floor(num(rowCount)));
  const ff = Math.min(100, Math.max(10, Math.floor(num(fillfactor, 100))));

  const { sizes, toasted } = applyToast(cols);
  const natts = cols.length;
  const pAnyNull = 1 - cols.reduce((acc, c) => acc * (1 - nullProb(c)), 1);
  const headerNoNull = heapHeader(natts, false);
  const headerNull = heapHeader(natts, true);
  const header = headerNoNull * (1 - pAnyNull) + headerNull * pAnyNull;

  const full = layoutAllPresent(cols, sizes);
  const exp = expectedData(cols, sizes);
  const tuple = header + exp.aligned;
  const maxTuple = (pAnyNull > 0 ? headerNull : headerNoNull) + full.aligned;

  const usable = BLOCK - PAGE_HEADER - Math.floor((BLOCK * (100 - ff)) / 100);
  const rowsPerPage = Math.min(MAX_HEAP_TUPLES, Math.max(0, Math.floor(usable / (tuple + ITEM_ID))));
  const heapPages = rowsPerPage > 0 ? pagesFor(rows, rowsPerPage) : NaN;

  // TOAST table: chunks of 1996 bytes, about 4 chunk rows per page.
  let toastBytes = 0;
  cols.forEach((c, i) => {
    if (!toasted[i]) return;
    const raw = valueSize(c).dataBytes;
    const full = Math.floor(raw / TOAST_CHUNK);
    const rest = raw % TOAST_CHUNK;
    const perValue = full * (BLOCK - PAGE_HEADER) / 4 + (rest ? maxalign(24 + 8 + 4 + rest) + ITEM_ID : 0);
    toastBytes += rows * (1 - nullProb(c)) * perValue;
  });
  const toastPages = Math.ceil(toastBytes / (BLOCK - PAGE_HEADER));

  const suggested = suggestOrder(cols);
  const sugToast = applyToast(suggested);
  const sugExp = expectedData(suggested, sugToast.sizes);
  const sugFull = layoutAllPresent(suggested, sugToast.sizes);
  const sugTuple = header + sugExp.aligned;
  const savesBytes = tuple - sugTuple;
  const sugRowsPerPage = Math.min(MAX_HEAP_TUPLES, Math.floor(usable / (sugTuple + ITEM_ID)));
  const sugPages = sugRowsPerPage > 0 ? pagesFor(rows, sugRowsPerPage) : NaN;

  const indexCols = cols.filter((c) => c.indexed);
  const btree = estimateBtree(indexCols, rows);

  const warnings = [];
  if (rowsPerPage === 0) warnings.push("A row does not fit on an 8kB page even after TOAST: too many fixed-width columns.");
  if (toasted.some(Boolean)) {
    warnings.push(
      `Rows exceed ~${TOAST_THRESHOLD} bytes, so ${cols.filter((_, i) => toasted[i]).map((c) => c.name || c.type).join(", ")} move to the TOAST table (${TOAST_POINTER}-byte pointer inline). Real values often compress, so TOAST is likely smaller than shown.`,
    );
  } else if (maxTuple > TOAST_THRESHOLD * 0.8) {
    warnings.push(`Rows are close to the ~${TOAST_THRESHOLD}-byte TOAST threshold; slightly larger values will be compressed or moved out of line.`);
  }
  if (btree?.tooBig) warnings.push(`Index tuples can exceed the btree limit of ~${BTREE_MAX_ITEM} bytes; inserts with such keys will fail.`);
  if (cols.some((c) => c.type === "numeric")) warnings.push("numeric sizes assume full precision; values with fewer digits are smaller.");

  return {
    cols,
    sizes,
    toasted,
    natts,
    pAnyNull,
    header,
    headerNoNull,
    headerNull,
    full,
    expected: exp,
    tuple,
    maxTuple,
    fillfactor: ff,
    rows,
    rowsPerPage,
    heapPages,
    heapBytes: heapPages * BLOCK,
    toastPages,
    toastBytes: toastPages * BLOCK,
    suggestion: {
      cols: suggested,
      full: sugFull,
      expected: sugExp,
      tuple: sugTuple,
      savesBytes,
      rowsPerPage: sugRowsPerPage,
      heapBytes: sugPages * BLOCK,
      better: savesBytes > 0.01,
    },
    btree,
    warnings,
  };
}

/** SQL type name for DDL. */
export function sqlType(col) {
  if (col.type === "numeric") {
    const p = Math.floor(num(col.precision, NaN));
    const s = Math.floor(num(col.scale, 0));
    return Number.isFinite(p) ? `numeric(${p},${s})` : "numeric";
  }
  if (col.type === "array") return `${TYPES[col.elemType]?.sql ?? "integer"}[]`;
  return TYPES[col.type]?.sql ?? "text";
}

const ident = (name) => (/^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${String(name).replace(/"/g, '""')}"`);

/** CREATE TABLE in the given column order. */
export function createTable(tableName, cols, fillfactor = 100) {
  const width = Math.max(...cols.map((c, i) => ident(c.name || `col${i + 1}`).length));
  const lines = cols.map((c, i) => `  ${ident(c.name || `col${i + 1}`).padEnd(width)} ${sqlType(c)}`);
  const ff = fillfactor < 100 ? ` WITH (fillfactor = ${fillfactor})` : "";
  return `CREATE TABLE ${ident(tableName || "my_table")} (\n${lines.join(",\n")}\n)${ff};`;
}

/** Human-readable bytes. */
export function fmtBytes(b) {
  if (!Number.isFinite(b)) return "—";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let v = b;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}
