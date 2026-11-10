export const SAMPLE_QUERY = `/* app: checkout, route: /cart */
SELECT o.id, o.total_cents, c.email
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.customer_id = 48213
   AND o.status IN ('paid', 'shipped', 'refunded')
   AND o.created_at >= DATE '2026-10-01'
   AND o.total_cents > -1
 ORDER BY o.created_at DESC
 LIMIT 25;`;

export const SAMPLE_LOG = `2026-11-10 09:14:02.118 UTC [4121] LOG:  duration: 3.214 ms  statement: SELECT * FROM users WHERE id = 42
2026-11-10 09:14:02.254 UTC [4122] LOG:  duration: 2.977 ms  statement: select * from users where id=7
2026-11-10 09:14:03.001 UTC [4121] LOG:  duration: 1.020 ms  statement: SELECT * FROM users WHERE id = 1093 -- from api
2026-11-10 09:14:03.410 UTC [4130] LOG:  duration: 18.400 ms  statement: SELECT id, total_cents FROM orders WHERE customer_id = 42 AND status IN ('paid', 'shipped') ORDER BY created_at DESC LIMIT 20
2026-11-10 09:14:03.777 UTC [4131] LOG:  duration: 22.871 ms  statement: SELECT id, total_cents FROM orders WHERE customer_id = 8 AND status IN ('paid') ORDER BY created_at DESC LIMIT 50
2026-11-10 09:14:04.020 UTC [4130] LOG:  duration: 25.003 ms  statement: SELECT id, total_cents FROM orders WHERE customer_id = 99 AND status IN ('paid', 'shipped', 'refunded') ORDER BY created_at DESC LIMIT 20
2026-11-10 09:14:04.512 UTC [4140] LOG:  duration: 0.412 ms  statement: UPDATE sessions SET last_seen = now() WHERE token = 'f1e2d3'
2026-11-10 09:14:04.900 UTC [4141] LOG:  duration: 0.398 ms  statement: UPDATE sessions SET last_seen = now() WHERE token = 'a9b8c7'
2026-11-10 09:14:05.230 UTC [4122] LOG:  duration: 2.101 ms  statement: SELECT * FROM users WHERE email = 'ada@example.com'
2026-11-10 09:14:05.611 UTC [4150] LOG:  duration: 140.220 ms  statement: INSERT INTO events (user_id, kind, payload) VALUES (42, 'click', '{"x": 1}')
2026-11-10 09:14:05.802 UTC [4151] LOG:  duration: 131.090 ms  statement: insert into events (user_id, kind, payload) values (7, 'view', '{}')
2026-11-10 09:14:06.004 UTC [4121] LOG:  duration: 2.880 ms  statement: SELECT * FROM users WHERE id = 5`;
