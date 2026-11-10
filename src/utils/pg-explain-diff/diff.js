/**
 * Compare two analysed EXPLAIN plans (from ../pg-explain/plan.js parsePlan).
 *
 * Matching: the roots are paired, then each pair's children are aligned in
 * order (a small LCS-style DP over a similarity score). Similarity looks at
 * the node type, the relation / CTE / function scanned, the index, the set of
 * relations below the node and the parent relationship. A node that only
 * exists on one side and has a single child (a Sort, Hash, Materialize or
 * Gather that appeared or vanished) can be skipped over, so its child still
 * lines up with the other plan. Anything left unmatched is added / removed.
 */
import { nodeTarget, parsePlan } from "../pg-explain/plan.js";

const ALIAS_SCANS = new Set(["Subquery Scan", "Values Scan"]);

/** What a node reads: relation, CTE, function or subquery alias. */
export function relKey(node) {
  const r = node.raw;
  return (
    r["Relation Name"] ??
    (r["CTE Name"] && `cte:${r["CTE Name"]}`) ??
    (r["Function Name"] && `fn:${r["Function Name"]}`) ??
    (ALIAS_SCANS.has(r["Node Type"]) && r.Alias ? `alias:${r.Alias}` : null)
  );
}

function family(type) {
  if (/Scan$/.test(type)) return "scan";
  if (/Join$/.test(type) || type === "Nested Loop") return "join";
  if (type === "Aggregate" || type === "Group" || type === "WindowAgg") return "agg";
  if (/Sort$/.test(type)) return "sort";
  if (/^Gather/.test(type)) return "gather";
  if (/Append$/.test(type)) return "append";
  return type;
}

function subtreeRels(node, memo) {
  let set = memo.get(node);
  if (!set) {
    set = new Set();
    const k = relKey(node);
    if (k) set.add(k);
    for (const c of node.children) for (const r of subtreeRels(c, memo)) set.add(r);
    memo.set(node, set);
  }
  return set;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similarity of two nodes on their own; 0 means "never pair these". */
export function similarity(a, b, memo = new Map()) {
  const ta = a.raw["Node Type"];
  const tb = b.raw["Node Type"];
  const typeScore = ta === tb ? 2 : family(ta) === family(tb) ? 1 : 0;
  const ra = relKey(a);
  const rb = relKey(b);
  let s;
  if (ra || rb) {
    if (ra !== rb) return 0;
    s = 3 + typeScore + (a.raw["Index Name"] === b.raw["Index Name"] ? 0.5 : 0);
  } else {
    const j = jaccard(subtreeRels(a, memo), subtreeRels(b, memo));
    if (j === 0 && typeScore === 0) return 0;
    s = 2 * j + typeScore;
    if (a.raw["Index Name"] && a.raw["Index Name"] === b.raw["Index Name"]) s += 1;
    if (s <= 0) return 0;
  }
  const relA = a.relationship ?? "";
  const relB = b.relationship ?? "";
  if (relA === relB) s += 0.5;
  else if (/Plan$/.test(relA) || /Plan$/.test(relB)) s -= 1.5; // InitPlan/SubPlan vs a regular child
  if (a.subplanName && a.subplanName === b.subplanName) s += 1;
  return Math.max(0, s);
}

const SKIP_PENALTY = 0.5;

function makeMatcher() {
  const memo = new Map();
  const relMemo = new Map();
  /** Best way to pair x with y: directly, or by skipping a single-child wrapper on one side. */
  const pair = (x, y) => {
    const key = `${x.id},${y.id}`;
    let best = memo.get(key);
    if (best) return best;
    best = { score: similarity(x, y, relMemo), kind: "direct" };
    // Nodes of the same type always pair directly; skipping is for a wrapper that appeared or vanished.
    if (x.raw["Node Type"] === y.raw["Node Type"] && best.score > 0) {
      memo.set(key, best);
      return best;
    }
    if (x.children.length === 1) {
      const s = pair(x.children[0], y).score - SKIP_PENALTY;
      if (s > best.score) best = { score: s, kind: "skipA" };
    }
    if (y.children.length === 1) {
      const s = pair(x, y.children[0]).score - SKIP_PENALTY;
      if (s > best.score) best = { score: s, kind: "skipB" };
    }
    memo.set(key, best);
    return best;
  };
  return pair;
}

const targetText = (n) => nodeTarget(n.raw).map((t) => (t.kind === "index" ? `using ${t.text}` : `on ${t.text}`)).join(" ");

/** One-sided subtree (all added or all removed). */
function oneSided(node, side) {
  return {
    a: side === "a" ? node : null,
    b: side === "b" ? node : null,
    status: side === "a" ? "removed" : "added",
    children: node.children.map((c) => oneSided(c, side)),
  };
}

function build(x, y, pair, kind = pair(x, y).kind) {
  if (kind === "skipA") return { a: x, b: null, status: "removed", wrapper: true, children: [build(x.children[0], y, pair)] };
  if (kind === "skipB") return { a: null, b: y, status: "added", wrapper: true, children: [build(x, y.children[0], pair)] };
  const changes = [];
  if (x.title !== y.title) changes.push({ what: "type", from: x.title, to: y.title });
  if ((x.raw["Index Name"] ?? "") !== (y.raw["Index Name"] ?? "")) {
    changes.push({ what: "index", from: x.raw["Index Name"] ?? "none", to: y.raw["Index Name"] ?? "none" });
  }
  if (relKey(x) !== relKey(y) || targetText(x).replace(/using \S+ ?/, "") !== targetText(y).replace(/using \S+ ?/, "")) {
    changes.push({ what: "target", from: targetText(x) || "none", to: targetText(y) || "none" });
  }
  return { a: x, b: y, status: changes.length ? "changed" : "same", changes, children: align(x.children, y.children, pair) };
}

/** Order-preserving alignment of two child lists, maximising total pair score. */
function align(as, bs, pair) {
  const n = as.length;
  const m = bs.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = pair(as[i - 1], bs[j - 1]).score;
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s > 0 ? dp[i - 1][j - 1] + s : -Infinity);
    }
  }
  const out = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const s = pair(as[i - 1], bs[j - 1]).score;
      if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
        out.push(build(as[i - 1], bs[j - 1], pair));
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && (i === 0 || dp[i][j] === dp[i][j - 1])) {
      out.push(oneSided(bs[j - 1], "b"));
      j--;
    } else {
      out.push(oneSided(as[i - 1], "a"));
      i--;
    }
  }
  // Removed before added within a gap reads more naturally.
  return out.reverse();
}

// ---------- metrics ----------
export const METRICS = [
  { id: "self", label: "Self time", short: "self", unit: "ms", get: (n) => n.exclusive },
  { id: "total", label: "Total time", short: "total", unit: "ms", get: (n) => n.inclusive },
  { id: "rows", label: "Rows", short: "rows", neutral: true, get: (n) => n.rows ?? n.planRows },
  { id: "loops", label: "Loops", short: "loops", neutral: true, get: (n) => (n.analyzed ? n.loops : undefined) },
  { id: "hit", label: "Shared hit", short: "hit", unit: "blocks", get: (n) => n.selfBuffers?.sharedHit },
  { id: "read", label: "Shared read", short: "read", unit: "blocks", get: (n) => n.selfBuffers?.sharedRead },
  { id: "cost", label: "Self cost", short: "cost", get: (n) => n.selfCost },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.id, m]));

/** Minimum change worth colouring, per unit. */
const MIN_ABS = { ms: 0.05, blocks: 1, undefined: 0.5 };
const MIN_PCT = 0.05;

/**
 * { before, after, delta, pct, tone } for one metric of a merged node.
 * tone: "worse" | "better" (lower is better for time, blocks and cost), "neutral" (rows, loops) or "none".
 */
export function metricDelta(merged, metricId) {
  const m = METRIC[metricId];
  const before = merged.a ? m.get(merged.a) : undefined;
  const after = merged.b ? m.get(merged.b) : undefined;
  if (before === undefined && after === undefined) return { before, after, tone: "none" };
  const delta = (after ?? 0) - (before ?? 0);
  const pct = before > 0 && after !== undefined ? delta / before : undefined;
  let tone = "none";
  const significant = Math.abs(delta) >= MIN_ABS[m.unit] && (pct === undefined || Math.abs(pct) >= MIN_PCT);
  if (significant) tone = m.neutral ? (before !== undefined && after !== undefined ? "neutral" : "none") : delta > 0 ? "worse" : "better";
  return { before, after, delta, pct, tone };
}

function flatten(root) {
  const rows = [];
  const walk = (node, depth, parent) => {
    node.id = rows.length;
    node.depth = depth;
    node.parent = parent;
    rows.push(node);
    node.children.forEach((c) => walk(c, depth + 1, node));
  };
  walk(root, 0, null);
  return rows;
}

const planTime = (p) => p.executionTime ?? p.root.inclusive;

/**
 * Diff two already-parsed plans. Returns { root, rows, basis, summary }.
 * basis is "time" when both plans have ANALYZE data, otherwise "cost".
 */
export function diffPlans(before, after) {
  const pair = makeMatcher();
  const root = build(before.root, after.root, pair, pair(before.root, after.root).kind);
  const rows = flatten(root);
  const basis = before.analyzed && after.analyzed ? "time" : "cost";
  const blame = basis === "time" ? "self" : "cost";

  const total =
    basis === "time"
      ? { before: planTime(before), after: planTime(after), unit: "ms" }
      : { before: before.root.totalCost, after: after.root.totalCost, unit: "cost" };
  total.delta = (total.after ?? 0) - (total.before ?? 0);
  total.pct = total.before > 0 ? total.delta / total.before : undefined;
  total.ratio = total.before > 0 && total.after > 0 ? total.before / total.after : undefined;

  const counts = { same: 0, changed: 0, added: 0, removed: 0 };
  rows.forEach((r) => counts[r.status]++);

  const ranked = rows
    .map((r) => ({ node: r, ...metricDelta(r, blame) }))
    .filter((d) => d.tone === "worse" || d.tone === "better");
  const regressions = ranked.filter((d) => d.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, 5);
  const improvements = ranked.filter((d) => d.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, 5);

  const rootBuf = (p) => p.root.bufferTotals;
  const summary = {
    basis,
    total,
    planning: { before: before.planningTime, after: after.planningTime },
    buffers:
      rootBuf(before) || rootBuf(after)
        ? {
            hit: { before: rootBuf(before)?.sharedHit, after: rootBuf(after)?.sharedHit },
            read: { before: rootBuf(before)?.sharedRead, after: rootBuf(after)?.sharedRead },
          }
        : null,
    nodes: { before: before.nodes.length, after: after.nodes.length },
    cost: { before: before.root.totalCost, after: after.root.totalCost },
    counts,
    typeChanges: rows.filter((r) => r.status === "changed"),
    added: rows.filter((r) => r.status === "added" && (r.wrapper || r.parent?.status !== "added")),
    removed: rows.filter((r) => r.status === "removed" && (r.wrapper || r.parent?.status !== "removed")),
    regressions,
    improvements,
  };
  return { root, rows, basis, summary, before, after };
}

/** Parse both inputs and diff them. Returns { before, after, diff } where before/after may carry { error }. */
export function diffTexts(beforeText, afterText) {
  const before = parsePlan(beforeText);
  const after = parsePlan(afterText);
  if (before.error || after.error) return { before, after, diff: null };
  return { before, after, diff: diffPlans(before, after) };
}

export { targetText };
