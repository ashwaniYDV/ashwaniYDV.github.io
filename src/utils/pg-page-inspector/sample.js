/**
 * Sample pageinspect output, formatted the way psql prints it (aligned).
 *
 * Scenario on table t(id int, val text), block 0:
 *   xid 740 inserted ids 1, 2, 3, 5 (val NULL) and 6.
 *   id 1 was HOT-updated twice (741, 742); pruning turned lp 1 into a redirect to lp 4.
 *   id 2 is locked FOR UPDATE by xid 744; id 3 was deleted by 743.
 *   lp 6 held an aborted insert, now a dead line pointer after pruning.
 *   id 4 is being inserted by xid 745 (still running, no hint bits).
 *   id 6 was updated by 746 and the new version went to block 1.
 */

/** psql "aligned" rendering of a result set. */
export function formatAligned(columns, rows) {
  const cells = rows.map((r) => columns.map((c) => (r[c] === null || r[c] === undefined ? "" : String(r[c]))));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const numeric = columns.map((_, i) => cells.every((r) => r[i] === "" || /^-?\d+$/.test(r[i])));
  const pad = (s, i, center) => {
    const w = widths[i];
    if (center) {
      const left = Math.floor((w - s.length) / 2);
      return " ".repeat(left) + s + " ".repeat(w - s.length - left);
    }
    return numeric[i] ? s.padStart(w) : s.padEnd(w);
  };
  const line = (vals, center) => ` ${vals.map((v, i) => pad(v, i, center)).join(" | ")}`.replace(/\s+$/, "");
  return [
    line(columns, true),
    widths.map((w) => "-".repeat(w + 2)).join("+").replace(/^-/, "-"),
    ...cells.map((r) => line(r, false)),
    `(${rows.length} row${rows.length === 1 ? "" : "s"})`,
  ].join("\n");
}

const HEAP_COLUMNS = [
  "lp", "lp_off", "lp_flags", "lp_len", "t_xmin", "t_xmax", "t_field3", "t_ctid",
  "t_infomask2", "t_infomask", "t_hoff", "t_bits", "t_oid", "t_data",
];

const heapRow = (lp, lp_off, lp_flags, lp_len, rest = {}) => ({ lp, lp_off, lp_flags, lp_len, ...rest });
const tup = (t_xmin, t_xmax, t_ctid, t_infomask2, t_infomask, t_data, extra = {}) => ({
  t_xmin, t_xmax, t_field3: 0, t_ctid, t_infomask2, t_infomask, t_hoff: 24, t_bits: null, t_oid: null, t_data, ...extra,
});

const HEAP_ROWS = [
  heapRow(1, 4, 2, 0),
  heapRow(2, 8152, 1, 33, tup(740, 744, "(0,2)", 8194, 450, "\\x020000000b62657461")),
  heapRow(3, 8112, 1, 34, tup(740, 743, "(0,3)", 8194, 1282, "\\x030000000d67616d6d61")),
  heapRow(4, 8072, 1, 35, tup(741, 742, "(0,5)", 49154, 9474, "\\x010000000f616c70686132")),
  heapRow(5, 8032, 1, 35, tup(742, 0, "(0,5)", 32770, 10498, "\\x010000000f616c70686133")),
  heapRow(6, 0, 3, 0),
  heapRow(7, 7992, 1, 34, tup(745, 0, "(0,7)", 2, 2050, "\\x040000000d64656c7461")),
  heapRow(8, 7960, 1, 28, tup(740, 0, "(0,8)", 2, 2305, "\\x05000000", { t_bits: "10000000" })),
  heapRow(9, 7928, 1, 32, tup(740, 746, "(1,3)", 2, 1282, "\\x0600000009657073")),
];

const HEADER_COLUMNS = ["lsn", "checksum", "flags", "lower", "upper", "special", "pagesize", "version", "prune_xid"];
const HEADER_ROWS = [
  { lsn: "0/1A2B3C8", checksum: 0, flags: 0, lower: 60, upper: 7928, special: 8192, pagesize: 8192, version: 4, prune_xid: 743 },
];

export const SAMPLE_HEAP = [
  "test=# SELECT * FROM page_header(get_raw_page('t', 0));",
  formatAligned(HEADER_COLUMNS, HEADER_ROWS),
  "",
  "test=# SELECT * FROM heap_page_items(get_raw_page('t', 0));",
  formatAligned(HEAP_COLUMNS, HEAP_ROWS),
  "",
].join("\n");

const BT_COLUMNS = ["itemoffset", "ctid", "itemlen", "nulls", "vars", "data", "dead", "htid", "tids"];
const BT_ROWS = [
  { itemoffset: 1, ctid: "(0,4)", itemlen: 16, nulls: "f", vars: "f", data: "01 00 00 00 00 00 00 00", dead: "f", htid: "(0,4)", tids: null },
  { itemoffset: 2, ctid: "(0,2)", itemlen: 16, nulls: "f", vars: "f", data: "02 00 00 00 00 00 00 00", dead: "f", htid: "(0,2)", tids: null },
  { itemoffset: 3, ctid: "(0,3)", itemlen: 16, nulls: "f", vars: "f", data: "03 00 00 00 00 00 00 00", dead: "t", htid: "(0,3)", tids: null },
  { itemoffset: 4, ctid: "(16,8194)", itemlen: 32, nulls: "f", vars: "f", data: "04 00 00 00 00 00 00 00", dead: "f", htid: "(0,7)", tids: '{"(0,7)","(1,3)"}' },
  { itemoffset: 5, ctid: "(0,9)", itemlen: 16, nulls: "f", vars: "f", data: "06 00 00 00 00 00 00 00", dead: "f", htid: "(0,9)", tids: null },
];
const BT_HEADER = [
  { lsn: "0/1A2B4F0", checksum: 0, flags: 0, lower: 44, upper: 8080, special: 8176, pagesize: 8192, version: 4, prune_xid: 0 },
];

export const SAMPLE_BTREE = [
  "test=# SELECT * FROM page_header(get_raw_page('t_id_idx', 1));",
  formatAligned(HEADER_COLUMNS, BT_HEADER),
  "",
  "test=# SELECT * FROM bt_page_items('t_id_idx', 1);",
  formatAligned(BT_COLUMNS, BT_ROWS),
  "",
].join("\n");
