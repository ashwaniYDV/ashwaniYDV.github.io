/**
 * Parse and analyse PostgreSQL `EXPLAIN (FORMAT JSON)` output.
 *
 * Works with or without ANALYZE / BUFFERS. All derived numbers are wall-clock
 * oriented:
 *   - Per-loop times are multiplied by loops. Inside a parallel subtree (under
 *     Gather / Gather Merge) loops count processes, so they are divided by the
 *     number of processes to approximate wall time.
 *   - Exclusive ("self") time, buffers and cost subtract the children's
 *     inclusive values and are clamped at zero.
 */

export const BLOCK_BYTES = 8192;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

const BUFFER_KEYS = {
  sharedHit: "Shared Hit Blocks",
  sharedRead: "Shared Read Blocks",
  sharedDirtied: "Shared Dirtied Blocks",
  sharedWritten: "Shared Written Blocks",
  localHit: "Local Hit Blocks",
  localRead: "Local Read Blocks",
  localDirtied: "Local Dirtied Blocks",
  localWritten: "Local Written Blocks",
  tempRead: "Temp Read Blocks",
  tempWritten: "Temp Written Blocks",
};

/** Keys rendered by dedicated sections of the details panel. */
export const CONSUMED_KEYS = new Set([
  "Plans",
  "Node Type",
  "Parent Relationship",
  "Parallel Aware",
  "Async Capable",
  "Startup Cost",
  "Total Cost",
  "Plan Rows",
  "Plan Width",
  "Actual Startup Time",
  "Actual Total Time",
  "Actual Rows",
  "Actual Loops",
  "Rows Removed by Filter",
  "Rows Removed by Join Filter",
  "Rows Removed by Index Recheck",
  "I/O Read Time",
  "I/O Write Time",
  "Shared I/O Read Time",
  "Shared I/O Write Time",
  "Local I/O Read Time",
  "Local I/O Write Time",
  "Temp I/O Read Time",
  "Temp I/O Write Time",
  ...Object.values(BUFFER_KEYS),
]);

/**
 * psql prints JSON plans in an aligned table: a "QUERY PLAN" header, a dashed
 * rule, " +" at the end of each wrapped line and "(1 row)". Strip all that.
 */
export function extractJson(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const continued = lines.filter((l) => /\s\+\s*$/.test(l)).length;
  const looksLikePsql = continued > 0 && continued >= lines.length / 3;
  const cleaned = looksLikePsql ? lines.map((l) => l.replace(/\s\+\s*$/, "")).join("\n") : lines.join("\n");
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
  if (start === -1 || end < start) return null;
  return cleaned.slice(start, end + 1);
}

/** Display name like EXPLAIN's text format: "Parallel Seq Scan", "Hash Left Join", "HashAggregate"... */
export function nodeTitle(raw) {
  let type = raw["Node Type"] ?? "Unknown";
  if (type === "Aggregate") {
    type = { Hashed: "HashAggregate", Sorted: "GroupAggregate", Mixed: "MixedAggregate" }[raw.Strategy] ?? "Aggregate";
  }
  if (type === "SetOp" && raw.Strategy === "Hashed") type = "HashSetOp";
  if (type === "ModifyTable" && raw.Operation) type = raw.Operation;
  const joinType = raw["Join Type"];
  if (joinType && joinType !== "Inner" && / Join$|^Nested Loop$/.test(type)) {
    type = type === "Nested Loop" ? `Nested Loop ${joinType} Join` : type.replace(/ Join$/, ` ${joinType} Join`);
  }
  const partial = raw["Partial Mode"];
  if (partial && partial !== "Simple") type = `${partial} ${type}`;
  if (raw["Parallel Aware"]) type = `Parallel ${type}`;
  return type;
}

/** "orders o", "using idx on line_items l", "CTE recent", "generate_series()"... */
export function nodeTarget(raw) {
  const parts = [];
  if (raw["Index Name"]) parts.push({ kind: "index", text: raw["Index Name"] });
  const rel = raw["Relation Name"];
  if (rel) {
    const schema = raw.Schema && raw.Schema !== "public" ? `${raw.Schema}.` : "";
    const alias = raw.Alias && raw.Alias !== rel ? ` ${raw.Alias}` : "";
    parts.push({ kind: "relation", text: `${schema}${rel}${alias}` });
  }
  if (raw["CTE Name"]) parts.push({ kind: "relation", text: `CTE ${raw["CTE Name"]}` });
  if (raw["Function Name"]) parts.push({ kind: "relation", text: `${raw["Function Name"]}()` });
  if (raw["Subquery Name"]) parts.push({ kind: "relation", text: raw["Subquery Name"] });
  return parts;
}

function readBuffers(raw) {
  const out = {};
  let any = false;
  for (const [k, key] of Object.entries(BUFFER_KEYS)) {
    out[k] = num(raw[key]) ?? 0;
    if (raw[key] !== undefined) any = true;
  }
  return any ? out : null;
}

function subtractBuffers(own, children) {
  if (!own) return null;
  const out = {};
  for (const k of Object.keys(BUFFER_KEYS)) {
    out[k] = Math.max(0, own[k] - sum(children.map((c) => c.buffers?.[k] ?? 0)));
  }
  return out;
}

function build(raw, parent, ctx, procs) {
  const node = { id: ctx.nodes.length, raw, parent, children: [], depth: parent ? parent.depth + 1 : 0 };
  // A Limit above stops its subtree early, so actual rows there can be far below the estimate.
  node.underLimit = Boolean(parent && (parent.underLimit || parent.raw["Node Type"] === "Limit"));
  ctx.nodes.push(node);

  node.title = nodeTitle(raw);
  node.target = nodeTarget(raw);
  node.relationship = raw["Parent Relationship"];
  node.subplanName = raw["Subplan Name"];

  const analyzed = num(raw["Actual Total Time"]) !== undefined || num(raw["Actual Loops"]) !== undefined;
  if (analyzed) ctx.analyzed = true;
  node.analyzed = analyzed;
  node.loops = num(raw["Actual Loops"]) ?? 1;
  node.neverExecuted = analyzed && node.loops === 0;

  // Wall-clock multiplier for per-loop times.
  const scale = procs > 1 ? node.loops / procs : node.loops;
  node.inclusive = analyzed ? (num(raw["Actual Total Time"]) ?? 0) * scale : undefined;
  node.startupTime = num(raw["Actual Startup Time"]);
  node.totalTimePerLoop = num(raw["Actual Total Time"]);
  node.procs = procs;

  node.rowsPerLoop = num(raw["Actual Rows"]);
  node.rows = analyzed ? (node.rowsPerLoop ?? 0) * node.loops : undefined;
  node.planRowsPerLoop = num(raw["Plan Rows"]);
  node.planRows = node.planRowsPerLoop !== undefined ? node.planRowsPerLoop * (analyzed ? Math.max(node.loops, 1) : 1) : undefined;

  if (analyzed && !node.neverExecuted && node.planRowsPerLoop !== undefined) {
    const a = Math.max(node.rowsPerLoop ?? 0, 1);
    const e = Math.max(node.planRowsPerLoop, 1);
    node.estimateFactor = a >= e ? a / e : e / a;
    node.estimateDirection = a > e ? "under" : a < e ? "over" : "exact";
  }

  node.removed = {
    filter: (num(raw["Rows Removed by Filter"]) ?? 0) * node.loops,
    joinFilter: (num(raw["Rows Removed by Join Filter"]) ?? 0) * node.loops,
    recheck: (num(raw["Rows Removed by Index Recheck"]) ?? 0) * node.loops,
  };
  node.removedTotal = node.removed.filter + node.removed.joinFilter + node.removed.recheck;

  node.startupCost = num(raw["Startup Cost"]);
  node.totalCost = num(raw["Total Cost"]);
  node.bufferTotals = readBuffers(raw);
  if (node.bufferTotals) ctx.hasBuffers = true;
  node.ioRead = num(raw["Shared I/O Read Time"]) ?? num(raw["I/O Read Time"]);
  node.ioWrite = num(raw["Shared I/O Write Time"]) ?? num(raw["I/O Write Time"]);

  let childProcs = procs;
  if (raw["Node Type"] === "Gather" || raw["Node Type"] === "Gather Merge") {
    const workers = num(raw["Workers Launched"]) ?? num(raw["Workers Planned"]) ?? 0;
    childProcs = workers + 1; // leader usually participates
  }

  for (const child of raw.Plans ?? []) node.children.push(build(child, node, ctx, childProcs));

  // `buffers` keeps the inclusive totals for subtraction; `selfBuffers` is this node alone.
  node.buffers = node.bufferTotals;
  node.selfBuffers = subtractBuffers(node.bufferTotals, node.children);
  node.exclusive = analyzed ? Math.max(0, node.inclusive - sum(node.children.map((c) => c.inclusive ?? 0))) : undefined;
  node.selfCost =
    node.totalCost !== undefined ? Math.max(0, node.totalCost - sum(node.children.map((c) => c.totalCost ?? 0))) : undefined;
  return node;
}

const fmtCount = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (p) => `${(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%`;
const blocksToMB = (b) => (b * BLOCK_BYTES) / (1024 * 1024);
const fmtBlocks = (b) => {
  const mb = blocksToMB(b);
  return `${fmtCount(b)} blocks (${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`})`;
};

/** Findings per node: { node, severity: "high"|"medium"|"low", title, detail }. */
function findIssues(nodes, totals) {
  const issues = [];
  const add = (node, severity, title, detail) => issues.push({ node, severity, title, detail });

  for (const n of nodes) {
    const raw = n.raw;
    const type = raw["Node Type"];

    if (n.analyzed && totals.time > 0 && n.exclusive !== undefined) {
      const share = n.exclusive / totals.time;
      if (share >= 0.1) {
        add(
          n,
          share >= 0.25 ? "high" : "medium",
          `Slow node: ${fmtPct(share)} of the run time`,
          `This node alone (excluding its children) took ${n.exclusive.toFixed(1)} ms. Start here when tuning.`,
        );
      }
    }

    const earlyStop = n.underLimit && n.estimateDirection === "over";
    if (n.estimateFactor >= 10 && !earlyStop && Math.max(n.rows ?? 0, n.planRows ?? 0) >= 100) {
      const under = n.estimateDirection === "under";
      add(
        n,
        n.estimateFactor >= 100 ? "high" : "medium",
        `Row estimate off by ${Math.round(n.estimateFactor).toLocaleString("en-US")}×`,
        `The planner expected ${fmtCount(n.planRowsPerLoop)} rows per loop but got ${fmtCount(n.rowsPerLoop)} ` +
          `(${under ? "underestimate" : "overestimate"}). Bad estimates lead to poor join methods and orders. ` +
          "Run ANALYZE on the tables, raise the column's statistics target, or add extended statistics for correlated columns.",
      );
    }

    if (n.removedTotal >= 1000) {
      const read = n.removedTotal + (n.rows ?? 0);
      const share = read > 0 ? n.removedTotal / read : 0;
      if (share >= 0.5) {
        const seq = type === "Seq Scan";
        const which = n.removed.recheck >= n.removed.filter && n.removed.recheck >= n.removed.joinFilter
          ? "the index recheck"
          : n.removed.joinFilter > n.removed.filter
            ? "the join filter"
            : "the filter";
        add(
          n,
          seq && share >= 0.9 && n.removedTotal >= 100000 ? "high" : "medium",
          `Discards ${fmtCount(n.removedTotal)} rows (${fmtPct(share)} of rows read)`,
          `Most rows read here are thrown away by ${which}. ` +
            (seq
              ? "An index on the filtered columns (or a partial index matching the condition) could avoid reading them."
              : "Pushing the condition into an index condition, or a more selective index, could avoid this work."),
        );
      }
    }

    if (type === "Nested Loop" && n.children.length === 2) {
      const inner = n.children.find((c) => c.relationship === "Inner") ?? n.children[1];
      if (inner.loops >= 1000) {
        const share = totals.time > 0 && n.inclusive !== undefined ? n.inclusive / totals.time : 0;
        add(
          n,
          share >= 0.3 ? "high" : "low",
          `Nested Loop runs its inner side ${fmtCount(inner.loops)} times`,
          "Each outer row re-runs the inner plan. That is fine with a cheap index lookup, but with many outer rows " +
            "a Hash Join or Merge Join is often faster. Check the outer side's row estimate.",
        );
      }
    }

    if (raw["Sort Space Type"] === "Disk") {
      add(
        n,
        "high",
        `Sort spilled to disk (${fmtCount(raw["Sort Space Used"] ?? 0)} kB)`,
        `The sort did not fit in work_mem and used an external ${raw["Sort Method"] ?? "merge"}. Raise work_mem for this query or sort fewer rows.`,
      );
    }

    const batches = num(raw["Hash Batches"]);
    if (type === "Hash" && batches > 1) {
      add(
        n,
        "medium",
        `Hash split into ${batches} batches`,
        `The hash table (peak ${fmtCount(raw["Peak Memory Usage"] ?? 0)} kB) did not fit in work_mem, so batches were written to temp files. Raise work_mem or hash_mem_multiplier.`,
      );
    }

    if (num(raw["Disk Usage"]) > 0 || num(raw["HashAgg Batches"]) > 1) {
      add(
        n,
        "medium",
        "Aggregate spilled to disk",
        `HashAggregate used ${fmtCount(raw["Disk Usage"] ?? 0)} kB of temp disk over ${raw["HashAgg Batches"] ?? "several"} batches. Raise work_mem or hash_mem_multiplier.`,
      );
    }

    if (n.selfBuffers && n.selfBuffers.tempWritten > 0 && !raw["Sort Space Type"] && !(batches > 1) && !(num(raw["Disk Usage"]) > 0)) {
      add(n, "low", `Writes ${fmtBlocks(n.selfBuffers.tempWritten)} of temp files`, "Part of this node's work did not fit in memory (work_mem).");
    }

    if (n.selfBuffers) {
      const { sharedHit, sharedRead } = n.selfBuffers;
      const ratio = sharedHit + sharedRead > 0 ? sharedHit / (sharedHit + sharedRead) : 1;
      if (sharedRead >= 1000 && ratio < 0.9) {
        add(
          n,
          sharedRead >= 10000 ? "medium" : "low",
          `Reads ${fmtBlocks(sharedRead)} outside shared buffers`,
          `Only ${fmtPct(ratio)} of this node's pages were in shared_buffers; the rest came from the OS cache or storage.` +
            (n.ioRead !== undefined ? ` I/O read time: ${n.ioRead.toFixed(1)} ms.` : " Enable track_io_timing to see how long the reads took."),
        );
      }
    }

    const heapFetches = num(raw["Heap Fetches"]);
    if (type === "Index Only Scan" && heapFetches > 0 && n.rows > 0 && heapFetches * n.loops >= Math.max(100, 0.1 * n.rows)) {
      add(
        n,
        "medium",
        `Index Only Scan made ${fmtCount(heapFetches * n.loops)} heap fetches`,
        "Pages not marked all-visible force a heap visit per row. VACUUM the table to update its visibility map.",
      );
    }

    if (num(raw["Lossy Heap Blocks"]) > 0) {
      add(
        n,
        "medium",
        `Lossy bitmap: ${fmtCount(raw["Lossy Heap Blocks"])} heap blocks`,
        "The bitmap did not fit in work_mem and degraded to page level, so every row on those pages was rechecked. Raise work_mem.",
      );
    }

    const planned = num(raw["Workers Planned"]);
    const launched = num(raw["Workers Launched"]);
    if (planned !== undefined && launched !== undefined && launched < planned) {
      add(
        n,
        "medium",
        `Only ${launched} of ${planned} parallel workers launched`,
        "The worker pool was exhausted. Check max_parallel_workers and max_worker_processes.",
      );
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.node.exclusive ?? 0) - (a.node.exclusive ?? 0));
}

/**
 * Parse pasted text into an analysed plan.
 * Returns { error } or { root, nodes, issues, analyzed, hasBuffers, planningTime, executionTime, totals, ... }.
 */
export function parsePlan(text) {
  if (!text.trim()) return { error: "empty" };
  const json = extractJson(text);
  if (!json) {
    return {
      error: /cost=|->/.test(text)
        ? "This looks like text-format EXPLAIN. Re-run it with FORMAT JSON and paste that."
        : "No JSON found. Paste the output of EXPLAIN (FORMAT JSON).",
    };
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }

  const statements = Array.isArray(data) ? data : [data];
  const top = statements[0] && (statements[0].Plan ? statements[0] : { Plan: statements[0] });
  if (!top?.Plan || typeof top.Plan !== "object" || !top.Plan["Node Type"]) {
    return { error: 'Couldn\'t find a plan. Expected [{ "Plan": { "Node Type": ... } }].' };
  }

  const ctx = { nodes: [], analyzed: false, hasBuffers: false };
  const root = build(top.Plan, null, ctx, 1);

  const executionTime = num(top["Execution Time"]);
  const planningTime = num(top["Planning Time"]);
  const triggers = Array.isArray(top.Triggers) ? top.Triggers : [];
  const triggerTime = sum(triggers.map((t) => num(t.Time) ?? 0));

  const totals = {
    time: executionTime ?? root.inclusive ?? 0,
    cost: root.totalCost ?? 0,
    rows: Math.max(1, ...ctx.nodes.map((n) => n.rows ?? 0)),
    blocks: Math.max(1, sum(ctx.nodes.map((n) => (n.selfBuffers ? n.selfBuffers.sharedHit + n.selfBuffers.sharedRead : 0)))),
  };

  return {
    root,
    nodes: ctx.nodes,
    analyzed: ctx.analyzed,
    hasBuffers: ctx.hasBuffers,
    executionTime,
    planningTime,
    planningBuffers: top.Planning ? readBuffers(top.Planning) : null,
    triggers,
    triggerTime,
    jit: top.JIT ?? null,
    settings: top.Settings ?? null,
    statementCount: statements.length,
    totals,
    issues: findIssues(ctx.nodes, totals),
  };
}

/**
 * Value and share (0..1) of a node for the chosen metric:
 * time (self ms), rows (actual rows), buffers (self shared hit + read), cost (self cost).
 */
export function metricOf(node, metric, totals) {
  switch (metric) {
    case "time":
      return { value: node.exclusive, share: totals.time > 0 && node.exclusive !== undefined ? node.exclusive / totals.time : 0 };
    case "rows":
      return { value: node.rows, share: node.rows !== undefined ? node.rows / totals.rows : 0 };
    case "buffers": {
      const b = node.selfBuffers ? node.selfBuffers.sharedHit + node.selfBuffers.sharedRead : undefined;
      return { value: b, share: b !== undefined ? b / totals.blocks : 0 };
    }
    default:
      return { value: node.selfCost, share: totals.cost > 0 && node.selfCost !== undefined ? node.selfCost / totals.cost : 0 };
  }
}

/** Short explanations of what common plan nodes do. */
export const NODE_DESCRIPTIONS = {
  "Seq Scan": "Reads every page of the table in order and checks each row against the filter.",
  "Index Scan": "Walks an index to find matching entries, then fetches each row from the table heap.",
  "Index Only Scan": "Answers from the index alone, visiting the heap only for pages not marked all-visible.",
  "Bitmap Index Scan": "Scans an index and builds an in-memory bitmap of matching row locations.",
  "Bitmap Heap Scan": "Reads table pages flagged by a bitmap, in physical order, and rechecks the condition where needed.",
  "Tid Scan": "Fetches rows directly by their physical location (ctid).",
  "Nested Loop": "For each row from the outer (first) child, runs the inner (second) child to find matches.",
  "Hash Join": "Builds a hash table from the inner child, then probes it with each row from the outer child.",
  "Merge Join": "Joins two inputs already sorted on the join key by walking them together.",
  Hash: "Builds the in-memory hash table used by its parent Hash Join.",
  Sort: "Sorts its input, in memory if it fits in work_mem, otherwise using temp files.",
  "Incremental Sort": "Sorts input that is already sorted on a key prefix, one group at a time.",
  Aggregate: "Computes aggregates (count, sum, ...), either over all rows, by hashing groups, or over sorted input.",
  Limit: "Stops after returning the requested number of rows.",
  Materialize: "Caches its child's output in memory so it can be re-read cheaply, e.g. by a Nested Loop.",
  Memoize: "Caches inner-side results by parameter value so repeated lookups skip the child.",
  Gather: "Collects rows from parallel workers into the leader process.",
  "Gather Merge": "Collects already-sorted rows from parallel workers, preserving the order.",
  Append: "Returns the rows of each child in turn (UNION ALL, partitioned tables).",
  "Merge Append": "Merges sorted outputs of several children (sorted reads over partitions).",
  "CTE Scan": "Reads the rows of a materialized WITH query.",
  "Subquery Scan": "Wraps the output of a subquery so the parent can treat it like a table.",
  "Function Scan": "Reads rows returned by a set-returning function.",
  "Values Scan": "Reads rows from a VALUES list.",
  Result: "Computes a result without scanning a table, or applies a one-time filter.",
  ProjectSet: "Evaluates set-returning functions in the target list.",
  Unique: "Removes adjacent duplicate rows from sorted input.",
  WindowAgg: "Computes window functions over partitions of sorted input.",
  SetOp: "Implements INTERSECT or EXCEPT.",
  LockRows: "Locks the rows it returns (SELECT ... FOR UPDATE/SHARE).",
  ModifyTable: "Applies INSERT, UPDATE, DELETE or MERGE to a table.",
};
