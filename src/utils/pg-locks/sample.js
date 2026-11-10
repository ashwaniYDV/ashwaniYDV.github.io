/** Sample inputs for the wait-for graph. */

// A classic DDL pile-up (idle-in-transaction -> ALTER TABLE -> everyone else) plus a two-way deadlock
// caught before deadlock_timeout fires.
export const SAMPLE_BLOCKING = `  pid  | blocked_by |        state        | wait_event_type |  wait_event   | xact_age |                 query
-------+------------+---------------------+-----------------+---------------+----------+---------------------------------------
 4101  | {}         | idle in transaction | Client          | ClientRead    | 00:41:07 | SELECT * FROM orders WHERE id = 42
 4102  | {4101}     | active              | Lock            | relation      | 00:02:13 | ALTER TABLE orders ADD COLUMN note text
 4103  | {4102}     | active              | Lock            | relation      | 00:01:58 | SELECT count(*) FROM orders
 4104  | {4102}     | active              | Lock            | relation      | 00:01:40 | UPDATE orders SET status = 'paid' ...
 4105  | {4102}     | active              | Lock            | relation      | 00:00:55 | INSERT INTO orders VALUES (...)
 4201  | {4202}     | active              | Lock            | transactionid | 00:00:01 | UPDATE accounts SET bal = bal - 10 WHERE id = 2
 4202  | {4201}     | active              | Lock            | transactionid | 00:00:01 | UPDATE accounts SET bal = bal + 10 WHERE id = 1
(7 rows)
`;

// pg_locks joined with pg_stat_activity: the same DDL queue, plus a row-lock chain.
export const SAMPLE_LOCKS = `pid,locktype,database,relation,page,tuple,virtualxid,transactionid,mode,granted,state,query
4101,relation,16384,orders,,,,,AccessShareLock,t,idle in transaction,SELECT * FROM orders WHERE id = 42
4101,virtualxid,,,,,5/120,,ExclusiveLock,t,idle in transaction,SELECT * FROM orders WHERE id = 42
4102,relation,16384,orders,,,,,AccessExclusiveLock,f,active,ALTER TABLE orders ADD COLUMN note text
4103,relation,16384,orders,,,,,AccessShareLock,f,active,SELECT count(*) FROM orders
4104,relation,16384,orders,,,,,RowExclusiveLock,f,active,UPDATE orders SET status = 'paid' WHERE id = 7
4301,relation,16384,accounts,,,,,RowExclusiveLock,t,idle in transaction,UPDATE accounts SET bal = 0 WHERE id = 9
4301,transactionid,,,,,,90011,ExclusiveLock,t,idle in transaction,UPDATE accounts SET bal = 0 WHERE id = 9
4302,relation,16384,accounts,,,,,RowExclusiveLock,t,active,UPDATE accounts SET bal = 5 WHERE id = 9
4302,tuple,16384,accounts,0,5,,,ExclusiveLock,t,active,UPDATE accounts SET bal = 5 WHERE id = 9
4302,transactionid,,,,,,90011,ShareLock,f,active,UPDATE accounts SET bal = 5 WHERE id = 9
4303,relation,16384,accounts,,,,,RowExclusiveLock,t,active,DELETE FROM accounts WHERE id = 9
4303,tuple,16384,accounts,0,5,,,ExclusiveLock,f,active,DELETE FROM accounts WHERE id = 9
`;

export const BLOCKING_QUERY = `-- Who blocks whom (PG 9.6+). Includes the blockers themselves.
SELECT pid,
       pg_blocking_pids(pid) AS blocked_by,
       state, wait_event_type, wait_event,
       date_trunc('second', now() - xact_start) AS xact_age,
       left(query, 60) AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0
   OR pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity);`;

export const LOCKS_QUERY = `-- Raw lock table joined with sessions (can be long on busy servers)
SELECT l.pid, l.locktype, l.database, l.relation::regclass AS relation,
       l.page, l.tuple, l.virtualxid, l.transactionid,
       l.classid, l.objid, l.objsubid, l.mode, l.granted,
       a.state, left(a.query, 60) AS query
FROM pg_locks l
LEFT JOIN pg_stat_activity a USING (pid)
WHERE l.pid <> pg_backend_pid();`;
