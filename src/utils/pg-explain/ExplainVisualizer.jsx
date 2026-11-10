import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { BLOCK_BYTES, CONSUMED_KEYS, NODE_DESCRIPTIONS, metricOf, parsePlan } from "./plan.js";
import { SAMPLE_PLAN } from "./sample.js";

const METRICS = [
  { id: "time", label: "Time", needs: "analyzed" },
  { id: "rows", label: "Rows", needs: "analyzed" },
  { id: "buffers", label: "Buffers", needs: "hasBuffers" },
  { id: "cost", label: "Cost" },
];

const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

// ---------- formatting ----------
function fmtMs(ms) {
  if (ms === undefined) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms > 0 && ms < 0.01) return "<0.01 ms";
  return `${ms.toFixed(2)} ms`;
}

/** 1.2k, 3.4m style for badges. */
function fmtShort(n) {
  if (n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

const fmtNum = (n) => (n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtPct = (p) => `${(p * 100).toFixed(p >= 0.1 || p === 0 ? 0 : 1)}%`;
const fmtCost = (c) => (c === undefined ? "—" : c.toLocaleString("en-US", { maximumFractionDigits: 2 }));

function fmtBytes(blocks) {
  const mb = (blocks * BLOCK_BYTES) / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.round((blocks * BLOCK_BYTES) / 1024)} kB`;
}

/** Heat colour class for a 0..1 share. */
const heat = (share) => (share >= 0.3 ? "is-hot" : share >= 0.1 ? "is-warm" : "is-cool");

function metricLabel(node, metric, totals) {
  const { value, share } = metricOf(node, metric, totals);
  if (value === undefined) return { text: "—", share: 0 };
  if (metric === "time") return { text: `${fmtMs(value)} · ${fmtPct(share)}`, share };
  if (metric === "rows") return { text: `${fmtShort(value)} rows`, share };
  if (metric === "buffers") return { text: `${fmtShort(value)} blocks · ${fmtPct(share)}`, share };
  return { text: `cost ${fmtShort(value)} · ${fmtPct(share)}`, share };
}

const countDescendants = (node) => node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);

// ---------- tree ----------
function Target({ node }) {
  if (!node.target.length && !node.subplanName) return null;
  return (
    <span className="pe-target">
      {node.target.map((t, i) => (
        <span key={i} className={t.kind === "index" ? "pe-index" : "pe-rel"}>
          {t.kind === "index" ? `using ${t.text}` : `on ${t.text}`}
        </span>
      ))}
      {node.subplanName && <span className="pe-subplan">{node.subplanName}</span>}
    </span>
  );
}

function RowsBadge({ node }) {
  if (node.rows === undefined) {
    return (
      <span className="pe-rows-badge" title="Estimated rows">
        ~{fmtShort(node.planRows)}
      </span>
    );
  }
  const off = node.estimateFactor >= 10 && !(node.underLimit && node.estimateDirection === "over");
  return (
    <span
      className={off ? "pe-rows-badge is-off" : "pe-rows-badge"}
      title={`${fmtNum(node.rows)} actual rows, ${fmtNum(node.planRows)} estimated`}
    >
      {fmtShort(node.rows)}
    </span>
  );
}

function NodeCard({ node, plan, metric, selected, onSelect, cardRefs }) {
  const issues = plan.issuesByNode.get(node.id) ?? [];
  const worst = issues[0]?.severity;
  const m = metricLabel(node, metric, plan.totals);
  const type = node.raw["Node Type"];
  const flag = type === "Seq Scan" ? "is-seq" : type === "Nested Loop" ? "is-nl" : "";

  return (
    <button
      type="button"
      ref={(el) => (el ? cardRefs.current.set(node.id, el) : cardRefs.current.delete(node.id))}
      className={["pe-node", selected ? "is-selected" : "", node.neverExecuted ? "is-never" : "", flag].join(" ")}
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
    >
      <span className="pe-node-head">
        <span className="pe-node-id">#{node.id}</span>
        <span className="pe-node-title">
          <span className="pe-node-type">{node.title}</span> <Target node={node} />
        </span>
        {issues.length > 0 && (
          <span className={`pe-issue-dot is-${worst}`} title={`${issues.length} finding${issues.length > 1 ? "s" : ""}`}>
            <i className="fa fa-exclamation-triangle" aria-hidden="true"></i>
            {issues.length > 1 ? ` ${issues.length}` : ""}
          </span>
        )}
      </span>
      <span className="pe-node-meta">
        {node.neverExecuted ? (
          <span>never executed</span>
        ) : (
          <>
            <span className={`pe-metric ${heat(m.share)}`}>{m.text}</span>
            {node.loops > 1 && <span>× {fmtShort(node.loops)} loops</span>}
            {node.estimateFactor >= 10 && !(node.underLimit && node.estimateDirection === "over") && (
              <span className="pe-misest">
                {node.estimateDirection === "under" ? "↑" : "↓"} est. {Math.round(node.estimateFactor)}×
              </span>
            )}
          </>
        )}
      </span>
      <span className="pe-heat" aria-hidden="true">
        <span className={heat(m.share)} style={{ width: `${Math.min(100, m.share * 100)}%` }} />
      </span>
    </button>
  );
}

function TreeNode({ node, ...props }) {
  const { collapsed, toggle } = props;
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div className="pe-row">
        <RowsBadge node={node} />
        {hasChildren ? (
          <button
            type="button"
            className="pe-toggle"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand #${node.id}` : `Collapse #${node.id}`}
            onClick={() => toggle(node.id)}
          >
            <i className={`fa ${isCollapsed ? "fa-plus" : "fa-minus"}`} aria-hidden="true"></i>
          </button>
        ) : (
          <span className="pe-toggle-spacer" />
        )}
        <NodeCard node={node} {...props} selected={props.selectedId === node.id} />
        {hasChildren && isCollapsed && (
          <button type="button" className="pe-collapsed" onClick={() => toggle(node.id)}>
            {countDescendants(node)} nodes hidden
          </button>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="pe-children">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Stacked bar of self time (or the chosen metric) per node, largest first. */
function ShareBar({ plan, metric, selectedId, onSelect }) {
  const parts = plan.nodes
    .map((n) => ({ node: n, share: metricOf(n, metric, plan.totals).share }))
    .filter((p) => p.share >= 0.01)
    .sort((a, b) => b.share - a.share);
  const rest = Math.max(0, 1 - parts.reduce((s, p) => s + p.share, 0));
  const heading =
    metric === "time"
      ? `Total time: ${fmtMs(plan.totals.time)}`
      : metric === "cost"
        ? `Total cost: ${fmtCost(plan.totals.cost)}`
        : metric === "buffers"
          ? `Buffers touched: ${fmtNum(plan.totals.blocks)} blocks (${fmtBytes(plan.totals.blocks)})`
          : `Most rows at one node: ${fmtNum(plan.totals.rows)}`;

  return (
    <div className="pe-sharebar">
      <div className="pe-sharebar-title">{heading}</div>
      {metric !== "rows" && (
        <div className="pe-sharebar-track" role="group" aria-label="Share per node">
          {parts.map(({ node, share }) => (
            <button
              key={node.id}
              type="button"
              className={[heat(share), selectedId === node.id ? "is-selected" : ""].join(" ")}
              style={{ flexGrow: share }}
              title={`#${node.id} ${node.title}: ${fmtPct(share)}`}
              onClick={() => onSelect(node.id)}
            >
              {share >= 0.06 ? `#${node.id}` : ""}
            </button>
          ))}
          {rest > 0.001 && <span className="pe-sharebar-rest" style={{ flexGrow: rest }} />}
        </div>
      )}
    </div>
  );
}

// ---------- sidebar ----------
function Stat({ label, value, hint }) {
  return (
    <div className="pe-stat">
      <span className="pe-stat-label">{label}</span>
      <span className="pe-stat-value">{value}</span>
      {hint && <span className="pe-stat-hint">{hint}</span>}
    </div>
  );
}

function IssueList({ issues, onSelect, showNode = true }) {
  if (!issues.length) return <p className="pe-muted">No findings.</p>;
  return (
    <ul className="pe-issues">
      {issues.map((issue, i) => (
        <li key={i} className={`is-${issue.severity}`}>
          {showNode ? (
            <button type="button" className="pe-issue-link" onClick={() => onSelect(issue.node.id)}>
              <span className={`pe-sev is-${issue.severity}`}>{SEVERITY_LABEL[issue.severity]}</span>
              <span className="pe-issue-node">
                #{issue.node.id} {issue.node.title}
              </span>
              <span className="pe-issue-title">{issue.title}</span>
            </button>
          ) : (
            <details open={i === 0}>
              <summary>
                <span className={`pe-sev is-${issue.severity}`}>{SEVERITY_LABEL[issue.severity]}</span>
                <span className="pe-issue-title">{issue.title}</span>
              </summary>
              <p>{issue.detail}</p>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

function BufferTable({ node }) {
  const self = node.selfBuffers;
  const all = node.bufferTotals;
  if (!all) return <p className="pe-muted">No buffer data. Run EXPLAIN with BUFFERS.</p>;
  const rows = [
    ["Shared hit", "sharedHit"],
    ["Shared read", "sharedRead"],
    ["Shared dirtied", "sharedDirtied"],
    ["Shared written", "sharedWritten"],
    ["Local hit", "localHit"],
    ["Local read", "localRead"],
    ["Temp read", "tempRead"],
    ["Temp written", "tempWritten"],
  ].filter(([, k]) => all[k] > 0 || k === "sharedHit" || k === "sharedRead");
  const ratio = (b) => (b.sharedHit + b.sharedRead > 0 ? fmtPct(b.sharedHit / (b.sharedHit + b.sharedRead)) : "—");

  return (
    <div className="pe-table" role="table" aria-label="Buffers">
      <div className="pe-tr pe-th" role="row">
        <span role="columnheader">Blocks</span>
        <span role="columnheader">This node</span>
        <span role="columnheader">With children</span>
      </div>
      {rows.map(([label, k]) => (
        <div className="pe-tr" role="row" key={k}>
          <span role="cell">{label}</span>
          <span role="cell" title={fmtBytes(self[k])}>
            {fmtNum(self[k])}
          </span>
          <span role="cell" title={fmtBytes(all[k])}>
            {fmtNum(all[k])}
          </span>
        </div>
      ))}
      <div className="pe-tr" role="row">
        <span role="cell">Cache hit ratio</span>
        <span role="cell">{ratio(self)}</span>
        <span role="cell">{ratio(all)}</span>
      </div>
    </div>
  );
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value, null, 1);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function NodeDetails({ node, plan, onBack, onSelect }) {
  const issues = plan.issuesByNode.get(node.id) ?? [];
  const description = NODE_DESCRIPTIONS[node.raw["Node Type"]];
  const extra = Object.entries(node.raw).filter(([k]) => !CONSUMED_KEYS.has(k));
  const share = plan.totals.time > 0 && node.exclusive !== undefined ? node.exclusive / plan.totals.time : undefined;
  const removed = [
    ["Removed by filter", node.removed.filter],
    ["Removed by join filter", node.removed.joinFilter],
    ["Removed by index recheck", node.removed.recheck],
  ].filter(([, v]) => v > 0);

  return (
    <div className="pe-details">
      <button type="button" className="pe-back" onClick={onBack}>
        <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;Plan summary
      </button>
      <h2 className="pe-h">
        #{node.id} {node.title}
      </h2>
      <p className="pe-subtitle">
        <Target node={node} />
        {node.parent && (
          <>
            {" "}
            · child of{" "}
            <button type="button" className="pe-inline-link" onClick={() => onSelect(node.parent.id)}>
              #{node.parent.id}
            </button>
            {node.relationship ? ` (${node.relationship})` : ""}
          </>
        )}
      </p>

      {issues.length > 0 && (
        <section>
          <h3 className="pe-h3">Findings</h3>
          <IssueList issues={issues} showNode={false} />
        </section>
      )}

      {node.analyzed && (
        <section>
          <h3 className="pe-h3">Time</h3>
          {node.neverExecuted ? (
            <p className="pe-muted">Never executed: the planner included it, but no rows ever reached it.</p>
          ) : (
            <div className="pe-stats">
              <Stat label="Self" value={fmtMs(node.exclusive)} hint={share !== undefined ? `${fmtPct(share)} of total` : undefined} />
              <Stat label="With children" value={fmtMs(node.inclusive)} />
              <Stat
                label="Per loop"
                value={`${fmtMs(node.startupTime)} → ${fmtMs(node.totalTimePerLoop)}`}
                hint="first row → last row"
              />
              <Stat
                label="Loops"
                value={fmtNum(node.loops)}
                hint={node.procs > 1 ? `across ${node.procs} parallel processes` : undefined}
              />
              {node.ioRead !== undefined && <Stat label="I/O read" value={fmtMs(node.ioRead)} />}
              {node.ioWrite !== undefined && node.ioWrite > 0 && <Stat label="I/O write" value={fmtMs(node.ioWrite)} />}
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="pe-h3">Rows</h3>
        <div className="pe-stats">
          {node.analyzed && (
            <Stat
              label="Actual"
              value={fmtNum(node.rows)}
              hint={node.loops > 1 ? `${fmtNum(node.rowsPerLoop)} per loop` : undefined}
            />
          )}
          <Stat
            label="Estimated"
            value={fmtNum(node.planRows)}
            hint={node.loops > 1 ? `${fmtNum(node.planRowsPerLoop)} per loop` : undefined}
          />
          {node.estimateFactor !== undefined && (
            <Stat
              label="Estimate"
              value={node.estimateDirection === "exact" ? "exact" : `${node.estimateFactor.toFixed(1)}× ${node.estimateDirection}`}
              hint={node.underLimit && node.estimateDirection === "over" ? "stopped early by a Limit" : undefined}
            />
          )}
          {removed.map(([label, v]) => (
            <Stat key={label} label={label} value={fmtNum(v)} />
          ))}
          <Stat label="Width" value={`${fmtNum(node.raw["Plan Width"])} bytes`} />
        </div>
      </section>

      {plan.hasBuffers && (
        <section>
          <h3 className="pe-h3">Buffers</h3>
          <BufferTable node={node} />
        </section>
      )}

      <section>
        <h3 className="pe-h3">Cost</h3>
        <div className="pe-stats">
          <Stat label="Startup → total" value={`${fmtCost(node.startupCost)} → ${fmtCost(node.totalCost)}`} />
          <Stat label="Self" value={fmtCost(node.selfCost)} />
        </div>
      </section>

      {extra.length > 0 && (
        <section>
          <h3 className="pe-h3">Details</h3>
          <div className="pe-kv">
            {extra.map(([k, v]) => (
              <div key={k} className="pe-kv-row">
                <span className="pe-kv-key">{k}</span>
                <code className="pe-kv-val">{formatValue(v)}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      {description && (
        <section>
          <h3 className="pe-h3">What this node does</h3>
          <p>{description}</p>
        </section>
      )}
    </div>
  );
}

function Summary({ plan, onSelect }) {
  const rootBuf = plan.root.bufferTotals;
  const jitTotal = plan.jit?.Timing?.Total;
  const jitMs = typeof jitTotal === "number" ? jitTotal : jitTotal?.Total;

  return (
    <div className="pe-details">
      <h2 className="pe-h">Plan summary</h2>
      {!plan.analyzed && (
        <p className="pe-note">
          No ANALYZE data, so this shows the planner&apos;s estimates only. Run EXPLAIN (ANALYZE, BUFFERS) for real timings.
        </p>
      )}
      <div className="pe-stats">
        {plan.executionTime !== undefined && <Stat label="Execution" value={fmtMs(plan.executionTime)} />}
        {plan.planningTime !== undefined && <Stat label="Planning" value={fmtMs(plan.planningTime)} />}
        <Stat label="Nodes" value={plan.nodes.length} />
        <Stat label="Total cost" value={fmtCost(plan.totals.cost)} />
        {rootBuf && (
          <Stat
            label="Shared hit / read"
            value={`${fmtShort(rootBuf.sharedHit)} / ${fmtShort(rootBuf.sharedRead)}`}
            hint={`${fmtBytes(rootBuf.sharedHit + rootBuf.sharedRead)} touched`}
          />
        )}
        {rootBuf && rootBuf.tempWritten > 0 && <Stat label="Temp written" value={fmtBytes(rootBuf.tempWritten)} />}
        {plan.triggers.length > 0 && <Stat label="Triggers" value={fmtMs(plan.triggerTime)} hint={`${plan.triggers.length} trigger(s)`} />}
        {jitMs !== undefined && <Stat label="JIT" value={fmtMs(jitMs)} hint={`${plan.jit.Functions ?? "?"} functions`} />}
      </div>
      {plan.statementCount > 1 && (
        <p className="pe-note">The input has {plan.statementCount} plans; showing the first.</p>
      )}

      <section>
        <h3 className="pe-h3">Findings ({plan.issues.length})</h3>
        <IssueList issues={plan.issues} onSelect={onSelect} />
      </section>

      {plan.settings && Object.keys(plan.settings).length > 0 && (
        <section>
          <h3 className="pe-h3">Non-default settings</h3>
          <div className="pe-kv">
            {Object.entries(plan.settings).map(([k, v]) => (
              <div key={k} className="pe-kv-row">
                <span className="pe-kv-key">{k}</span>
                <code className="pe-kv-val">{String(v)}</code>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="pe-muted pe-tip">Click a node in the tree for its timing, rows, buffers and full details.</p>
    </div>
  );
}

// ---------- main ----------
export default function ExplainVisualizer({ heading }) {
  const [input, setInput, status] = useLocalStorage("pg-explain:input", SAMPLE_PLAN);
  const [prefs, setPrefs] = useLocalStorage("pg-explain:prefs", { view: "plan", metric: "time" });
  const [selectedId, setSelectedId] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const cardRefs = useRef(new Map());

  const deferredInput = useDeferredValue(input);
  const plan = useMemo(() => {
    const parsed = parsePlan(deferredInput);
    if (parsed.error) return parsed;
    const issuesByNode = new Map();
    parsed.issues.forEach((issue) => {
      const list = issuesByNode.get(issue.node.id) ?? [];
      list.push(issue);
      issuesByNode.set(issue.node.id, list);
    });
    return { ...parsed, issuesByNode };
  }, [deferredInput]);

  // A new plan invalidates node ids.
  useEffect(() => {
    setSelectedId(null);
    setCollapsed(new Set());
  }, [deferredInput]);

  const available = (m) => !m.needs || (!plan.error && plan[m.needs]);
  const metric = METRICS.find((m) => m.id === prefs.metric && available(m)) ? prefs.metric : "cost";
  const view = prefs.view === "input" || plan.error ? "input" : "plan";
  const selected = !plan.error && selectedId !== null ? plan.nodes[selectedId] : null;

  const select = (id) => {
    // Reveal the node if an ancestor is collapsed.
    const node = plan.nodes[id];
    if (!node) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (let p = node.parent; p; p = p.parent) next.delete(p.id);
      return next;
    });
    setSelectedId(id);
  };

  useEffect(() => {
    if (selectedId === null) return;
    cardRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setView = (v) => setPrefs({ ...prefs, view: v });

  return (
    <div className="pg-explain">
      <div className="util-toolbar" role="toolbar" aria-label="EXPLAIN visualizer">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {[
            { id: "input", label: "Input", icon: "fa-code" },
            { id: "plan", label: "Plan", icon: "fa-sitemap" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              disabled={v.id === "plan" && Boolean(plan.error)}
              onClick={() => setView(v.id)}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        {view === "plan" && (
          <div className="util-segmented" role="group" aria-label="Highlight by">
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={metric === m.id ? "button small is-active" : "button small"}
                aria-pressed={metric === m.id}
                disabled={!available(m)}
                title={available(m) ? `Highlight nodes by ${m.label.toLowerCase()}` : `Needs EXPLAIN ${m.needs === "hasBuffers" ? "BUFFERS" : "ANALYZE"}`}
                onClick={() => setPrefs({ ...prefs, metric: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <span className="util-toolbar-spacer" />
        {view === "plan" && (
          <>
            <button type="button" className="button small" onClick={() => setCollapsed(new Set())} title="Expand all nodes">
              <i className="fa fa-expand" aria-hidden="true"></i>
              <span className="pe-sr">Expand all</span>
            </button>
            <button
              type="button"
              className="button small"
              title="Collapse all but the top level"
              onClick={() => setCollapsed(new Set(plan.nodes.filter((n) => n.depth >= 1 && n.children.length).map((n) => n.id)))}
            >
              <i className="fa fa-compress" aria-hidden="true"></i>
              <span className="pe-sr">Collapse all</span>
            </button>
          </>
        )}
        <button
          type="button"
          className="button small"
          onClick={() => {
            setInput(SAMPLE_PLAN);
            setView("plan");
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (input && window.confirm("Clear the pasted plan?")) {
              setInput("");
              setView("input");
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      {view === "input" ? (
        <div className="pe-input">
          <p className="pe-input-hint">
            Run <code>EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) &lt;query&gt;;</code> and paste the output. Copying
            straight from psql (with its <code>+</code> line wraps) works too. Add <code>SETTINGS</code> to see non-default
            planner settings.
          </p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder='[ { "Plan": { "Node Type": ... } } ]'
            aria-label="EXPLAIN JSON"
          />
          <div className="pe-input-actions">
            {plan.error && plan.error !== "empty" && (
              <span className="pe-error" role="alert">
                <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {plan.error}
              </span>
            )}
            <span className="util-toolbar-spacer" />
            <button type="button" className="button small primary" disabled={Boolean(plan.error)} onClick={() => setView("plan")}>
              Visualize&nbsp;<i className="fa fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      ) : (
        <div className="pe-main">
          <aside className="pe-side" aria-label={selected ? "Node details" : "Plan summary"}>
            {selected ? (
              <NodeDetails node={selected} plan={plan} onBack={() => setSelectedId(null)} onSelect={select} />
            ) : (
              <Summary plan={plan} onSelect={select} />
            )}
          </aside>
          <section className="pe-canvas" aria-label="Plan tree">
            <ShareBar plan={plan} metric={metric} selectedId={selectedId} onSelect={select} />
            <ul className="pe-tree">
              <TreeNode
                node={plan.root}
                plan={plan}
                metric={metric}
                selectedId={selectedId}
                onSelect={select}
                collapsed={collapsed}
                toggle={toggle}
                cardRefs={cardRefs}
              />
            </ul>
            <p className="pe-legend">
              <span className="pe-rows-badge">12k</span> rows returned ·{" "}
              <span className="pe-rows-badge is-off">12k</span> misestimated 10×+ ·{" "}
              <span className="pe-legend-seq">Seq Scan</span> · <span className="pe-legend-nl">Nested Loop</span>
            </p>
          </section>
        </div>
      )}

      <div className="util-statusbar">
        <span>
          {plan.error
            ? "No plan"
            : `${plan.nodes.length} nodes · ${plan.issues.length} findings${plan.analyzed ? "" : " · estimates only"}`}
        </span>
        <span>Parsed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
