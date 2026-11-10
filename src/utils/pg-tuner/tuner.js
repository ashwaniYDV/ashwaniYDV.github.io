/**
 * postgresql.conf starting-point calculator (pure logic, no React).
 *
 * Formulas are the commonly published rules of thumb from the PostgreSQL docs,
 * the PostgreSQL wiki ("Tuning Your PostgreSQL Server") and conference talks,
 * written from scratch here. They are starting points, not a substitute for
 * measuring your own workload.
 */

export const VERSIONS = [13, 14, 15, 16, 17, 18];

export const WORKLOADS = [
  { id: "web", label: "Web app", hint: "many short queries, mostly cached reads" },
  { id: "oltp", label: "OLTP", hint: "many small read/write transactions" },
  { id: "dw", label: "Data warehouse", hint: "few large analytic queries, bulk loads" },
  { id: "mixed", label: "Mixed", hint: "transactions plus some reporting" },
  { id: "desktop", label: "Desktop / dev", hint: "PostgreSQL shares the machine with other apps" },
];

export const STORAGE = [
  { id: "ssd", label: "Local SSD / NVMe" },
  { id: "network", label: "Network / cloud block storage" },
  { id: "hdd", label: "Spinning disks (HDD)" },
];

/** Typical max_connections when the user leaves it blank. */
export const DEFAULT_CONNECTIONS = { web: 200, oltp: 300, dw: 40, mixed: 100, desktop: 20 };

const KB = 1;
const MB = 1024 * KB;
const GB = 1024 * MB;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Format a size in kB the way postgresql.conf accepts it (kB / MB / GB). */
export function formatMemory(kb) {
  const v = Math.max(0, Math.floor(kb));
  if (v >= GB && v % GB === 0) return `${v / GB}GB`;
  if (v >= MB) return `${Math.floor(v / MB)}MB`;
  return `${v}kB`;
}

/** Round down to a whole MB (or keep kB for tiny values) so output stays readable. */
const roundMb = (kb) => (kb >= MB ? Math.floor(kb / MB) * MB : Math.max(64, Math.floor(kb)));

/** Same, but round to whole GB above 4GB. */
const roundNice = (kb) => (kb >= 4 * GB ? Math.floor(kb / GB) * GB : roundMb(kb));

/**
 * Validate and normalise raw form input. Returns { input } or { error }.
 * `ramGb` and `cpus` may be strings from <input>.
 */
export function normalizeInput(raw) {
  const version = Number(raw.version);
  const ramGb = Number(raw.ramGb);
  const cpus = Math.floor(Number(raw.cpus));
  const workload = WORKLOADS.some((w) => w.id === raw.workload) ? raw.workload : "web";
  const storage = STORAGE.some((s) => s.id === raw.storage) ? raw.storage : "ssd";
  if (!VERSIONS.includes(version)) return { error: "Pick a PostgreSQL version between 13 and 18." };
  if (!Number.isFinite(ramGb) || ramGb < 0.25) return { error: "RAM must be at least 0.25 GB." };
  if (ramGb > 16384) return { error: "RAM above 16 TB is outside what these rules of thumb cover." };
  if (!Number.isFinite(cpus) || cpus < 1) return { error: "vCPUs must be at least 1." };
  if (cpus > 1024) return { error: "vCPUs above 1024 is outside what these rules of thumb cover." };
  const connRaw = raw.maxConnections === "" || raw.maxConnections === undefined ? NaN : Number(raw.maxConnections);
  const maxConnections = Number.isFinite(connRaw) ? Math.floor(connRaw) : DEFAULT_CONNECTIONS[workload];
  if (maxConnections < 5) return { error: "max_connections must be at least 5." };
  if (maxConnections > 100000) return { error: "max_connections is too large." };
  return { input: { version, ramKb: Math.round(ramGb * GB), cpus, workload, storage, maxConnections } };
}

/**
 * Compute recommendations. Each setting is
 * { name, value (string as written in postgresql.conf), reason, restart, unit? }.
 * Returns { settings, warnings, notes }.
 */
export function recommend(input) {
  const { version, ramKb, cpus, workload, storage, maxConnections } = input;
  const desktop = workload === "desktop";
  const dw = workload === "dw";
  const settings = [];
  const warnings = [];
  const notes = [];
  const add = (name, value, reason, restart = false) => settings.push({ name, value: String(value), reason, restart });

  add("max_connections", maxConnections, `Your input (${connectionHint(workload)}). Each connection is a process with its own memory.`, true);

  // ---- memory ----
  const sharedKb = roundNice(desktop ? ramKb / 16 : ramKb / 4);
  add(
    "shared_buffers",
    formatMemory(sharedKb),
    desktop
      ? "1/16 of RAM: leave memory for the other apps on this machine."
      : "25% of RAM: the usual start; the OS page cache holds the rest of the working set.",
    true,
  );

  const cacheKb = roundNice(desktop ? ramKb / 4 : (ramKb * 3) / 4);
  add(
    "effective_cache_size",
    formatMemory(cacheKb),
    `${desktop ? "25%" : "75%"} of RAM: a planner hint for shared_buffers + OS cache. Allocates nothing.`,
  );

  const maintCap = 2 * GB;
  const maintKb = roundMb(clamp(dw ? ramKb / 8 : ramKb / 16, 64 * MB, maintCap));
  add(
    "maintenance_work_mem",
    formatMemory(maintKb),
    `RAM/${dw ? 8 : 16}, capped at 2GB: speeds up VACUUM, CREATE INDEX and FK checks.` +
      (version < 17 ? " Before PG17 VACUUM uses at most 1GB of it." : ""),
  );

  const walBuffersKb = clamp(Math.floor(sharedKb / 32), 64, 16 * MB);
  add(
    "wal_buffers",
    formatMemory(walBuffersKb >= MB ? roundMb(walBuffersKb) : walBuffersKb),
    "1/32 of shared_buffers, max 16MB (one WAL segment): what the default -1 picks, written out explicitly.",
    true,
  );

  // ---- parallelism (needed before work_mem) ----
  const perGather = cpus < 2 ? 0 : perGatherFor(workload, cpus);
  const maxWorkers = Math.max(8, cpus);
  const maxParallel = cpus < 2 ? 0 : cpus;
  const maintWorkers = cpus < 2 ? 0 : clamp(Math.floor(cpus / 2), 1, 4);

  // work_mem: memory left after shared_buffers, split across connections, each of
  // which may run a few sort/hash nodes at once (more with parallel workers).
  const opsPerQuery = { web: 4, oltp: 4, mixed: 3, dw: 2, desktop: 6 }[workload];
  const leftKb = Math.max(ramKb - sharedKb, ramKb / 2);
  const workKb = roundMb(clamp(leftKb / (maxConnections * opsPerQuery * (1 + perGather / 2)), 1 * MB, 2 * GB));
  add(
    "work_mem",
    formatMemory(workKb),
    `(RAM − shared_buffers) / (${maxConnections} conns × ${opsPerQuery} sort/hash ops${perGather ? ` × ${1 + perGather / 2} for parallel workers` : ""}). ` +
      `Per sort/hash node, not per query${version >= 15 ? "; hashes may use 2× (hash_mem_multiplier)" : ""}. Raise per session for big reports.`,
  );
  if (workKb <= 1 * MB && ramKb >= 2 * GB) {
    warnings.push(
      `work_mem came out at the 1MB floor because of ${maxConnections} connections. A connection pooler (e.g. PgBouncer) with fewer server connections leaves more memory per query.`,
    );
  }

  // ---- WAL / checkpoints ----
  const wal = {
    web: [1 * GB, 4 * GB],
    oltp: [2 * GB, 8 * GB],
    dw: [4 * GB, 16 * GB],
    mixed: [1 * GB, 4 * GB],
    desktop: [100 * MB, 2 * GB],
  }[workload];
  add("min_wal_size", formatMemory(wal[0]), "WAL kept for reuse after a checkpoint, so bursts don't create new segments.");
  add(
    "max_wal_size",
    formatMemory(wal[1]),
    `Soft limit between checkpoints. Larger means fewer checkpoints and full-page writes, at the cost of longer crash recovery.`,
  );
  add(
    "checkpoint_completion_target",
    "0.9",
    version >= 14 ? "Spread checkpoint writes over 90% of the interval (already the default since PG14)." : "Spread checkpoint writes over 90% of the interval (PG13 defaults to 0.5).",
  );

  // ---- planner / I/O ----
  const rpc = storage === "hdd" ? "4.0" : "1.1";
  add(
    "random_page_cost",
    rpc,
    storage === "hdd"
      ? "Default 4.0 models seek cost on spinning disks."
      : "Random reads cost about the same as sequential on SSD/cloud storage, so the planner should prefer index scans more readily.",
  );
  const eic = storage === "hdd" ? 2 : 200;
  add(
    "effective_io_concurrency",
    eic,
    (storage === "hdd" ? "Roughly the number of spindles you can read from at once." : "SSD/cloud volumes serve many concurrent reads; drives bitmap heap scan prefetch.") +
      (version >= 18 ? " PG18 also uses it for the new asynchronous I/O (default 16)." : " Only has an effect where posix_fadvise exists (e.g. Linux)."),
  );
  add("maintenance_io_concurrency", eic, "Same idea for VACUUM, ANALYZE and recovery prefetching.");

  // ---- workers ----
  add(
    "max_worker_processes",
    maxWorkers,
    `max(8, vCPUs): pool for parallel workers, logical replication and extensions. Must be ≥ max_parallel_workers.`,
    true,
  );
  add("max_parallel_workers", maxParallel, cpus < 2 ? "One vCPU: parallel query would only add overhead." : "One per vCPU: the cap on parallel workers across all queries.");
  add(
    "max_parallel_workers_per_gather",
    perGather,
    cpus < 2
      ? "Disabled on a single vCPU."
      : dw
        ? "Analytic scans benefit most from parallelism: up to half the vCPUs, max 8."
        : desktop
          ? "Keep parallelism small on a shared machine."
          : "Short queries rarely benefit; a few workers help occasional reports without starving others.",
  );
  add("max_parallel_maintenance_workers", maintWorkers, cpus < 2 ? "Disabled on a single vCPU." : "Parallel CREATE INDEX / VACUUM: half the vCPUs, max 4.");

  // ---- huge pages ----
  const hugePagesNeeded = Math.ceil((sharedKb * 1.05) / (2 * MB));
  if (sharedKb >= 8 * GB) {
    add(
      "huge_pages",
      "try",
      `Linux: reserve ~${hugePagesNeeded.toLocaleString("en-US")} 2MB pages (vm.nr_hugepages) for large shared_buffers to cut page-table overhead; then consider 'on'.` +
        (version >= 15 ? " Exact count: postgres -D $PGDATA -C shared_memory_size_in_huge_pages." : ""),
      true,
    );
  } else {
    add("huge_pages", "try", "Default. With shared_buffers under 8GB huge pages give a small gain; configure them later if you like.", true);
  }

  add(
    "default_statistics_target",
    dw ? 500 : 100,
    dw ? "Bigger samples and histograms for complex analytic predicates (ANALYZE gets slower)." : "Default 100 suits most workloads; raise per column with ALTER TABLE ... SET STATISTICS.",
  );

  // ---- warnings & notes ----
  if (maxConnections > Math.max(200, cpus * 8)) {
    warnings.push(
      `${maxConnections} connections on ${cpus} vCPU${cpus > 1 ? "s" : ""} is a lot: only about ${cpus * 2}-${cpus * 4} can make progress at once. Consider a connection pooler.`,
    );
  }
  const worstCaseKb = sharedKb + maxConnections * workKb * opsPerQuery + maintKb * Math.max(1, maintWorkers);
  if (worstCaseKb > ramKb) {
    warnings.push(
      `Worst case (every connection using work_mem ${opsPerQuery}× at once) would exceed RAM. That is rare in practice, but watch for out-of-memory on busy systems.`,
    );
  }
  if (ramKb < 1 * GB) warnings.push("Under 1GB of RAM, keep the defaults close and measure; these ratios are tuned for dedicated servers.");
  if (version >= 18) notes.push("PG18 adds asynchronous I/O (io_method, default 'worker'; 'io_uring' on supported Linux builds). Leave the default unless you have measured.");
  if (version >= 17) notes.push("PG17+ VACUUM stores dead tuples compactly and can use more than 1GB of maintenance_work_mem.");
  if (version <= 14) notes.push(`PG${version} is end-of-life or close to it; plan an upgrade.`);
  notes.push("autovacuum_work_mem defaults to maintenance_work_mem; with several autovacuum workers this multiplies.");

  return { settings, warnings, notes };
}

function perGatherFor(workload, cpus) {
  if (workload === "dw") return clamp(Math.floor(cpus / 2), 1, 8);
  if (workload === "mixed") return clamp(Math.floor(cpus / 4), 1, 4);
  if (workload === "desktop") return clamp(Math.floor(cpus / 4), 1, 2);
  return clamp(Math.floor(cpus / 4), 1, 2); // web, oltp
}

function connectionHint(workload) {
  return `typical for ${WORKLOADS.find((w) => w.id === workload).label.toLowerCase()} is ~${DEFAULT_CONNECTIONS[workload]}`;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const quoteValue = (v) => (NUMERIC.test(v) ? v : `'${v.replace(/'/g, "''")}'`);

/** postgresql.conf snippet with one comment line per setting. */
export function toConf(result, input) {
  const head = [
    `# Starting-point settings for PostgreSQL ${input.version}`,
    `# ${formatMemory(input.ramKb)} RAM, ${input.cpus} vCPU, ${STORAGE.find((s) => s.id === input.storage).label}, ${WORKLOADS.find((w) => w.id === input.workload).label} workload`,
    "# Generated as a starting point: measure and adjust for your workload.",
    "",
  ];
  const width = Math.max(...result.settings.map((s) => s.name.length));
  const lines = result.settings.map(
    (s) => `${s.name.padEnd(width)} = ${quoteValue(s.value)}${" ".repeat(Math.max(1, 8 - quoteValue(s.value).length))}# ${s.restart ? "[restart] " : ""}${s.reason}`,
  );
  return head.concat(lines).join("\n") + "\n";
}

/** ALTER SYSTEM statements + reload, noting which need a restart. */
export function toAlterSystem(result) {
  const reload = result.settings.filter((s) => !s.restart);
  const restart = result.settings.filter((s) => s.restart);
  const stmt = (s) => `ALTER SYSTEM SET ${s.name} = ${quoteValue(s.value)};`;
  return [
    "-- Applied without restart (after pg_reload_conf):",
    ...reload.map(stmt),
    "",
    "-- Need a server restart to take effect:",
    ...restart.map(stmt),
    "",
    "SELECT pg_reload_conf();",
    "",
  ].join("\n");
}
