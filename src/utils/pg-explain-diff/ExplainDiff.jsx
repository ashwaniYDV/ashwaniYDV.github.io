import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { METRIC, diffTexts, metricDelta, targetText } from "./diff.js";
import { SAMPLE_AFTER, SAMPLE_BEFORE } from "./samples.js";
import "./explain-diff.css";

// ---------- formatting ----------
function fmtMs(ms) {
  if (ms === undefined) return "—";
  const abs = Math.abs(ms);
  if (abs >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (abs >= 100) return `${ms.toFixed(0)} ms`;
  if (abs >= 10) return `${ms.toFixed(1)} ms`;
  if (abs > 0 && abs < 0.01) return "<0.01 ms";
  return `${ms.toFixed(2)} ms`;
}

function fmtShort(n) {
  if (n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

const fmtNum = (n) => (n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));

const fmtValue = (metricId, v) => (METRIC[metricId].unit === "ms" ? fmtMs(v) : fmtShort(v));

function fmtPct(p) {
  if (p === undefined) return "";
  // Above +900% a multiplier reads better than a huge percentage.
  if (p >= 9) return `${Math.round(1 + p).toLocaleString("en-US")}×`;
  const v = p * 100;
  const s = Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
  return `${v > 0 ? "+" : ""}${s}%`;
}

function fmtDelta(metricId, d) {
  if (d.delta === undefined) return "";
  const sign = d.delta > 0 ? "+" : d.delta < 0 ? "−" : "±";
  const abs = Math.abs(d.delta);
  return `${sign}${METRIC[metricId].unit === "ms" ? fmtMs(abs) : fmtShort(abs)}`;
}

const STATUS_LABEL = { same: "same", changed: "changed", added: "added", removed: "removed" };
const CHIP_METRICS = ["self", "total", "rows", "loops", "hit", "read"];

/** Which per-node chips to show: time/rows/loops/buffers that carry information. */
function chipList(row, basis) {
  const ids = basis === "time" ? CHIP_METRICS : ["cost", "rows"];
  return ids
    .map((id) => ({ id, d: metricDelta(row, id) }))
    .filter(({ id, d }) => {
      if (d.before === undefined && d.after === undefined) return false;
      if (id === "loops") return (d.before ?? 1) !== 1 || (d.after ?? 1) !== 1;
      if (id === "hit" || id === "read") return (d.before ?? 0) > 0 || (d.after ?? 0) > 0;
      return true;
    });
}

// ---------- pieces ----------
function NodeLabel({ row }) {
  const a = row.a;
  const b = row.b;
  const typeChanged = a && b && a.title !== b.title;
  const node = b ?? a;
  const target = targetText(node);
  // Index changes already show in the after target; only call out a different relation/alias.
  const relOnly = (n) => targetText(n).replace(/using \S+ ?/, "");
  const oldTarget = a && b && relOnly(a) !== relOnly(b) ? targetText(a) : null;
  return (
    <span className="ped-label">
      <span className={`ped-status is-${row.status}`}>{STATUS_LABEL[row.status]}</span>
      {typeChanged ? (
        <span className="ped-type">
          <s>{a.title}</s> <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          <span className="pe-sr"> changed to </span> {b.title}
        </span>
      ) : (
        <span className="ped-type">{node.title}</span>
      )}
      {target && <span className="ped-target">{target}</span>}
      {oldTarget && (
        <span className="ped-target is-old">
          (was {oldTarget})
        </span>
      )}
      {node.subplanName && <span className="ped-subplan">{node.subplanName}</span>}
    </span>
  );
}

function Chip({ id, d, compact }) {
  const m = METRIC[id];
  const one = d.before === undefined || d.after === undefined;
  return (
    <span className={`ped-chip is-${d.tone}`} title={`${m.label}: ${fmtValue(id, d.before)} → ${fmtValue(id, d.after)}`}>
      <span className="ped-chip-label">{m.short}</span>
      {one ? (
        <span>{fmtValue(id, d.before ?? d.after)}</span>
      ) : compact ? (
        <span>{fmtValue(id, d.after)}</span>
      ) : (
        <span>
          {fmtValue(id, d.before)} → {fmtValue(id, d.after)}
        </span>
      )}
      {!one && d.tone !== "none" && d.pct !== undefined && <span className="ped-chip-pct">{fmtPct(d.pct)}</span>}
    </span>
  );
}

function MergedCard({ row, basis, selected, onSelect }) {
  const chips = chipList(row, basis);
  return (
    <button
      type="button"
      className={`ped-card is-${row.status}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(row.id)}
      aria-pressed={selected}
    >
      <span className="ped-card-head">
        <span className="ped-ids">
          {row.a ? `#${row.a.id}` : "—"} / {row.b ? `#${row.b.id}` : "—"}
        </span>
        <NodeLabel row={row} />
      </span>
      {row.a?.neverExecuted || row.b?.neverExecuted ? (
        <span className="ped-never">
          {row.a?.neverExecuted ? "never executed before" : ""}
          {row.a?.neverExecuted && row.b?.neverExecuted ? " · " : ""}
          {row.b?.neverExecuted ? "never executed after" : ""}
        </span>
      ) : null}
      {chips.length > 0 && (
        <span className="ped-chips">
          {chips.map(({ id, d }) => (
            <Chip key={id} id={id} d={d} />
          ))}
        </span>
      )}
    </button>
  );
}

function MergedTree({ row, ...props }) {
  return (
    <li>
      <div className="ped-row">
        <MergedCard row={row} {...props} selected={props.selectedId === row.id} />
      </div>
      {row.children.length > 0 && (
        <ul className="ped-children">
          {row.children.map((c) => (
            <MergedTree key={c.id} row={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SideCell({ node, row, side, basis, selected, onSelect }) {
  if (!node) {
    return (
      <div className="ped-cell is-empty" style={{ paddingLeft: `${row.depth * 1.1}em` }}>
        <span className="ped-placeholder">{side === "a" ? "not in before" : "not in after"}</span>
      </div>
    );
  }
  const ids = basis === "time" ? ["self", "total", "rows", "loops", "hit", "read"] : ["cost", "rows"];
  const values = ids
    .map((id) => ({ id, v: METRIC[id].get(node) }))
    .filter(({ id, v }) => v !== undefined && !(id === "loops" && v === 1) && !((id === "hit" || id === "read") && v === 0));
  return (
    <div className="ped-cell" style={{ paddingLeft: `${row.depth * 1.1}em` }}>
      <button
        type="button"
        className={`ped-card is-${row.status}${selected ? " is-selected" : ""}`}
        onClick={() => onSelect(row.id)}
        aria-pressed={selected}
      >
        <span className="ped-card-head">
          <span className="ped-ids">#{node.id}</span>
          <span className="ped-label">
            <span className="ped-type">{node.title}</span>
            {targetText(node) && <span className="ped-target">{targetText(node)}</span>}
          </span>
        </span>
        {node.neverExecuted ? (
          <span className="ped-never">never executed</span>
        ) : (
          <span className="ped-chips">
            {values.map(({ id, v }) => (
              <span key={id} className="ped-chip is-none">
                <span className="ped-chip-label">{METRIC[id].short}</span>
                <span>{fmtValue(id, v)}</span>
              </span>
            ))}
          </span>
        )}
      </button>
    </div>
  );
}

function SideBySide({ diff, selectedId, onSelect }) {
  const blame = diff.basis === "time" ? "self" : "cost";
  return (
    <div className="ped-sbs" role="table" aria-label="Plans side by side">
      <div className="ped-sbs-row ped-sbs-head" role="row">
        <span role="columnheader">Before</span>
        <span role="columnheader">{METRIC[blame].label} Δ</span>
        <span role="columnheader">After</span>
      </div>
      {diff.rows.map((row) => {
        const d = metricDelta(row, blame);
        return (
          <div key={row.id} className={`ped-sbs-row${selectedId === row.id ? " is-selected" : ""}`} role="row">
            <div role="cell">
              <SideCell node={row.a} row={row} side="a" basis={diff.basis} selected={selectedId === row.id} onSelect={onSelect} />
            </div>
            <div role="cell" className={`ped-sbs-delta is-${d.tone}`}>
              <span className={`ped-status is-${row.status}`}>{STATUS_LABEL[row.status]}</span>
              <span>{fmtDelta(blame, d)}</span>
              {d.pct !== undefined && d.tone !== "none" && <span className="ped-chip-pct">{fmtPct(d.pct)}</span>}
            </div>
            <div role="cell">
              <SideCell node={row.b} row={row} side="b" basis={diff.basis} selected={selectedId === row.id} onSelect={onSelect} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- sidebar ----------
function Stat({ label, value, hint, tone }) {
  return (
    <div className="pe-stat">
      <span className="pe-stat-label">{label}</span>
      <span className={`pe-stat-value${tone ? ` ped-tone is-${tone}` : ""}`}>{value}</span>
      {hint && <span className={`pe-stat-hint${tone ? ` ped-tone is-${tone}` : ""}`}>{hint}</span>}
    </div>
  );
}

const toneOf = (before, after, minAbs = 0) => {
  if (before === undefined || after === undefined) return undefined;
  const delta = after - before;
  if (Math.abs(delta) <= minAbs || (before > 0 && Math.abs(delta / before) < 0.05)) return "none";
  return delta > 0 ? "worse" : "better";
};

function speedHint(total) {
  if (total.before === undefined || total.after === undefined) return undefined;
  const pct = fmtPct(total.pct);
  if (!total.ratio || Math.abs(total.pct ?? 0) < 0.05) return pct ? `${pct} (about the same)` : undefined;
  const ratio = total.ratio >= 1 ? total.ratio : 1 / total.ratio;
  const times = ratio >= 10 ? Math.round(ratio).toLocaleString("en-US") : ratio.toFixed(1);
  const word = total.unit === "ms" ? (total.ratio >= 1 ? "faster" : "slower") : total.ratio >= 1 ? "cheaper" : "more expensive";
  return total.pct >= 9 ? `${times}× ${word}` : `${pct} · ${times}× ${word}`;
}

function RowLink({ row, onSelect, children }) {
  return (
    <button type="button" className="ped-link" onClick={() => onSelect(row.id)}>
      {children}
    </button>
  );
}

function Summary({ diff, onSelect }) {
  const s = diff.summary;
  const blame = diff.basis === "time" ? "self" : "cost";
  const fmtTotal = (v) => (s.total.unit === "ms" ? fmtMs(v) : fmtShort(v));
  const listRanked = (items) =>
    items.length ? (
      <ul className="ped-list">
        {items.map((d) => {
          const node = d.node.b ?? d.node.a;
          return (
            <li key={d.node.id}>
              <RowLink row={d.node} onSelect={onSelect}>
                <span className={`ped-delta is-${d.tone}`}>{fmtDelta(blame, d)}</span>
                <span className="ped-list-title">
                  {node.title} {targetText(node)}
                </span>
                <span className={`ped-status is-${d.node.status}`}>{STATUS_LABEL[d.node.status]}</span>
              </RowLink>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="pe-muted">None.</p>
    );

  return (
    <div className="pe-details">
      <h2 className="pe-h">Diff summary</h2>
      {diff.basis === "cost" && (
        <p className="pe-note">
          At least one plan has no ANALYZE data, so this compares the planner&apos;s estimated cost. Use EXPLAIN (ANALYZE,
          BUFFERS) on both for real timings.
        </p>
      )}
      <div className="ped-hero">
        <span className="pe-stat-label">{s.total.unit === "ms" ? "Execution time" : "Total cost"}</span>
        <span className="ped-hero-value">
          {fmtTotal(s.total.before)} <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          <span className="pe-sr"> to </span> {fmtTotal(s.total.after)}
        </span>
        <span className={`ped-hero-hint ped-tone is-${toneOf(s.total.before, s.total.after) ?? "none"}`}>{speedHint(s.total)}</span>
      </div>
      <div className="pe-stats">
        {(s.planning.before !== undefined || s.planning.after !== undefined) && (
          <Stat
            label="Planning"
            value={`${fmtMs(s.planning.before)} → ${fmtMs(s.planning.after)}`}
            tone={toneOf(s.planning.before, s.planning.after, 0.05)}
          />
        )}
        {s.buffers && (
          <>
            <Stat
              label="Shared hit"
              value={`${fmtShort(s.buffers.hit.before)} → ${fmtShort(s.buffers.hit.after)}`}
              tone={toneOf(s.buffers.hit.before, s.buffers.hit.after, 1)}
            />
            <Stat
              label="Shared read"
              value={`${fmtShort(s.buffers.read.before)} → ${fmtShort(s.buffers.read.after)}`}
              tone={toneOf(s.buffers.read.before, s.buffers.read.after, 1)}
            />
          </>
        )}
        {s.total.unit === "ms" && (
          <Stat label="Total cost" value={`${fmtShort(s.cost.before)} → ${fmtShort(s.cost.after)}`} />
        )}
        <Stat
          label="Nodes"
          value={`${s.nodes.before} → ${s.nodes.after}`}
          hint={`${s.counts.changed} changed · ${s.counts.added} added · ${s.counts.removed} removed`}
        />
      </div>

      <section>
        <h3 className="pe-h3">Plan shape changes</h3>
        {s.typeChanges.length + s.added.length + s.removed.length === 0 ? (
          <p className="pe-muted">Same plan shape: every node matched with the same type and target.</p>
        ) : (
          <ul className="ped-list">
            {s.typeChanges.map((row) => (
              <li key={row.id}>
                <RowLink row={row} onSelect={onSelect}>
                  <span className="ped-status is-changed">changed</span>
                  <span className="ped-list-title">
                    {row.a.title === row.b.title ? row.b.title : `${row.a.title} → ${row.b.title}`}{" "}
                    <span className="ped-target">{targetText(row.b)}</span>
                  </span>
                </RowLink>
              </li>
            ))}
            {s.removed.map((row) => (
              <li key={row.id}>
                <RowLink row={row} onSelect={onSelect}>
                  <span className="ped-status is-removed">removed</span>
                  <span className="ped-list-title">
                    {row.a.title} <span className="ped-target">{targetText(row.a)}</span>
                  </span>
                </RowLink>
              </li>
            ))}
            {s.added.map((row) => (
              <li key={row.id}>
                <RowLink row={row} onSelect={onSelect}>
                  <span className="ped-status is-added">added</span>
                  <span className="ped-list-title">
                    {row.b.title} <span className="ped-target">{targetText(row.b)}</span>
                  </span>
                </RowLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="pe-h3">Biggest regressions ({METRIC[blame].label.toLowerCase()})</h3>
        {listRanked(s.regressions)}
      </section>
      <section>
        <h3 className="pe-h3">Biggest improvements ({METRIC[blame].label.toLowerCase()})</h3>
        {listRanked(s.improvements)}
      </section>
      {(diff.before.statementCount > 1 || diff.after.statementCount > 1) && (
        <p className="pe-note">An input has more than one plan; only the first of each is compared.</p>
      )}
      <p className="pe-muted pe-tip">Click a node to compare it in detail. Lower time, blocks and cost are green.</p>
    </div>
  );
}

const DETAIL_KEYS = [
  "Index Name",
  "Index Cond",
  "Filter",
  "Rows Removed by Filter",
  "Join Filter",
  "Rows Removed by Join Filter",
  "Hash Cond",
  "Merge Cond",
  "Recheck Cond",
  "Heap Fetches",
  "Sort Key",
  "Sort Method",
  "Sort Space Used",
  "Sort Space Type",
  "Group Key",
  "Hash Batches",
  "Peak Memory Usage",
  "Workers Planned",
  "Workers Launched",
];

const show = (v) => (v === undefined ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

function NodeCompare({ row, diff, onBack }) {
  const metrics = diff.basis === "time" ? ["self", "total", "rows", "loops", "hit", "read", "cost"] : ["cost", "rows"];
  const keys = DETAIL_KEYS.filter((k) => row.a?.raw[k] !== undefined || row.b?.raw[k] !== undefined);
  const est = (n) => (n ? fmtNum(n.planRows) : "—");
  return (
    <div className="pe-details">
      <button type="button" className="ped-back" onClick={onBack}>
        <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;Diff summary
      </button>
      <h2 className="pe-h">
        <NodeLabel row={row} />
      </h2>
      {row.wrapper && (
        <p className="pe-note">
          This node only exists in the {row.a ? "before" : "after"} plan; its child is matched with the other plan directly.
        </p>
      )}
      <section>
        <h3 className="pe-h3">Metrics</h3>
        <div className="ped-table" role="table" aria-label="Before and after">
          <div className="ped-tr ped-th" role="row">
            <span role="columnheader">Metric</span>
            <span role="columnheader">Before</span>
            <span role="columnheader">After</span>
            <span role="columnheader">Change</span>
          </div>
          {metrics.map((id) => {
            const d = metricDelta(row, id);
            return (
              <div className="ped-tr" role="row" key={id}>
                <span role="cell">{METRIC[id].label}</span>
                <span role="cell">{fmtValue(id, d.before)}</span>
                <span role="cell">{fmtValue(id, d.after)}</span>
                <span role="cell" className={`ped-tone is-${d.tone}`}>
                  {d.before !== undefined && d.after !== undefined ? `${fmtDelta(id, d)} ${fmtPct(d.pct)}` : ""}
                </span>
              </div>
            );
          })}
          <div className="ped-tr" role="row">
            <span role="cell">Estimated rows</span>
            <span role="cell">{est(row.a)}</span>
            <span role="cell">{est(row.b)}</span>
            <span role="cell" />
          </div>
        </div>
      </section>
      {keys.length > 0 && (
        <section>
          <h3 className="pe-h3">Details</h3>
          <div className="ped-kv">
            {keys.map((k) => {
              const a = row.a ? show(row.a.raw[k]) : "—";
              const b = row.b ? show(row.b.raw[k]) : "—";
              return (
                <div key={k} className={`ped-kv-row${a !== b ? " is-diff" : ""}`}>
                  <span className="ped-kv-key">{k}</span>
                  <code className="ped-kv-val">
                    <span className="ped-kv-side">before</span> {a}
                  </code>
                  <code className="ped-kv-val">
                    <span className="ped-kv-side">after</span> {b}
                  </code>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- main ----------
function InputPane({ id, label, value, onChange, error }) {
  return (
    <div className="ped-input-col">
      <label className="ped-input-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder="EXPLAIN output: text or FORMAT JSON"
      />
      <span className="ped-input-status" role={error && error !== "empty" ? "alert" : undefined}>
        {error && error !== "empty" ? (
          <span className="pe-error">
            <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {error}
          </span>
        ) : error === "empty" ? (
          <span className="ped-input-ok">Paste a plan</span>
        ) : (
          <span className="ped-input-ok">
            <i className="fa fa-check" aria-hidden="true"></i> Plan read
          </span>
        )}
      </span>
    </div>
  );
}

export default function ExplainDiff({ heading }) {
  const [inputs, setInputs, status] = useLocalStorage("explain-diff:inputs", { before: SAMPLE_BEFORE, after: SAMPLE_AFTER });
  const [prefs, setPrefs] = useLocalStorage("explain-diff:prefs", { view: "diff", layout: "merged" });
  const [selectedId, setSelectedId] = useState(null);

  const deferred = useDeferredValue(inputs);
  const result = useMemo(() => diffTexts(deferred.before, deferred.after), [deferred]);
  const diff = result.diff;

  useEffect(() => setSelectedId(null), [deferred]);

  const view = prefs.view === "input" || !diff ? "input" : "diff";
  const layout = prefs.layout === "side" ? "side" : "merged";
  const selected = diff && selectedId !== null ? diff.rows[selectedId] : null;
  const setView = (v) => setPrefs({ ...prefs, view: v });

  return (
    <div className="pg-explain-diff">
      <div className="util-toolbar" role="toolbar" aria-label="EXPLAIN plan diff">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {[
            { id: "input", label: "Input", icon: "fa-code" },
            { id: "diff", label: "Diff", icon: "fa-columns" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              disabled={v.id === "diff" && !diff}
              onClick={() => setView(v.id)}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        {view === "diff" && (
          <div className="util-segmented" role="group" aria-label="Layout">
            {[
              { id: "merged", label: "Merged" },
              { id: "side", label: "Side by side" },
            ].map((l) => (
              <button
                key={l.id}
                type="button"
                className={layout === l.id ? "button small is-active" : "button small"}
                aria-pressed={layout === l.id}
                onClick={() => setPrefs({ ...prefs, layout: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
        <span className="util-toolbar-spacer" />
        <button
          type="button"
          className="button small"
          title="Swap before and after"
          onClick={() => setInputs({ before: inputs.after, after: inputs.before })}
        >
          <i className="fa fa-exchange" aria-hidden="true"></i>&nbsp;Swap
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            setInputs({ before: SAMPLE_BEFORE, after: SAMPLE_AFTER });
            setView("diff");
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if ((inputs.before || inputs.after) && window.confirm("Clear both plans?")) {
              setInputs({ before: "", after: "" });
              setView("input");
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      {view === "input" ? (
        <div className="pe-input ped-input">
          <p className="pe-input-hint">
            Paste two plans for the same query, e.g. before and after adding an index or changing a setting. Text-format
            EXPLAIN and <code>FORMAT JSON</code> both work; <code>EXPLAIN (ANALYZE, BUFFERS)</code> gives timings and blocks.
          </p>
          <div className="ped-inputs">
            <InputPane
              id="ped-before"
              label="Before"
              value={inputs.before}
              onChange={(v) => setInputs({ ...inputs, before: v })}
              error={result.before.error}
            />
            <InputPane
              id="ped-after"
              label="After"
              value={inputs.after}
              onChange={(v) => setInputs({ ...inputs, after: v })}
              error={result.after.error}
            />
          </div>
          <div className="pe-input-actions">
            <span className="util-toolbar-spacer" />
            <button type="button" className="button small primary" disabled={!diff} onClick={() => setView("diff")}>
              Compare&nbsp;<i className="fa fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      ) : (
        <div className="pe-main ped-main">
          <aside className="pe-side" aria-label={selected ? "Node comparison" : "Diff summary"}>
            {selected ? (
              <NodeCompare row={selected} diff={diff} onBack={() => setSelectedId(null)} />
            ) : (
              <Summary diff={diff} onSelect={setSelectedId} />
            )}
          </aside>
          <section className="pe-canvas ped-canvas" aria-label="Plan diff">
            {layout === "merged" ? (
              <ul className="ped-tree">
                <MergedTree row={diff.root} basis={diff.basis} selectedId={selectedId} onSelect={setSelectedId} />
              </ul>
            ) : (
              <SideBySide diff={diff} selectedId={selectedId} onSelect={setSelectedId} />
            )}
            <p className="ped-legend">
              <span className="ped-chip is-better">lower</span> <span className="ped-chip is-worse">higher</span> time,
              blocks or cost · <span className="ped-chip is-neutral">changed</span> rows or loops ·{" "}
              <span className="ped-status is-added">added</span> <span className="ped-status is-removed">removed</span>{" "}
              <span className="ped-status is-changed">changed</span> nodes
            </p>
          </section>
        </div>
      )}

      <div className="util-statusbar">
        <span>
          {diff
            ? `${diff.summary.nodes.before} → ${diff.summary.nodes.after} nodes · ${diff.summary.counts.changed} changed · ${diff.summary.counts.added} added · ${diff.summary.counts.removed} removed`
            : "Paste both plans"}
        </span>
        <span>Parsed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
