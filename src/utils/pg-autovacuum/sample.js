/** Sample inputs for the autovacuum calculator (made-up but realistic numbers). */

export const SAMPLE_TABLE = {
  schema: "public",
  table: "orders",
  reltuples: "48000000",
  n_dead_tup: "9800000",
  n_mod_since_analyze: "4100000",
  n_ins_since_vacuum: "1900000",
  frozenPct: "60",
  vacuumTarget: "500000",
  analyzeTarget: "250000",
  mode: "fixed",
};

export const BLANK_TABLE = {
  schema: "",
  table: "",
  reltuples: "",
  n_dead_tup: "",
  n_mod_since_analyze: "",
  n_ins_since_vacuum: "",
  frozenPct: "",
  vacuumTarget: "",
  analyzeTarget: "",
  mode: "fixed",
};

export const SAMPLE_BULK = ` schemaname |     relname      | reltuples | n_dead_tup | n_mod_since_analyze | n_ins_since_vacuum | relpages |                 reloptions
------------+------------------+-----------+------------+---------------------+--------------------+----------+---------------------------------------------
 public     | orders           |  48000000 |    3100000 |             2650000 |            1900000 |   612000 |
 public     | order_items      | 1.9e+08   |   41000000 |             9800000 |             450000 |  2100000 |
 public     | sessions         |    820000 |     240000 |              610000 |                 12 |    15400 | autovacuum_vacuum_scale_factor=0.05
 public     | events           | 3.1e+08   |      90000 |            41000000 |           62000000 |  4300000 | autovacuum_vacuum_insert_scale_factor=0.05
 audit      | login_history    |  12500000 |       2100 |               88000 |              88000 |   160000 |
 public     | feature_flags    |       140 |         61 |                  14 |                  0 |        2 |
 public     | job_queue        |      5000 |      18000 |               21000 |              21000 |      310 | autovacuum_enabled=false
 billing    | invoices         |        -1 |          0 |                1200 |               1200 |        0 |
(8 rows)
`;
