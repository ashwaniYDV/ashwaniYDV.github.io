/**
 * Sample inputs: a stock server's `SHOW ALL` (psql aligned) against a tuned
 * server's `SELECT name, setting, unit FROM pg_settings` (CSV). Trimmed to a
 * few dozen settings. Several values differ only in units (128MB vs 16384 × 8kB).
 */
const showAll = [
  ["archive_mode", "off", "Allows archiving of WAL files using archive_command."],
  ["autovacuum", "on", "Starts the autovacuum subprocess."],
  ["autovacuum_max_workers", "3", "Sets the maximum number of simultaneously running autovacuum worker processes."],
  ["autovacuum_naptime", "1min", "Time to sleep between autovacuum runs."],
  ["autovacuum_vacuum_cost_delay", "2ms", "Vacuum cost delay in milliseconds, for autovacuum."],
  ["autovacuum_vacuum_scale_factor", "0.2", "Number of tuple updates or deletes prior to vacuum as a fraction of reltuples."],
  ["checkpoint_completion_target", "0.9", "Time spent flushing dirty buffers during checkpoint, as fraction of checkpoint interval."],
  ["checkpoint_timeout", "5min", "Sets the maximum time between automatic WAL checkpoints."],
  ["DateStyle", "ISO, MDY", "Sets the display format for date and time values."],
  ["default_statistics_target", "100", "Sets the default statistics target."],
  ["effective_cache_size", "4GB", "Sets the planner's assumption about the total size of the data caches."],
  ["effective_io_concurrency", "1", "Number of simultaneous requests that can be handled efficiently by the disk subsystem."],
  ["huge_pages", "try", "Use of huge pages on Linux or Windows."],
  ["idle_in_transaction_session_timeout", "0", "Sets the maximum allowed idle time between queries, when in a transaction."],
  ["jit", "on", "Allow JIT compilation."],
  ["log_min_duration_statement", "-1", "Sets the minimum execution time above which all statements will be logged."],
  ["log_rotation_age", "1d", "Sets the amount of time to wait before forcing log file rotation."],
  ["maintenance_work_mem", "64MB", "Sets the maximum memory to be used for maintenance operations."],
  ["max_connections", "100", "Sets the maximum number of concurrent connections."],
  ["max_parallel_workers_per_gather", "2", "Sets the maximum number of parallel processes per executor node."],
  ["max_wal_size", "1GB", "Sets the WAL size that triggers a checkpoint."],
  ["min_wal_size", "80MB", "Sets the minimum size to shrink the WAL to."],
  ["random_page_cost", "4", "Sets the planner's estimate of the cost of a nonsequentially fetched disk page."],
  ["search_path", '"$user", public', "Sets the schema search order for names that are not schema-qualified."],
  ["shared_buffers", "128MB", "Sets the number of shared memory buffers used by the server."],
  ["shared_preload_libraries", "", "Lists shared libraries to preload into server."],
  ["statement_timeout", "0", "Sets the maximum allowed duration of any statement."],
  ["synchronous_commit", "on", "Sets the current transaction's synchronization level."],
  ["temp_buffers", "8MB", "Sets the maximum number of temporary buffers used by each session."],
  ["TimeZone", "UTC", "Sets the time zone for displaying and interpreting time stamps."],
  ["track_io_timing", "off", "Collects timing statistics for database I/O activity."],
  ["wal_buffers", "4MB", "Sets the number of disk-page buffers in shared memory for WAL."],
  ["wal_level", "replica", "Sets the level of information written to the WAL."],
  ["work_mem", "4MB", "Sets the maximum memory to be used for query workspaces."],
];

const nameW = Math.max(4, ...showAll.map((r) => r[0].length));
const setW = Math.max(7, ...showAll.map((r) => r[1].length));
const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));

export const SAMPLE_LEFT = [
  ` ${pad("name", nameW)} | ${pad("setting", setW)} | description`,
  `-${"-".repeat(nameW)}-+-${"-".repeat(setW)}-+-${"-".repeat(40)}`,
  ...showAll.map(([n, s, d]) => ` ${pad(n, nameW)} | ${pad(s, setW)} | ${d}`),
  `(${showAll.length} rows)`,
].join("\n");

const pgSettings = [
  ["archive_mode", "on", ""],
  ["autovacuum", "on", ""],
  ["autovacuum_max_workers", "6", ""],
  ["autovacuum_naptime", "60", "s"],
  ["autovacuum_vacuum_cost_delay", "2", "ms"],
  ["autovacuum_vacuum_scale_factor", "0.05", ""],
  ["checkpoint_completion_target", "0.9", ""],
  ["checkpoint_timeout", "900", "s"],
  ["DateStyle", "ISO, MDY", ""],
  ["default_statistics_target", "100", ""],
  ["effective_cache_size", "3145728", "8kB"],
  ["effective_io_concurrency", "200", ""],
  ["huge_pages", "try", ""],
  ["idle_in_transaction_session_timeout", "600000", "ms"],
  ["jit", "off", ""],
  ["log_min_duration_statement", "500", "ms"],
  ["log_rotation_age", "1440", "min"],
  ["maintenance_work_mem", "1048576", "kB"],
  ["max_connections", "400", ""],
  ["max_parallel_workers_per_gather", "2", ""],
  ["max_wal_size", "16384", "MB"],
  ["min_wal_size", "80", "MB"],
  ["random_page_cost", "1.1", ""],
  ["search_path", '"$user", public', ""],
  ["shared_buffers", "1048576", "8kB"],
  ["shared_preload_libraries", "pg_stat_statements", ""],
  ["statement_timeout", "0", "ms"],
  ["synchronous_commit", "on", ""],
  ["temp_buffers", "1024", "8kB"],
  ["TimeZone", "UTC", ""],
  ["track_io_timing", "on", ""],
  ["wal_buffers", "2048", "8kB"],
  ["wal_compression", "lz4", ""],
  ["wal_level", "replica", ""],
  ["work_mem", "16384", "kB"],
];

const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const SAMPLE_RIGHT = ["name,setting,unit", ...pgSettings.map((r) => r.map(csv).join(","))].join("\n");
