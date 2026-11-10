import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { exportSql, filterRows, fmtBytes, parseStatements, sortRows } from "./stats.js";
import { SAMPLE_CSV } from "./sample.js";
import "./statements.css";

// ---------- formatting ----------
function fmtMs(ms) {
  if (ms === undefined) return "—";
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)} h`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  if (ms >= 10) return `${ms.toFixed(0)} ms`;
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  if (ms > 0) return `${(ms * 1000).toFixed(0)} µs`;
  return "0 ms";
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
const fmtPct = (p) => (p === undefined ? "—" : `${(p * 100).toFixed(p >= 0.1 || p === 0 ? 0 : 1)}%`);
const fmtRatio = (p) => (p === undefined ? "—" : `${(p * 100).toFixed(p >= 0.995 ? 0 : 1)}%`);

const COLUMNS = [
  { key: "query", label: "Query", align: "left" },
  { key: "calls", label: "Calls", render: (r) => fmtShort(r.calls), title: (r) => fmtNum(r.calls) },
  { key: "total", label: "Total", render: (r) => fmtMs(r.total) },
  { key: "pct", label: "% total", render: (r) => fmtPct(r.pct) },
  { key: "mean", label: "Mean", render: (r) => fmtMs(r.mean) },
  { key: "rows", label: "Rows", render: (r) => fmtShort(r.rows), title: (r) => fmtNum(r.rows) },
  { key: "sharedHit", label: "Hit blks", render: (r) => fmtShort(r.sharedHit), title: (r) => fmtNum(r.sharedHit) },
  { key: "sharedRead", label: "Read blks", render: (r) => fmtShort(r.sharedRead), title: (r) => fmtNum(r.sharedRead) },
  { key: "hitRatio", label: "Hit %", render: (r) => fmtRatio(r.hitRatio) },
  { key: "tempWritten", label: "Temp wr", render: (r) => (r.tempWritten ? fmtBytes(r.tempWritten) : "—") },
  { key: "flags", label: "Flags", align: "left" },
];

const FLAG_FILTERS = [
  { id: "", label: "All flags" },
  { id: "temp", label: "Temp spill" },
  { id: "hit", label: "Low hit ratio" },
  { id: "mean", label: "High mean" },
  { id: "n1", label: "N+1 candidate" },
  { id: "stddev", label: "Unstable timing" },
];

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function CopyButton({ text, label = "Copy", className = "button small" }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" className={className} onClick={async () => setCopied(await copyText(text))}>
      <i className={`fa ${copied ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : label}
    </button>
  );
}

function Flags({ flags }) {
  if (!flags.length) return null;
  return (
    <span className="pss-flags">
      {flags.map((f) => (
        <span key={f.id} className={`pss-flag is-${f.severity}`} title={f.detail}>
          {f.label}
        </span>
      ))}
    </span>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="pss-stat">
      <span className="pss-stat-label">{label}</span>
      <span className="pss-stat-value">{value}</span>
      {hint && <span className="pss-stat-hint">{hint}</span>}
    </div>
  );
}

function Details({ row, onBack }) {
  return (
    <div>
      <button type="button" className="pss-back" onClick={onBack}>
        <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;Summary
      </button>
      <h2 className="pss-h">Statement #{row.id + 1}</h2>
      <p className="pss-sub">
        {row.queryid && <>queryid {row.queryid}</>}
        {row.user && <> · user {row.user}</>}
        {row.db && <> · db {row.db}</>}
      </p>
      <div className="pss-query-head">
        <h3 className="pss-h3">Query</h3>
        <CopyButton text={row.query} className="pss-copy" />
      </div>
      <pre className="pss-query">{row.query || "(no query text)"}</pre>

      {row.flags.length > 0 && (
        <section>
          <h3 className="pss-h3">Findings</h3>
          <ul className="pss-findings">
            {row.flags.map((f) => (
              <li key={f.id} className={`is-${f.severity}`}>
                <strong>{f.label}</strong>
                <p>{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="pss-h3">Time</h3>
        <div className="pss-stats">
          <Stat label="Total" value={fmtMs(row.total)} hint={`${fmtPct(row.pct)} of all statements`} />
          <Stat label="Mean" value={fmtMs(row.mean)} />
          <Stat label="Stddev" value={fmtMs(row.stddev)} />
          <Stat label="Min → max" value={`${fmtMs(row.min)} → ${fmtMs(row.max)}`} />
        </div>
      </section>
      <section>
        <h3 className="pss-h3">Calls and rows</h3>
        <div className="pss-stats">
          <Stat label="Calls" value={fmtNum(row.calls)} />
          <Stat label="Rows" value={fmtNum(row.rows)} />
          <Stat label="Rows per call" value={row.rowsPerCall === undefined ? "—" : row.rowsPerCall.toFixed(row.rowsPerCall >= 10 ? 0 : 1)} />
        </div>
      </section>
      <section>
        <h3 className="pss-h3">Buffers</h3>
        <div className="pss-kv">
          {[
            ["Shared hit", row.sharedHit],
            ["Shared read", row.sharedRead],
            ["Shared dirtied", row.sharedDirtied],
            ["Shared written", row.sharedWritten],
            ["Temp read", row.tempRead],
            ["Temp written", row.tempWritten],
          ].map(([label, v]) => (
            <div key={label} className="pss-kv-row">
              <span>{label}</span>
              <span>{fmtNum(v)}</span>
              <span>{v ? fmtBytes(v) : "—"}</span>
            </div>
          ))}
          <div className="pss-kv-row">
            <span>Cache hit ratio</span>
            <span>{fmtRatio(row.hitRatio)}</span>
            <span />
          </div>
        </div>
      </section>
    </div>
  );
}

function Summary({ parsed, onFlag }) {
  const rows = parsed.rows;
  const total = rows.reduce((s, r) => s + r.total, 0);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  const hit = rows.reduce((s, r) => s + (r.sharedHit ?? 0), 0);
  const read = rows.reduce((s, r) => s + (r.sharedRead ?? 0), 0);
  const temp = rows.reduce((s, r) => s + r.tempWritten, 0);
  const top5 = sortRows(rows, "total").slice(0, 5).reduce((s, r) => s + r.pct, 0);
  const counts = FLAG_FILTERS.slice(1).map((f) => ({ ...f, n: rows.filter((r) => r.flags.some((x) => x.id === f.id)).length }));

  return (
    <div>
      <h2 className="pss-h">Summary</h2>
      {parsed.legacy && <p className="pss-note">PostgreSQL 12 or older column names (total_time …) detected.</p>}
      <div className="pss-stats">
        <Stat label="Statements" value={fmtNum(rows.length)} />
        <Stat label="Total time" value={fmtMs(total)} />
        <Stat label="Calls" value={fmtShort(calls)} />
        <Stat label="Top 5 share" value={fmtPct(top5)} hint="of total time" />
        {parsed.optional.buffers && <Stat label="Cache hit" value={fmtRatio(hit + read > 0 ? hit / (hit + read) : undefined)} />}
        {parsed.optional.temp && <Stat label="Temp written" value={fmtBytes(temp)} />}
      </div>
      <h3 className="pss-h3">Flags</h3>
      <ul className="pss-flag-counts">
        {counts.map((f) => (
          <li key={f.id}>
            <button type="button" className="pss-link" disabled={!f.n} onClick={() => onFlag(f.id)}>
              {f.label}
            </button>
            <span>{f.n}</span>
          </li>
        ))}
      </ul>
      <p className="pss-muted">
        Times are cumulative since the last <code>pg_stat_statements_reset()</code>. Flags are rules of thumb, not verdicts:
        hover a flag for why it fired, click a row for the full query and stats.
      </p>
    </div>
  );
}

export default function StatementsAnalyzer({ heading }) {
  const [input, setInput, status] = useLocalStorage("statements:input", SAMPLE_CSV);
  const [prefs, setPrefs] = useLocalStorage("statements:prefs", {
    view: "table",
    sort: "total",
    dir: "desc",
    format: "csv",
    legacy: false,
    search: "",
    flag: "",
  });
  const [selectedId, setSelectedId] = useState(null);
  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }));

  const deferred = useDeferredValue(input);
  const parsed = useMemo(() => parseStatements(deferred), [deferred]);
  useEffect(() => setSelectedId(null), [deferred]);

  const view = prefs.view === "input" || parsed.error ? "input" : "table";
  const shown = useMemo(
    () => (parsed.error ? [] : sortRows(filterRows(parsed.rows, prefs.search ?? "", prefs.flag), prefs.sort, prefs.dir)),
    [parsed, prefs.search, prefs.flag, prefs.sort, prefs.dir],
  );
  const selected = !parsed.error && selectedId !== null ? parsed.rows[selectedId] : null;
  const sql = exportSql({ format: prefs.format, legacy: prefs.legacy });

  const sortBy = (key) =>
    set(prefs.sort === key ? { dir: prefs.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: key === "query" || key === "hitRatio" ? "asc" : "desc" });

  return (
    <div className="pg-statements">
      <div className="util-toolbar" role="toolbar" aria-label="pg_stat_statements analyzer">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {[
            { id: "input", label: "Input", icon: "fa-code" },
            { id: "table", label: "Statements", icon: "fa-table" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              disabled={v.id === "table" && Boolean(parsed.error)}
              onClick={() => set({ view: v.id })}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        {view === "table" && (
          <>
            <input
              type="search"
              className="pss-search"
              placeholder="Filter queries…"
              aria-label="Filter queries"
              value={prefs.search ?? ""}
              onChange={(e) => set({ search: e.target.value })}
            />
            <select className="pss-select" aria-label="Show only flag" value={prefs.flag ?? ""} onChange={(e) => set({ flag: e.target.value })}>
              {FLAG_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="util-toolbar-spacer" />
        <button
          type="button"
          className="button small"
          onClick={() => {
            setInput(SAMPLE_CSV);
            set({ view: "table", search: "", flag: "" });
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (input && window.confirm("Clear the pasted statements?")) {
              setInput("");
              set({ view: "input" });
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      {view === "input" ? (
        <div className="pss-input">
          <div className="pss-sql">
            <div className="pss-sql-bar">
              <span className="pss-sql-title">1. Export from the database</span>
              <div className="pss-seg" role="group" aria-label="Output format">
                {[
                  ["csv", "CSV (\\copy)"],
                  ["json", "JSON (json_agg)"],
                ].map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={prefs.format === id} className={prefs.format === id ? "is-on" : ""} onClick={() => set({ format: id })}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="pss-seg" role="group" aria-label="PostgreSQL version">
                {[
                  [false, "PG 13+"],
                  [true, "PG 12 and older"],
                ].map(([id, label]) => (
                  <button key={label} type="button" aria-pressed={prefs.legacy === id} className={prefs.legacy === id ? "is-on" : ""} onClick={() => set({ legacy: id })}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="util-toolbar-spacer" />
              <CopyButton text={sql} label="Copy SQL" className="pss-copy" />
            </div>
            <pre className="pss-sql-code">{sql}</pre>
            <p className="pss-sql-note">
              Needs <code>CREATE EXTENSION pg_stat_statements</code> and the library in <code>shared_preload_libraries</code>.
              {prefs.legacy
                ? " PostgreSQL 12 and older call the columns total_time, mean_time, …; the query renames them."
                : " PostgreSQL 13 renamed total_time → total_exec_time (and mean_, stddev_, min_, max_); switch to PG 12 for older servers."}
            </p>
          </div>
          <label className="pss-paste-label" htmlFor="pss-paste">
            2. Paste the CSV (with header) or JSON array
          </label>
          <textarea
            id="pss-paste"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="queryid,calls,rows,total_exec_time,mean_exec_time,…"
          />
          <div className="pss-input-actions">
            {parsed.error && parsed.error !== "empty" && (
              <span className="pss-error" role="alert">
                <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {parsed.error}
              </span>
            )}
            <span className="util-toolbar-spacer" />
            <button type="button" className="button small primary" disabled={Boolean(parsed.error)} onClick={() => set({ view: "table" })}>
              Analyze&nbsp;<i className="fa fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      ) : (
        <div className="pss-main">
          <section className="pss-table-pane" aria-label="Statements">
            <table className="pss-table">
              <thead>
                <tr>
                  <th scope="col" className="is-num">
                    #
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={c.align === "left" ? "" : "is-num"}
                      aria-sort={prefs.sort === c.key ? (prefs.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button type="button" className="pss-sort" onClick={() => sortBy(c.key)}>
                        {c.label}
                        <i
                          className={`fa ${prefs.sort === c.key ? (prefs.dir === "asc" ? "fa-caret-up" : "fa-caret-down") : "fa-sort"}`}
                          aria-hidden="true"
                        ></i>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={selectedId === r.id ? "is-selected" : ""} onClick={() => setSelectedId(r.id)}>
                    <td className="is-num pss-rank">{r.id + 1}</td>
                    {COLUMNS.map((c) =>
                      c.key === "query" ? (
                        <td key={c.key} className="pss-qcell">
                          <button type="button" className="pss-qbtn" aria-pressed={selectedId === r.id} title={r.query} onClick={() => setSelectedId(r.id)}>
                            {r.query.replace(/\s+/g, " ")}
                          </button>
                        </td>
                      ) : c.key === "flags" ? (
                        <td key={c.key} className="pss-flagcell">
                          <Flags flags={r.flags} />
                        </td>
                      ) : (
                        <td key={c.key} className={`is-num${c.key === "pct" ? " pss-pct" : ""}`} title={c.title?.(r)}>
                          {c.key === "pct" && <span className="pss-bar" style={{ width: `${Math.min(100, r.pct * 100)}%` }} aria-hidden="true" />}
                          <span className="pss-cell">{c.render(r)}</span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <p className="pss-empty">No statements match the filter.</p>}
          </section>
          <aside className="pss-side" aria-label={selected ? "Statement details" : "Summary"}>
            {selected ? (
              <Details row={selected} onBack={() => setSelectedId(null)} />
            ) : (
              <Summary parsed={parsed} onFlag={(flag) => set({ flag })} />
            )}
          </aside>
        </div>
      )}

      <div className="util-statusbar">
        <span>
          {parsed.error ? "No statements" : `${shown.length} of ${parsed.rows.length} statements · sorted by ${COLUMNS.find((c) => c.key === prefs.sort)?.label ?? "Total"}`}
        </span>
        <span>Parsed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
