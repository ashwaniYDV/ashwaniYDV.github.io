import { useDeferredValue, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import {
  ROW_MODES,
  ROW_STATEMENTS,
  TABLE_MODES,
  TABLE_STATEMENTS,
  buildGraph,
  compare,
  layout,
  rowConflicts,
  tableConflicts,
  tableModeInfo,
} from "./locks.js";
import { BLOCKING_QUERY, LOCKS_QUERY, SAMPLE_BLOCKING, SAMPLE_LOCKS } from "./sample.js";
import "./pg-locks.css";

const VIEWS = [
  { id: "table", label: "Table locks", icon: "fa-table" },
  { id: "row", label: "Row locks", icon: "fa-bars" },
  { id: "graph", label: "Wait-for graph", icon: "fa-share-alt" },
];

const DEFAULT_STATE = {
  view: "table",
  table: { a: { kind: "stmt", id: "alter-ae" }, b: { kind: "stmt", id: "select" } },
  row: { a: { kind: "stmt", id: "fk-insert" }, b: { kind: "stmt", id: "update" } },
  graphText: SAMPLE_BLOCKING,
};

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lk-copy"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          },
          () => {},
        )
      }
    >
      <i className={`fa ${done ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>
      {done ? " Copied" : ` ${label}`}
    </button>
  );
}

// ---------- pickers ----------
function Picker({ id, label, value, onChange, level }) {
  const modes = level === "row" ? ROW_MODES : TABLE_MODES;
  const stmts = level === "row" ? ROW_STATEMENTS : TABLE_STATEMENTS;
  return (
    <div className="lk-field">
      <label htmlFor={id} className="lk-label">
        {label}
      </label>
      <select
        id={id}
        className="lk-select"
        value={`${value.kind}:${value.id}`}
        onChange={(e) => {
          const [kind, ...rest] = e.target.value.split(":");
          onChange({ kind, id: rest.join(":") });
        }}
      >
        <optgroup label="Statements">
          {stmts.map((s) => (
            <option key={s.id} value={`stmt:${s.id}`}>
              {s.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Lock modes">
          {modes.map((m) => (
            <option key={m.id} value={`mode:${m.id}`}>
              {level === "row" ? m.id : `${m.name} (${m.id})`}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

const modeName = (mode, level) => (level === "row" ? mode : tableModeInfo(mode).name);

function Verdict({ pair, level }) {
  const { holder, requester, blocks } = compare(pair.a, pair.b, level);
  return (
    <div className={blocks ? "lk-verdict is-block" : "lk-verdict is-ok"} role="status">
      <span className="lk-verdict-big">
        <i className={`fa ${blocks ? "fa-ban" : "fa-check-circle"}`} aria-hidden="true"></i>{" "}
        {blocks ? "Session 2 waits" : "Both run concurrently"}
      </span>
      <p>
        <strong>{holder.label}</strong>
        {holder.isStatement && <> takes {modeName(holder.mode, level)}</>}
        {"; "}
        <strong>{requester.label}</strong>
        {requester.isStatement && <> requests {modeName(requester.mode, level)}</>}.{" "}
        {blocks
          ? `These modes conflict, so session 2 waits until session 1 commits or rolls back.`
          : `These modes do not conflict${level === "table" ? " on the same table" : " on the same row"}.`}
      </p>
      {[holder.note, requester.note].filter(Boolean).map((n) => (
        <p key={n} className="lk-note">
          {n}
        </p>
      ))}
      {level === "table" && blocks && (
        <p className="lk-note">
          While session 2 waits, later requests that conflict with <em>its</em> mode queue behind it too, even if session 1
          would allow them. An ALTER TABLE stuck behind a long transaction can therefore stall plain SELECTs; use{" "}
          <code>lock_timeout</code>.
        </p>
      )}
      {level === "row" && (
        <p className="lk-note">Plain SELECT takes no row lock and is never blocked by row locks.</p>
      )}
    </div>
  );
}

function Matrix({ level, pair, onPick }) {
  const modes = level === "row" ? ROW_MODES : TABLE_MODES;
  const conflicts = level === "row" ? rowConflicts : tableConflicts;
  const { holder, requester } = compare(pair.a, pair.b, level);
  const label = (m) => (level === "row" ? m.id : m.name);
  return (
    <div className="lk-matrix-wrap">
      <table className={`lk-matrix is-${level}`}>
        <caption>
          Rows: requested mode (session 2) · columns: existing mode (session 1) · <span className="lk-x">✕</span> = conflict
        </caption>
        <thead>
          <tr>
            <th scope="col" className="lk-corner">
              Requested ↓ / Existing →
            </th>
            {modes.map((m) => (
              <th key={m.id} scope="col" className={m.id === holder.mode ? "is-col" : ""} title={label(m)}>
                <abbr title={label(m)}>{level === "row" ? m.id.replace("FOR ", "") : m.short}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modes.map((r) => (
            <tr key={r.id} className={r.id === requester.mode ? "is-row" : ""}>
              <th scope="row">{label(r)}</th>
              {modes.map((c) => {
                const x = conflicts(r.id, c.id);
                const sel = r.id === requester.mode && c.id === holder.mode;
                return (
                  <td key={c.id} className={[x ? "is-x" : "is-free", sel ? "is-sel" : "", c.id === holder.mode ? "is-col" : ""].join(" ")}>
                    <button
                      type="button"
                      className="lk-cell"
                      onClick={() => onPick({ a: { kind: "mode", id: c.id }, b: { kind: "mode", id: r.id } })}
                      aria-label={`${label(r)} requested while ${label(c)} held: ${x ? "conflicts" : "no conflict"}`}
                      aria-pressed={sel}
                    >
                      {x ? "✕" : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModeList({ level }) {
  const modes = level === "row" ? ROW_MODES : TABLE_MODES;
  const stmts = level === "row" ? ROW_STATEMENTS : TABLE_STATEMENTS.filter((s) => !s.id.startsWith("lock-"));
  return (
    <dl className="lk-modes">
      {modes.map((m) => {
        const users = stmts.filter((s) => s.mode === m.id);
        return (
          <div key={m.id} className="lk-mode-row">
            <dt>
              {level === "row" ? m.id : m.name}
              {level === "table" && <span className="lk-mode-id"> {m.id}</span>}
            </dt>
            <dd>{users.length ? users.map((s) => s.label).join(" · ") : level === "table" ? "LOCK TABLE only" : "—"}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function LockView({ level, pair, setPair }) {
  return (
    <div className="lk-grid">
      <section className="lk-card" aria-labelledby={`lk-${level}-cmp`}>
        <h2 id={`lk-${level}-cmp`} className="lk-h">
          Do they block?
        </h2>
        <p className="lk-sub">
          {level === "table"
            ? "Pick what session 1 already holds on a table and what session 2 then asks for on the same table."
            : "Pick what session 1 holds on a row and what session 2 then does to the same row."}
        </p>
        <div className="lk-pickers">
          <Picker id={`lk-${level}-a`} label="Session 1 holds" value={pair.a} level={level} onChange={(a) => setPair({ ...pair, a })} />
          <button type="button" className="lk-swap" onClick={() => setPair({ a: pair.b, b: pair.a })} aria-label="Swap sessions" title="Swap">
            <i className="fa fa-exchange" aria-hidden="true"></i>
          </button>
          <Picker id={`lk-${level}-b`} label="Session 2 requests" value={pair.b} level={level} onChange={(b) => setPair({ ...pair, b })} />
        </div>
        <Verdict pair={pair} level={level} />
      </section>
      <section className="lk-card" aria-labelledby={`lk-${level}-mx`}>
        <h2 id={`lk-${level}-mx`} className="lk-h">
          {level === "table" ? "Table-level lock conflicts" : "Row-level lock conflicts"}
        </h2>
        <p className="lk-sub">
          From the PostgreSQL docs,{" "}
          <a href="https://www.postgresql.org/docs/current/explicit-locking.html" target="_blank" rel="noreferrer">
            Explicit Locking
          </a>{" "}
          (Table {level === "table" ? "13.2" : "13.3"}). Click a cell to compare those modes.
        </p>
        <Matrix level={level} pair={pair} onPick={setPair} />
      </section>
      <section className="lk-card lk-card-wide" aria-labelledby={`lk-${level}-who`}>
        <h2 id={`lk-${level}-who`} className="lk-h">
          Who takes which mode
        </h2>
        <ModeList level={level} />
      </section>
    </div>
  );
}

// ---------- wait-for graph ----------
const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

function Graph({ graph, selected, onSelect }) {
  const lay = useMemo(() => layout(graph), [graph]);
  const { positions, nodeW, nodeH } = lay;
  const cycleOf = new Map();
  graph.cycles.forEach((c, i) => c.forEach((p) => cycleOf.set(p, i)));
  const sameCycle = (a, b) => cycleOf.has(a) && cycleOf.get(a) === cycleOf.get(b);

  const edgePath = (e) => {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) return "";
    if (a.x === b.x) {
      // Same column (cycle): arc out to the right.
      const x = a.x + nodeW;
      const bulge = 40 + (Number(e.from) < Number(e.to) ? 0 : 30);
      const y1 = a.y + nodeH / 2 + (Number(e.from) < Number(e.to) ? -8 : 8);
      const y2 = b.y + nodeH / 2 + (Number(e.from) < Number(e.to) ? -8 : 8);
      return `M ${x} ${y1} C ${x + bulge} ${y1}, ${x + bulge} ${y2}, ${x + 6} ${y2}`;
    }
    const x1 = a.x + nodeW;
    const y1 = a.y + nodeH / 2;
    const x2 = b.x - 6;
    const y2 = b.y + nodeH / 2;
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div className="lk-graph-scroll">
      <svg
        className="lk-graph"
        width={lay.width}
        height={lay.height}
        viewBox={`0 0 ${lay.width} ${lay.height}`}
        role="img"
        aria-label={`Wait-for graph: ${graph.nodes.size} sessions, ${graph.edges.length} waits, ${graph.cycles.length} cycles`}
      >
        <defs>
          <marker id="lk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5163" />
          </marker>
          <marker id="lk-arrow-cycle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#d1242f" />
          </marker>
        </defs>
        {graph.edges.map((e) => {
          const cyc = sameCycle(e.from, e.to);
          const hot = selected && (e.from === selected || e.to === selected);
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={edgePath(e)}
              className={["lk-edge", cyc ? "is-cycle" : "", e.soft ? "is-soft" : "", hot ? "is-hot" : ""].join(" ")}
              markerEnd={cyc ? "url(#lk-arrow-cycle)" : "url(#lk-arrow)"}
            >
              <title>{`${e.from} blocks ${e.to}${e.reason ? `: ${e.reason}` : ""}`}</title>
            </path>
          );
        })}
        {[...graph.nodes.values()].map((n) => {
          const p = positions.get(n.pid);
          const isRoot = graph.roots.includes(n.pid);
          const cls = ["lk-node", n.inCycle ? "is-cycle" : isRoot ? "is-root" : n.blockedBy.length ? "is-waiting" : "", selected === n.pid ? "is-selected" : ""].join(" ");
          const sub = n.info.state || n.info.wait_event || n.info.usename || "";
          const q = n.info.query || n.info.relation || "";
          return (
            <g
              key={n.pid}
              className={cls}
              transform={`translate(${p.x},${p.y})`}
              tabIndex={0}
              role="button"
              aria-label={`pid ${n.pid}${isRoot ? ", root blocker" : ""}${n.inCycle ? ", in a deadlock cycle" : ""}: blocks ${n.blocks.length}, waits for ${n.blockedBy.length}`}
              aria-pressed={selected === n.pid}
              onClick={() => onSelect(selected === n.pid ? null : n.pid)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(selected === n.pid ? null : n.pid);
                }
              }}
            >
              <rect width={nodeW} height={nodeH} rx="6" />
              <text x="10" y="19" className="lk-node-pid">
                pid {n.pid}
                {n.victims ? ` · blocks ${n.victims}` : ""}
              </text>
              <text x="10" y="36" className="lk-node-sub">
                {trunc(sub, 24)}
                {n.info.xact_age ? ` · ${n.info.xact_age}` : ""}
              </text>
              <text x="10" y="53" className="lk-node-q">
                {trunc(q.replace(/\s+/g, " "), 28)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NodeDetails({ graph, pid, onSelect }) {
  const n = graph.nodes.get(pid);
  if (!n) return null;
  const reasons = graph.edges.filter((e) => e.to === pid);
  return (
    <div className="lk-details">
      <h3 className="lk-h3">pid {pid}</h3>
      <dl className="lk-kv">
        {Object.entries(n.info).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {reasons.length > 0 && (
        <>
          <h3 className="lk-h3">Waits for</h3>
          <ul className="lk-list">
            {reasons.map((e) => (
              <li key={e.from}>
                <button type="button" className="lk-link" onClick={() => onSelect(e.from)}>
                  pid {e.from}
                </button>
                {e.reason && e.reason !== "pg_blocking_pids" ? `: ${e.reason}` : ""}
                {e.soft ? " (queue order inferred)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {n.blocks.length > 0 && (
        <>
          <h3 className="lk-h3">Directly blocks</h3>
          <p className="lk-pids">
            {n.blocks.map((b) => (
              <button key={b} type="button" className="lk-link" onClick={() => onSelect(b)}>
                pid {b}
              </button>
            ))}
          </p>
        </>
      )}
    </div>
  );
}

function GraphView({ text, setText }) {
  const deferred = useDeferredValue(text);
  const graph = useMemo(() => buildGraph(deferred), [deferred]);
  const [selected, setSelected] = useState(null);
  const sel = graph.nodes?.has(selected) ? selected : null;

  return (
    <div className="lk-grid">
      <section className="lk-card" aria-labelledby="lk-g-in">
        <h2 id="lk-g-in" className="lk-h">
          Paste blocking info
        </h2>
        <p className="lk-sub">
          Either <code>pg_blocking_pids()</code> output (columns <code>pid</code>, <code>blocked_by</code>) or{" "}
          <code>pg_locks</code> rows (with <code>pid</code>, <code>mode</code>, <code>granted</code> and the lock target
          columns). psql aligned, <code>\x</code> or CSV.
        </p>
        <div className="lk-sample-row">
          <button type="button" className="lk-btn" onClick={() => setText(SAMPLE_BLOCKING)}>
            Sample: pg_blocking_pids
          </button>
          <button type="button" className="lk-btn" onClick={() => setText(SAMPLE_LOCKS)}>
            Sample: pg_locks
          </button>
        </div>
        <textarea
          className="lk-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Blocking query output"
          placeholder=" pid | blocked_by | state | query"
        />
        <details className="lk-query">
          <summary>pg_blocking_pids query (recommended)</summary>
          <pre>{BLOCKING_QUERY}</pre>
          <CopyButton text={BLOCKING_QUERY} label="Copy query" />
        </details>
        <details className="lk-query">
          <summary>pg_locks query</summary>
          <pre>{LOCKS_QUERY}</pre>
          <CopyButton text={LOCKS_QUERY} label="Copy query" />
        </details>
      </section>

      <section className="lk-card" aria-labelledby="lk-g-sum">
        <h2 id="lk-g-sum" className="lk-h">
          Summary
        </h2>
        {graph.error ? (
          graph.error === "empty" ? (
            <p className="lk-sub">Paste output to draw the graph.</p>
          ) : (
            <p className="lk-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {graph.error}
            </p>
          )
        ) : (
          <>
            <div className="lk-stats">
              <div className="lk-stat">
                <span className="lk-stat-label">Sessions</span>
                <span className="lk-stat-value">{graph.nodes.size}</span>
              </div>
              <div className="lk-stat">
                <span className="lk-stat-label">Waiting</span>
                <span className="lk-stat-value">{[...graph.nodes.values()].filter((n) => n.blockedBy.length).length}</span>
              </div>
              <div className={graph.cycles.length ? "lk-stat is-bad" : "lk-stat"}>
                <span className="lk-stat-label">Cycles</span>
                <span className="lk-stat-value">{graph.cycles.length}</span>
              </div>
            </div>
            {graph.cycles.map((c, i) => (
              <p key={i} className="lk-cycle-msg">
                <i className="fa fa-refresh" aria-hidden="true"></i> Deadlock cycle: {c.join(" → ")} → {c[0]}. PostgreSQL
                cancels one of these after <code>deadlock_timeout</code>.
              </p>
            ))}
            {graph.roots.length > 0 && (
              <>
                <h3 className="lk-h3">Root blockers (not waiting themselves)</h3>
                <ul className="lk-list">
                  {graph.roots.map((p) => {
                    const n = graph.nodes.get(p);
                    return (
                      <li key={p}>
                        <button type="button" className="lk-link" onClick={() => setSelected(p)}>
                          pid {p}
                        </button>{" "}
                        holds up {n.victims} session{n.victims === 1 ? "" : "s"}
                        {n.info.state ? ` · ${n.info.state}` : ""}
                        {n.info.xact_age ? ` · xact ${n.info.xact_age}` : ""}
                        <span className="lk-cmd">
                          <code>SELECT pg_cancel_backend({p});</code> / <code>pg_terminate_backend({p})</code>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {graph.problems.map((p) => (
              <p key={p} className="lk-error">
                {p}
              </p>
            ))}
            {sel && <NodeDetails graph={graph} pid={sel} onSelect={setSelected} />}
          </>
        )}
      </section>

      {!graph.error && (
        <section className="lk-card lk-card-wide" aria-labelledby="lk-g-graph">
          <h2 id="lk-g-graph" className="lk-h">
            Who blocks whom
          </h2>
          <p className="lk-legend">
            <span>
              <span className="lk-key is-root" /> root blocker
            </span>
            <span>
              <span className="lk-key is-waiting" /> waiting
            </span>
            <span>
              <span className="lk-key is-cycle" /> in a cycle
            </span>
            <span>Arrows point from blocker to waiter. Dashed: waiting in the lock queue behind another waiter.</span>
            {graph.format === "pg_locks" && <span>Built from pg_locks with the docs conflict matrix.</span>}
          </p>
          {graph.nodes.size ? (
            <Graph graph={graph} selected={sel} onSelect={setSelected} />
          ) : (
            <p className="lk-sub">No sessions found.</p>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- main ----------
export default function LockMatrix({ heading }) {
  const [stored, setState, status] = useLocalStorage("locks:state", DEFAULT_STATE);
  const state = { ...DEFAULT_STATE, ...stored };
  const view = VIEWS.some((v) => v.id === state.view) ? state.view : "table";
  const set = (patch) => setState((prev) => ({ ...DEFAULT_STATE, ...prev, ...patch }));

  return (
    <div className="pg-locks">
      <div className="util-toolbar" role="toolbar" aria-label="Lock conflict matrix">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              onClick={() => set({ view: v.id })}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setState({ ...DEFAULT_STATE, view })}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (window.confirm("Reset picks and clear the pasted graph input?")) setState({ ...DEFAULT_STATE, view, graphText: "" });
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      {view === "graph" ? (
        <GraphView text={state.graphText} setText={(graphText) => set({ graphText })} />
      ) : (
        <LockView key={view} level={view} pair={state[view]} setPair={(pair) => set({ [view]: pair })} />
      )}

      <div className="util-statusbar">
        <span>Conflict rules from the PostgreSQL docs (Explicit Locking). A transaction never conflicts with itself.</span>
        <span>Runs locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
