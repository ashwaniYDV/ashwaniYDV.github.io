/**
 * Sample before/after plans: EXPLAIN (ANALYZE, BUFFERS) of
 *
 *   SELECT o.id, o.total, c.name
 *   FROM orders o JOIN customers c ON c.id = o.customer_id
 *   WHERE o.status = 'pending' AND o.created_at > now() - interval '1 day'
 *   ORDER BY o.created_at DESC
 *   LIMIT 50;
 *
 * before and after `CREATE INDEX ON orders (status, created_at);`.
 * Hand-built but internally consistent (times, loops and cumulative buffers).
 */
export const SAMPLE_BEFORE = `                                                         QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=48210.55..48210.68 rows=50 width=48) (actual time=412.881..412.902 rows=50 loops=1)
   Buffers: shared hit=2311 read=36104
   ->  Sort  (cost=48210.55..48213.80 rows=1300 width=48) (actual time=412.879..412.890 rows=50 loops=1)
         Sort Key: o.created_at DESC
         Sort Method: top-N heapsort  Memory: 32kB
         Buffers: shared hit=2311 read=36104
         ->  Hash Join  (cost=1250.00..48167.37 rows=1300 width=48) (actual time=18.402..411.950 rows=1874 loops=1)
               Hash Cond: (o.customer_id = c.id)
               Buffers: shared hit=2311 read=36104
               ->  Seq Scan on orders o  (cost=0.00..46900.00 rows=1300 width=28) (actual time=0.031..392.611 rows=1874 loops=1)
                     Filter: ((status = 'pending'::text) AND (created_at > (now() - '1 day'::interval)))
                     Rows Removed by Filter: 1998126
                     Buffers: shared hit=1046 read=35854
               ->  Hash  (cost=750.00..750.00 rows=40000 width=24) (actual time=18.250..18.251 rows=40000 loops=1)
                     Buckets: 65536  Batches: 1  Memory Usage: 2700kB
                     Buffers: shared hit=1265 read=250
                     ->  Seq Scan on customers c  (cost=0.00..750.00 rows=40000 width=24) (actual time=0.012..7.904 rows=40000 loops=1)
                           Buffers: shared hit=1265 read=250
 Planning:
   Buffers: shared hit=24
 Planning Time: 0.412 ms
 Execution Time: 413.010 ms
(21 rows)
`;

export const SAMPLE_AFTER = `                                                                          QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.85..215.40 rows=50 width=48) (actual time=0.048..0.611 rows=50 loops=1)
   Buffers: shared hit=212 read=9
   ->  Nested Loop  (cost=0.85..5579.65 rows=1300 width=48) (actual time=0.047..0.602 rows=50 loops=1)
         Buffers: shared hit=212 read=9
         ->  Index Scan Backward using orders_status_created_at_idx on orders o  (cost=0.43..1210.40 rows=1300 width=28) (actual time=0.031..0.190 rows=50 loops=1)
               Index Cond: ((status = 'pending'::text) AND (created_at > (now() - '1 day'::interval)))
               Buffers: shared hit=57 read=9
         ->  Index Scan using customers_pkey on customers c  (cost=0.42..3.36 rows=1 width=24) (actual time=0.007..0.007 rows=1 loops=50)
               Index Cond: (id = o.customer_id)
               Buffers: shared hit=155
 Planning:
   Buffers: shared hit=31 read=2
 Planning Time: 0.538 ms
 Execution Time: 0.652 ms
(14 rows)
`;
