/**
 * Sample pg_stat_statements export (PostgreSQL 16, CSV with header) from a
 * made-up shop database. Hand-built: totals = calls × mean, and the mix covers
 * every flag (temp spills, cold reads, slow reports, N+1 lookups, jittery calls).
 */
const header =
  "queryid,calls,rows,total_exec_time,mean_exec_time,stddev_exec_time,min_exec_time,max_exec_time," +
  "shared_blks_hit,shared_blks_read,shared_blks_dirtied,shared_blks_written,temp_blks_read,temp_blks_written,username,dbname,query";

const rows = [
  [
    "-6203394717466131874", 1840, 18400, 1214400.0, 660.0, 410.5, 120.2, 4210.8, 9620000, 3180000, 120, 0, 0, 0, "app", "shop",
    `"SELECT o.id, o.created_at, o.total
FROM orders o
WHERE o.customer_id = $1
  AND o.status = $2
ORDER BY o.created_at DESC
LIMIT $3"`,
  ],
  [
    "4471820099120051230", 96, 960, 655200.0, 6825.0, 2240.3, 3120.4, 14890.1, 4120000, 980000, 0, 0, 1920000, 1920000, "reporting", "shop",
    `"SELECT c.id, c.name, sum(l.amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN line_items l ON l.order_id = o.id
WHERE o.created_at > now() - $1::interval
GROUP BY c.id
ORDER BY revenue DESC
LIMIT $2"`,
  ],
  [
    "-115823044901122391", 2410000, 2410000, 433800.0, 0.18, 0.09, 0.03, 18.4, 9640000, 1200, 0, 0, 0, 0, "app", "shop",
    `"SELECT id, name, price FROM products WHERE id = $1"`,
  ],
  [
    "7720011450312877410", 412000, 412000, 305000.0, 0.74, 3.9, 0.21, 980.6, 3296000, 4800, 41200, 0, 0, 0, "app", "shop",
    `"UPDATE carts SET updated_at = now(), item_count = item_count + $1 WHERE id = $2"`,
  ],
  [
    "1934451120998812773", 24, 24, 268800.0, 11200.0, 1650.0, 8800.0, 15600.0, 210000, 2650000, 0, 0, 0, 0, "reporting", "shop",
    `"SELECT date_trunc($1, created_at) AS day, count(*), sum(total)
FROM orders
WHERE created_at >= $2 AND created_at < $3
GROUP BY 1
ORDER BY 1"`,
  ],
  [
    "-3990127745510038826", 51200, 1536000, 143360.0, 2.8, 1.1, 0.9, 61.2, 2460000, 92000, 0, 0, 0, 0, "app", "shop",
    `"SELECT l.product_id, l.quantity, l.amount FROM line_items l WHERE l.order_id = $1"`,
  ],
  [
    "8810034471265590012", 1210, 1210, 108900.0, 90.0, 310.4, 2.1, 2950.0, 1450000, 14000, 0, 0, 0, 0, "app", "shop",
    `"SELECT count(*) FROM orders WHERE customer_id = $1 AND status = ANY($2)"`,
  ],
  [
    "2290041198822345120", 6, 6, 82800.0, 13800.0, 410.0, 13200.0, 14400.0, 98000, 1840000, 0, 0, 640000, 640000, "etl", "shop",
    `"SELECT * FROM events WHERE payload->>'type' = $1 ORDER BY created_at"`,
  ],
  [
    "-881245019234556781", 980000, 980000, 49000.0, 0.05, 0.02, 0.01, 4.1, 2940000, 0, 0, 0, 0, 0, "app", "shop",
    `"SELECT value FROM settings WHERE key = $1"`,
  ],
  [
    "5501287734456100931", 8800, 8800, 31680.0, 3.6, 0.8, 2.2, 22.4, 412000, 1900, 8800, 140, 0, 0, "app", "shop",
    `"INSERT INTO orders (customer_id, status, total, created_at) VALUES ($1, $2, $3, now()) RETURNING id"`,
  ],
  [
    "-7182349001284450012", 14, 4200000, 23100.0, 1650.0, 220.0, 1210.0, 2100.0, 44000, 610000, 0, 0, 0, 2400, "etl", "shop",
    `"COPY line_items TO STDOUT WITH (FORMAT csv)"`,
  ],
  [
    "3398001274456120087", 460, 0, 5520.0, 12.0, 41.0, 0.4, 610.0, 52000, 3100, 920, 0, 0, 0, "app", "shop",
    `"DELETE FROM sessions WHERE expires_at < now()"`,
  ],
];

export const SAMPLE_CSV = [header, ...rows.map((r) => r.join(","))].join("\n");
