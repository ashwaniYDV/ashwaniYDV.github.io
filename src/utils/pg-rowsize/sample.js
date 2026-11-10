/** Sample table for the row size estimator: a typical "added over time" column order with padding holes. */

let n = 0;
const col = (name, type, extra = {}) => ({
  id: `s${++n}`,
  name,
  type,
  avgLen: "",
  precision: "",
  scale: "",
  elemType: "int4",
  elemCount: "",
  nullPct: "0",
  indexed: false,
  ...extra,
});

export const SAMPLE_TABLE = {
  tableName: "orders",
  rowCount: "50000000",
  fillfactor: "100",
  columns: [
    col("id", "int8", { indexed: true }),
    col("is_paid", "bool"),
    col("customer_id", "int8"),
    col("status", "int2"),
    col("created_at", "timestamptz"),
    col("quantity", "int4"),
    col("amount", "numeric", { precision: "12", scale: "2" }),
    col("is_gift", "bool"),
    col("shipped_at", "timestamptz", { nullPct: "30" }),
    col("currency", "text", { avgLen: "3" }),
    col("external_ref", "uuid"),
    col("notes", "text", { avgLen: "140", nullPct: "70" }),
    col("tag_ids", "array", { elemType: "int4", elemCount: "4" }),
    col("region_id", "int2"),
  ],
};

export const BLANK_TABLE = {
  tableName: "my_table",
  rowCount: "1000000",
  fillfactor: "100",
  columns: [col("id", "int8", { id: "b1", indexed: true })],
};

export const newColumn = (id) => col("", "int4", { id, name: "" });
