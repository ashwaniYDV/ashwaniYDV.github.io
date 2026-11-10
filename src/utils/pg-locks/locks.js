/**
 * PostgreSQL lock conflict rules and wait-for graph building (pure, no React).
 *
 * Matrices are Table 13.2 (table-level) and Table 13.3 (row-level) of the PostgreSQL docs,
 * "Explicit Locking" (https://www.postgresql.org/docs/current/explicit-locking.html), which match
 * LockConflicts[] in src/backend/storage/lmgr/lock.c and the tuple lock table in heapam.c.
 */
import { parseTable } from "./table.js";

// ---------- table-level ----------
export const TABLE_MODES = [
  { id: "AccessShareLock", name: "ACCESS SHARE", short: "AS" },
  { id: "RowShareLock", name: "ROW SHARE", short: "RS" },
  { id: "RowExclusiveLock", name: "ROW EXCLUSIVE", short: "RE" },
  { id: "ShareUpdateExclusiveLock", name: "SHARE UPDATE EXCLUSIVE", short: "SUE" },
  { id: "ShareLock", name: "SHARE", short: "S" },
  { id: "ShareRowExclusiveLock", name: "SHARE ROW EXCLUSIVE", short: "SRE" },
  { id: "ExclusiveLock", name: "EXCLUSIVE", short: "E" },
  { id: "AccessExclusiveLock", name: "ACCESS EXCLUSIVE", short: "AE" },
];

/** Requested mode -> existing modes it conflicts with (docs Table 13.2). */
const TABLE_CONFLICTS = {
  AccessShareLock: ["AccessExclusiveLock"],
  RowShareLock: ["ExclusiveLock", "AccessExclusiveLock"],
  RowExclusiveLock: ["ShareLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"],
  ShareUpdateExclusiveLock: ["ShareUpdateExclusiveLock", "ShareLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"],
  ShareLock: ["RowExclusiveLock", "ShareUpdateExclusiveLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"],
  ShareRowExclusiveLock: [
    "RowExclusiveLock",
    "ShareUpdateExclusiveLock",
    "ShareLock",
    "ShareRowExclusiveLock",
    "ExclusiveLock",
    "AccessExclusiveLock",
  ],
  ExclusiveLock: [
    "RowShareLock",
    "RowExclusiveLock",
    "ShareUpdateExclusiveLock",
    "ShareLock",
    "ShareRowExclusiveLock",
    "ExclusiveLock",
    "AccessExclusiveLock",
  ],
  AccessExclusiveLock: TABLE_MODES.map((m) => m.id),
};

const MODE_ALIASES = Object.fromEntries(
  TABLE_MODES.flatMap((m) => [
    [m.id.toLowerCase(), m.id],
    [m.name.toLowerCase(), m.id],
    [m.name.toLowerCase().replace(/ /g, ""), m.id],
    [m.short.toLowerCase(), m.id],
  ]),
);

/** "ACCESS SHARE", "AccessShareLock", "access share lock" -> "AccessShareLock". */
export function normalizeMode(text) {
  const s = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const bare = s.replace(/\s*(lock|mode)$/, "").trim();
  return MODE_ALIASES[s] ?? MODE_ALIASES[s.replace(/ /g, "")] ?? MODE_ALIASES[bare] ?? MODE_ALIASES[bare.replace(/ /g, "")] ?? null;
}

export const tableModeInfo = (id) => TABLE_MODES.find((m) => m.id === id);

/** Does a request for `requested` wait while another transaction holds `held`? (Symmetric.) */
export function tableConflicts(requested, held) {
  return TABLE_CONFLICTS[requested]?.includes(held) ?? false;
}

// ---------- row-level ----------
export const ROW_MODES = [
  { id: "FOR KEY SHARE", short: "KS" },
  { id: "FOR SHARE", short: "S" },
  { id: "FOR NO KEY UPDATE", short: "NKU" },
  { id: "FOR UPDATE", short: "U" },
];

const ROW_CONFLICTS = {
  "FOR KEY SHARE": ["FOR UPDATE"],
  "FOR SHARE": ["FOR NO KEY UPDATE", "FOR UPDATE"],
  "FOR NO KEY UPDATE": ["FOR SHARE", "FOR NO KEY UPDATE", "FOR UPDATE"],
  "FOR UPDATE": ["FOR KEY SHARE", "FOR SHARE", "FOR NO KEY UPDATE", "FOR UPDATE"],
};

export const rowConflicts = (requested, held) => ROW_CONFLICTS[requested]?.includes(held) ?? false;

// ---------- statements ----------
/**
 * Lock taken on the *target table* by common commands (per each command's reference page).
 * `extra` lists other locks the command takes, for the explanation.
 */
export const TABLE_STATEMENTS = [
  { id: "select", label: "SELECT", mode: "AccessShareLock" },
  { id: "copy-to", label: "COPY … TO / pg_dump", mode: "AccessShareLock" },
  { id: "select-for", label: "SELECT … FOR UPDATE / SHARE", mode: "RowShareLock", note: "Also takes row locks on the selected rows." },
  { id: "dml", label: "INSERT / UPDATE / DELETE / MERGE", mode: "RowExclusiveLock", note: "UPDATE and DELETE also take row locks." },
  { id: "copy-from", label: "COPY … FROM", mode: "RowExclusiveLock" },
  { id: "vacuum", label: "VACUUM (and autovacuum)", mode: "ShareUpdateExclusiveLock", note: "A regular autovacuum cancels itself when it blocks someone; an anti-wraparound one does not." },
  { id: "analyze", label: "ANALYZE", mode: "ShareUpdateExclusiveLock" },
  { id: "cic", label: "CREATE INDEX CONCURRENTLY", mode: "ShareUpdateExclusiveLock", note: "Also waits for every transaction that could use the old index definition (virtualxid waits), so long-running transactions anywhere stall it." },
  { id: "reindex-conc", label: "REINDEX CONCURRENTLY", mode: "ShareUpdateExclusiveLock" },
  { id: "create-stats", label: "CREATE STATISTICS / COMMENT ON", mode: "ShareUpdateExclusiveLock" },
  { id: "alter-sue", label: "ALTER TABLE … SET STATISTICS / SET (storage params) / VALIDATE CONSTRAINT / CLUSTER ON", mode: "ShareUpdateExclusiveLock" },
  { id: "attach", label: "ALTER TABLE … ATTACH PARTITION (on the parent)", mode: "ShareUpdateExclusiveLock", note: "The partition being attached (and a default partition) get ACCESS EXCLUSIVE." },
  { id: "detach-conc", label: "ALTER TABLE … DETACH PARTITION CONCURRENTLY", mode: "ShareUpdateExclusiveLock" },
  { id: "create-index", label: "CREATE INDEX", mode: "ShareLock", note: "Allows reads, blocks writes for the whole build." },
  { id: "reindex", label: "REINDEX (table lock)", mode: "ShareLock", note: "The index itself gets ACCESS EXCLUSIVE, so queries that would use it block too." },
  { id: "create-trigger", label: "CREATE TRIGGER", mode: "ShareRowExclusiveLock" },
  { id: "alter-fk", label: "ALTER TABLE … ADD FOREIGN KEY", mode: "ShareRowExclusiveLock", note: "Taken on both the referencing and the referenced table." },
  { id: "alter-trigger", label: "ALTER TABLE … ENABLE / DISABLE TRIGGER", mode: "ShareRowExclusiveLock" },
  { id: "refresh-conc", label: "REFRESH MATERIALIZED VIEW CONCURRENTLY", mode: "ExclusiveLock" },
  { id: "alter-ae", label: "ALTER TABLE … ADD/DROP COLUMN, ALTER TYPE, SET NOT NULL, RENAME, …", mode: "AccessExclusiveLock", note: "Most ALTER TABLE forms. Even a fast metadata-only change must wait for every open transaction that touched the table, and blocks everyone queued behind it." },
  { id: "truncate", label: "TRUNCATE", mode: "AccessExclusiveLock" },
  { id: "drop", label: "DROP TABLE", mode: "AccessExclusiveLock" },
  { id: "vacuum-full", label: "VACUUM FULL / CLUSTER", mode: "AccessExclusiveLock" },
  { id: "refresh", label: "REFRESH MATERIALIZED VIEW", mode: "AccessExclusiveLock" },
  { id: "lock-default", label: "LOCK TABLE (no mode)", mode: "AccessExclusiveLock" },
  ...TABLE_MODES.map((m) => ({ id: `lock-${m.short}`, label: `LOCK TABLE … IN ${m.name} MODE`, mode: m.id })),
];

export const ROW_STATEMENTS = [
  { id: "fks", label: "SELECT … FOR KEY SHARE", mode: "FOR KEY SHARE" },
  { id: "fk-insert", label: "INSERT/UPDATE on a referencing (FK) table", mode: "FOR KEY SHARE", note: "The foreign key check locks the referenced row FOR KEY SHARE." },
  { id: "fs", label: "SELECT … FOR SHARE", mode: "FOR SHARE" },
  { id: "fnku", label: "SELECT … FOR NO KEY UPDATE", mode: "FOR NO KEY UPDATE" },
  { id: "update", label: "UPDATE (no key column changed)", mode: "FOR NO KEY UPDATE" },
  { id: "fu", label: "SELECT … FOR UPDATE", mode: "FOR UPDATE" },
  { id: "update-key", label: "UPDATE of a unique/FK-usable key column", mode: "FOR UPDATE" },
  { id: "delete", label: "DELETE", mode: "FOR UPDATE" },
];

/** Resolve a selection `{ kind: "mode"|"stmt", id }` to `{ mode, label, note }`. */
export function resolvePick(pick, level = "table") {
  const modes = level === "row" ? ROW_MODES : TABLE_MODES;
  const stmts = level === "row" ? ROW_STATEMENTS : TABLE_STATEMENTS;
  if (pick?.kind === "stmt") {
    const s = stmts.find((x) => x.id === pick.id);
    if (s) return { mode: s.mode, label: s.label, note: s.note, isStatement: true };
  }
  const m = modes.find((x) => x.id === pick?.id) ?? modes[0];
  return { mode: m.id, label: level === "row" ? m.id : m.name, isStatement: false };
}

export function compare(holderPick, requesterPick, level = "table") {
  const a = resolvePick(holderPick, level);
  const b = resolvePick(requesterPick, level);
  const blocks = level === "row" ? rowConflicts(b.mode, a.mode) : tableConflicts(b.mode, a.mode);
  return { holder: a, requester: b, blocks };
}

// ---------- wait-for graph ----------
const truthy = (v) => /^(t|true|yes|1)$/i.test(String(v).trim());
const parsePids = (v) =>
  String(v ?? "")
    .replace(/[{}[\]]/g, "")
    .split(/[\s,]+/)
    .filter((x) => /^\d+$/.test(x));

const TARGET_COLUMNS = ["locktype", "database", "relation", "relname", "page", "tuple", "virtualxid", "transactionid", "classid", "objid", "objsubid"];
const INFO_SKIP = new Set(["pid", "blocked_by", "pg_blocking_pids", "blocking_pids", "mode", "granted", "fastpath", "waitstart"]);

/**
 * Build a wait-for graph from pasted output.
 * Accepts (auto-detected):
 *   - pg_blocking_pids(): columns `pid` and `blocked_by` (`{1,2}`), plus any info columns
 *   - pg_locks (optionally joined to pg_stat_activity): `pid`, `mode`, `granted` and lock target columns
 * Returns `{ format, nodes: Map<pid, node>, edges: [{ from, to, soft, reason }], cycles: pid[][], roots }`.
 * Edges point from the blocker to the waiter.
 */
export function buildGraph(text) {
  const table = parseTable(text);
  if (table.error) return { error: table.error };
  const { columns, rows } = table;
  if (!columns.includes("pid")) return { error: "No pid column found. Paste output that includes a pid column and its header." };
  const blockCol = columns.find((c) => ["blocked_by", "pg_blocking_pids", "blocking_pids", "blockers"].includes(c));
  if (blockCol) return finish("pg_blocking_pids", fromBlockingPids(rows, blockCol));
  if (columns.includes("mode") && columns.includes("granted")) return finish("pg_locks", fromLocks(rows, columns));
  return { error: "Couldn't tell the format. Include either a blocked_by (pg_blocking_pids) column, or pg_locks' mode and granted columns." };
}

function nodeFor(nodes, pid) {
  if (!nodes.has(pid)) nodes.set(pid, { pid, info: {}, waiting: [], holding: [] });
  return nodes.get(pid);
}

function addInfo(node, row) {
  for (const [k, v] of Object.entries(row)) {
    if (INFO_SKIP.has(k) || TARGET_COLUMNS.includes(k) || v === "" || node.info[k]) continue;
    node.info[k] = v;
  }
}

function fromBlockingPids(rows, blockCol) {
  const nodes = new Map();
  const edges = [];
  const problems = [];
  rows.forEach((r, i) => {
    const pid = String(r.pid).trim();
    if (!/^\d+$/.test(pid)) {
      problems.push(`Row ${i + 1}: pid "${r.pid}" is not a number.`);
      return;
    }
    const node = nodeFor(nodes, pid);
    addInfo(node, r);
    for (const b of parsePids(r[blockCol])) {
      nodeFor(nodes, b);
      if (!edges.some((e) => e.from === b && e.to === pid)) edges.push({ from: b, to: pid, soft: false, reason: "pg_blocking_pids" });
    }
  });
  return { nodes, edges, problems };
}

const describeTarget = (r) => {
  const t = r.locktype || "lock";
  if (t === "relation") return `relation ${r.relname || r.relation}`;
  if (t === "tuple") return `tuple (${r.page},${r.tuple}) of ${r.relname || r.relation}`;
  if (t === "transactionid") return `transaction ${r.transactionid}`;
  if (t === "virtualxid") return `virtual xid ${r.virtualxid}`;
  if (t === "page") return `page ${r.page} of ${r.relname || r.relation}`;
  if (t === "advisory") return `advisory lock ${[r.classid, r.objid, r.objsubid].filter(Boolean).join(":")}`;
  if (t === "object") return `object ${r.classid}/${r.objid}`;
  return t;
};

function fromLocks(rows, columns) {
  const keyCols = TARGET_COLUMNS.filter((c) => columns.includes(c) && !(c === "relname" && columns.includes("relation")));
  const nodes = new Map();
  const problems = [];
  const locks = [];
  rows.forEach((r, i) => {
    const pid = String(r.pid).trim();
    if (!/^\d+$/.test(pid)) return; // e.g. prepared transactions have no pid
    const mode = normalizeMode(r.mode);
    if (!mode) {
      problems.push(`Row ${i + 1}: unknown lock mode "${r.mode}".`);
      return;
    }
    const node = nodeFor(nodes, pid);
    addInfo(node, r);
    const lock = { pid, mode, granted: truthy(r.granted), key: keyCols.map((c) => r[c] ?? "").join("\u0001"), target: describeTarget(r) };
    locks.push(lock);
    (lock.granted ? node.holding : node.waiting).push(lock);
  });

  const edges = [];
  const add = (from, to, soft, reason) => {
    if (from !== to && !edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to, soft, reason });
  };
  const waiters = locks.filter((l) => !l.granted);
  const hardBlocked = new Set();
  for (const w of waiters) {
    for (const h of locks) {
      if (h.granted && h.key === w.key && h.pid !== w.pid && tableConflicts(w.mode, h.mode)) {
        add(h.pid, w.pid, false, `${tableModeInfo(w.mode).name} on ${w.target} conflicts with held ${tableModeInfo(h.mode).name}`);
        hardBlocked.add(w);
      }
    }
  }
  // A waiter no holder blocks is queued behind an earlier conflicting waiter (lock queue fairness).
  for (const w of waiters) {
    if (hardBlocked.has(w)) continue;
    const others = waiters.filter((o) => o !== w && o.key === w.key && o.pid !== w.pid && tableConflicts(w.mode, o.mode));
    const ahead = others.filter((o) => hardBlocked.has(o));
    for (const o of ahead.length ? ahead : others) {
      add(o.pid, w.pid, true, `queued behind ${tableModeInfo(o.mode).name} request on ${w.target}`);
    }
  }
  return { nodes, edges, problems };
}

/** Tarjan SCC; returns components with a cycle (size > 1, or a self-loop). */
export function findCycles(pids, edges) {
  const adj = new Map(pids.map((p) => [p, []]));
  edges.forEach((e) => adj.get(e.from)?.push(e.to));
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const comps = [];
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      comps.push(comp);
    }
  };
  pids.forEach((p) => idx.has(p) || strong(p));
  return comps.filter((c) => c.length > 1 || edges.some((e) => e.from === c[0] && e.to === c[0]));
}

function finish(format, { nodes, edges, problems }) {
  const pids = [...nodes.keys()];
  const cycles = findCycles(pids, edges);
  const inCycle = new Set(cycles.flat());
  const blockersOf = (p) => edges.filter((e) => e.to === p).map((e) => e.from);
  const victimsOf = (p) => edges.filter((e) => e.from === p).map((e) => e.to);

  // Transitive victim counts.
  const reach = (p) => {
    const seen = new Set();
    const todo = [p];
    while (todo.length) {
      for (const v of victimsOf(todo.pop())) if (!seen.has(v) && v !== p) seen.add(v), todo.push(v);
    }
    return seen.size;
  };

  // Layer: blockers on the left; each waiter one column right of its furthest blocker. Cycles share a column.
  const level = new Map();
  const comp = new Map();
  cycles.forEach((c, i) => c.forEach((p) => comp.set(p, `c${i}`)));
  const visiting = new Set();
  const levelOf = (p) => {
    if (level.has(p)) return level.get(p);
    if (visiting.has(p)) return 0;
    visiting.add(p);
    const mine = comp.get(p);
    const outside = blockersOf(p).filter((b) => !mine || comp.get(b) !== mine);
    const members = mine ? pids.filter((q) => comp.get(q) === mine) : [p];
    const ext = mine ? members.flatMap((q) => blockersOf(q).filter((b) => comp.get(b) !== mine)) : outside;
    const l = ext.length ? 1 + Math.max(...ext.map(levelOf)) : 0;
    members.forEach((q) => level.set(q, l));
    visiting.delete(p);
    return l;
  };
  pids.forEach(levelOf);

  for (const p of pids) {
    const n = nodes.get(p);
    n.level = level.get(p);
    n.blockedBy = blockersOf(p);
    n.blocks = victimsOf(p);
    n.victims = reach(p);
    n.inCycle = inCycle.has(p);
  }
  const roots = pids
    .filter((p) => nodes.get(p).blocks.length && !nodes.get(p).blockedBy.length)
    .sort((a, b) => nodes.get(b).victims - nodes.get(a).victims);
  return { format, nodes, edges, cycles, roots, problems };
}

/** Assign x/y for drawing. Returns `{ positions: Map<pid,{x,y}>, width, height }`. */
export function layout(graph, { nodeW = 210, nodeH = 64, colGap = 90, rowGap = 22, pad = 24 } = {}) {
  const cols = new Map();
  for (const n of graph.nodes.values()) {
    if (!cols.has(n.level)) cols.set(n.level, []);
    cols.get(n.level).push(n);
  }
  const positions = new Map();
  let maxRows = 0;
  const levels = [...cols.keys()].sort((a, b) => a - b);
  levels.forEach((l, ci) => {
    // Most-blocking first, then cycle members together.
    const col = cols.get(l).sort((a, b) => b.victims - a.victims || Number(b.inCycle) - Number(a.inCycle) || Number(a.pid) - Number(b.pid));
    maxRows = Math.max(maxRows, col.length);
    col.forEach((n, ri) => positions.set(n.pid, { x: pad + ci * (nodeW + colGap), y: pad + ri * (nodeH + rowGap) }));
  });
  return {
    positions,
    nodeW,
    nodeH,
    width: pad * 2 + Math.max(1, levels.length) * nodeW + Math.max(0, levels.length - 1) * colGap + 60,
    height: pad * 2 + Math.max(1, maxRows) * nodeH + Math.max(0, maxRows - 1) * rowGap,
  };
}
