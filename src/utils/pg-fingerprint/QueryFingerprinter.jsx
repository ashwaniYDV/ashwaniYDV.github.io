import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { copyText, highlightSql } from "../pg-format/highlight.js";
import { fingerprintHash, groupQueries, normalize } from "./fingerprint.js";
import { splitStatements } from "./tokenize.js";
import { SAMPLE_LOG, SAMPLE_QUERY } from "./sample.js";
import "./fingerprint.css";

const VIEWS = [
  { id: "single", label: "Single query", icon: "fa-search" },
  { id: "group", label: "Group many", icon: "fa-object-group" },
];

/** Hash every distinct canonical key (async: WebCrypto). Returns Map key -> hash. */
function useHashes(keys) {
  const [hashes, setHashes] = useState(() => new Map());
  const joined = keys.join("\u0000");
  useEffect(() => {
    let cancelled = false;
    Promise.all(keys.map(async (k) => [k, await fingerprintHash(k)])).then((pairs) => {
      if (!cancelled) setHashes(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return hashes;
}

function Sql({ code, className = "" }) {
  return (
    <pre className={`fp-code ${className}`}>
      <code className="hljs language-pgsql" dangerouslySetInnerHTML={{ __html: highlightSql(code) }} />
    </pre>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = window.setTimeout(() => setDone(false), 1400);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="fp-btn"
      onClick={async () => setDone(await copyText(text))}
      aria-label={`${label}: ${done ? "copied" : "copy to clipboard"}`}
    >
      <i className={`fa ${done ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i> {done ? "Copied" : label}
    </button>
  );
}

function Hash({ value }) {
  return (
    <code className="fp-hash" title="First 64 bits of SHA-256 over the canonical text">
      {value ?? "…"}
    </code>
  );
}

function Notice() {
  return (
    <p className="fp-notice">
      <i className="fa fa-info-circle" aria-hidden="true"></i> This approximates pg_stat_statements. Its{" "}
      <code>queryid</code> is a hash of the analysed parse tree, so the hash here will not equal a real queryid, and a few
      cases group differently: there, <code>id = 1</code> and <code>id = 1.5</code> differ (constant types differ), while{" "}
      <code>users</code> and <code>public.users</code> match when they resolve to the same table. Here, constants become{" "}
      <code>$n</code>, comments and whitespace are ignored and unquoted names are case-folded.
    </p>
  );
}

function SingleView({ input, squash }) {
  const results = useMemo(() => {
    const stmts = splitStatements(input);
    return stmts.slice(0, 50).map((s) => ({ source: s.text, ...normalize(s.text, { squash }) }));
  }, [input, squash]);
  const hashes = useHashes([...new Set(results.map((r) => r.key))]);

  if (!results.length) return <p className="fp-muted">Paste a query above to see its normalised form.</p>;
  return (
    <div className="fp-results">
      {results.map((r, i) => (
        <article key={i} className="fp-card">
          <header className="fp-card-head">
            <h2 className="fp-h">{results.length > 1 ? `Statement ${i + 1}` : "Normalised query"}</h2>
            <span className="fp-label">Fingerprint</span>
            <Hash value={hashes.get(r.key)} />
            <span className="fp-spacer" />
            <CopyButton text={r.text} label="Copy query" />
          </header>
          <Sql code={r.text} />
          {r.constants.length > 0 ? (
            <div className="fp-consts">
              <h3 className="fp-h3">Constants replaced ({r.constants.length})</h3>
              <dl>
                {r.constants.map((c) => (
                  <div key={c.n} className="fp-const">
                    <dt>${c.n}</dt>
                    <dd>
                      <code>{c.text}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="fp-muted">No constants found.</p>
          )}
          {r.params > 0 && (
            <p className="fp-muted">
              The query already uses parameters up to ${r.params}, so new placeholders start at ${r.params + 1}, as in
              pg_stat_statements.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function GroupView({ input, squash, split }) {
  const { total, groups } = useMemo(() => groupQueries(input, { mode: split, squash }), [input, squash, split]);
  const hashes = useHashes(groups.map((g) => g.key));
  if (!total) return <p className="fp-muted">Paste many queries above: one per line, or separated by semicolons.</p>;
  const max = groups[0]?.count ?? 1;
  return (
    <div className="fp-results">
      <p className="fp-summary">
        <strong>{total.toLocaleString("en-US")}</strong> queries → <strong>{groups.length.toLocaleString("en-US")}</strong>{" "}
        fingerprint{groups.length === 1 ? "" : "s"}
      </p>
      <ol className="fp-groups">
        {groups.slice(0, 500).map((g) => (
          <li key={g.key} className="fp-group">
            <div className="fp-group-head">
              <span className="fp-count" aria-label={`${g.count} queries`}>
                {g.count.toLocaleString("en-US")}×
              </span>
              <span className="fp-bar" aria-hidden="true">
                <span style={{ width: `${(g.count / max) * 100}%` }} />
              </span>
              <span className="fp-pct">{((g.count / total) * 100).toFixed(g.count / total >= 0.1 ? 0 : 1)}%</span>
              <Hash value={hashes.get(g.key)} />
              <span className="fp-spacer" />
              <CopyButton text={g.text} label="Copy" />
            </div>
            <Sql code={g.text} className="is-compact" />
            <details className="fp-example">
              <summary>First seen as</summary>
              <code>{g.example}</code>
            </details>
          </li>
        ))}
      </ol>
      {groups.length > 500 && <p className="fp-muted">Showing the 500 largest groups.</p>}
    </div>
  );
}

export default function QueryFingerprinter({ heading }) {
  const [single, setSingle, status] = useLocalStorage("fingerprint:query", SAMPLE_QUERY);
  const [log, setLog] = useLocalStorage("fingerprint:log", SAMPLE_LOG);
  const [prefs, setPrefs] = useLocalStorage("fingerprint:prefs", { view: "single", squash: true, split: "auto" });
  const view = prefs.view === "group" ? "group" : "single";
  const input = view === "group" ? log : single;
  const setInput = view === "group" ? setLog : setSingle;
  const deferred = useDeferredValue(input);
  const set = (patch) => setPrefs({ ...prefs, ...patch });

  return (
    <div className="fp-tool">
      <div className="util-toolbar" role="toolbar" aria-label="Query fingerprinter">
        {heading}
        <div className="util-segmented" role="group" aria-label="Mode">
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
        <button type="button" className="button small" onClick={() => setInput(view === "group" ? SAMPLE_LOG : SAMPLE_QUERY)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (input && window.confirm("Clear the input?")) setInput("");
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="fp-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          rows={view === "group" ? 10 : 8}
          aria-label={view === "group" ? "Queries or log lines" : "SQL query"}
          placeholder={
            view === "group"
              ? "One query per line, or separated by ;  Server log lines (LOG: ... statement: ...) are understood."
              : "SELECT * FROM users WHERE id = 42;"
          }
        />
        <div className="fp-options">
          <label className="fp-check">
            <input type="checkbox" checked={prefs.squash !== false} onChange={(e) => set({ squash: e.target.checked })} />
            <span>Squash constant lists: IN (1, 2, 3) → IN ($1 /*, ... */) as in PostgreSQL 18</span>
          </label>
          {view === "group" && (
            <label className="fp-field">
              <span>Split on</span>
              <select value={prefs.split} onChange={(e) => set({ split: e.target.value })}>
                <option value="auto">Auto (; if present, else lines)</option>
                <option value="semicolon">Semicolons</option>
                <option value="line">Lines</option>
              </select>
            </label>
          )}
        </div>
      </div>

      <Notice />

      {view === "group" ? (
        <GroupView input={deferred} squash={prefs.squash !== false} split={prefs.split} />
      ) : (
        <SingleView input={deferred} squash={prefs.squash !== false} />
      )}

      <div className="util-statusbar">
        <span>Fingerprinted locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
