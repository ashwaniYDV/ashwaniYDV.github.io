/** Sample pg_stat_replication output (psql aligned) for the lag helper. */
export const SAMPLE_REPLICATION = ` pid  | application_name |  client_addr  |   state   | sent_lsn    | write_lsn   | flush_lsn   | replay_lsn  | sync_state
------+------------------+---------------+-----------+-------------+-------------+-------------+-------------+------------
 4211 | replica-a        | 10.0.1.21     | streaming | 16/B374D848 | 16/B374D848 | 16/B374D848 | 16/B3740000 | sync
 4219 | replica-b        | 10.0.2.37     | streaming | 16/B2F10000 | 16/B2E00000 | 16/B2C00000 | 16/A9000000 | async
 5307 | analytics        | 10.0.3.5      | catchup   | 15/F0000000 | 15/EFFF0000 | 15/EFFF0000 | 15/E1000000 | async
(3 rows)
`;

export const SAMPLE_CURRENT = "16/B3750F00";

export const REPLICATION_QUERY = `-- On the primary:
SELECT pg_current_wal_lsn();

SELECT pid, application_name, client_addr, state,
       sent_lsn, write_lsn, flush_lsn, replay_lsn,
       write_lag, flush_lag, replay_lag, sync_state
FROM pg_stat_replication;`;

export const SAMPLE_STATE = {
  a: "16/B374D848",
  b: "16/A9000000",
  delta: "16MB",
  tli: "1",
  segMb: "16",
  segName: "000000010000001600000002",
  repl: SAMPLE_REPLICATION,
  current: SAMPLE_CURRENT,
};
