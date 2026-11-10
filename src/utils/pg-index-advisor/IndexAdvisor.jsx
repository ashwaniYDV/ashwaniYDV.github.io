import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { CAVEATS, advise } from "./advisor.js";
import { SAMPLE_PLAN, SAMPLE_QUERY } from "./sample.js";
import "./index-advisor.css";

const PRIORITY_LABEL = { high: "Strong signal", medium: "Likely", low: "Maybe" };

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

function CopyButton({ text, label = "Copy", className }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" className={className} disabled={!text} onClick={async () => setCopied(await copyText(text))}>
      <i className={`fa ${copied ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : label}
    </button>
  );
}

function Suggestion({ s, n }) {
  return (
    <li className={`pia-card is-${s.priority}`}>
      <div className="pia-card-head">
        <span className={`pia-badge is-${s.priority}`}>{PRIORITY_LABEL[s.priority]}</span>
        <span className="pia-card-title">
          {n}. {s.table}
          <span className="pia-card-cols"> ({s.keys.map((k) => `${k.name}${k.desc ? " DESC" : ""}`).join(", ")})</span>
        </span>
        <span className="pia-sources">
          {s.sources.map((src) => (
            <span key={src} className="pia-source" title={src === "plan" ? "Backed by EXPLAIN evidence" : "Derived from the query text"}>
              {src === "plan" ? "from plan" : "from query"}
            </span>
          ))}
          {s.kind === "join" && <span className="pia-source">join column</span>}
        </span>
        <CopyButton text={s.sql} className="pia-copy" />
      </div>
      <pre className="pia-sql">{s.sql}</pre>
      <ul className="pia-reasons">
        {s.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {s.notes.length > 0 && (
        <ul className="pia-notes">
          {s.notes.map((r, i) => (
            <li key={i}>
              <i className="fa fa-info-circle" aria-hidden="true"></i> {r}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function IndexAdvisor({ heading }) {
  const [query, setQuery, status] = useLocalStorage("index-advisor:query", SAMPLE_QUERY);
  const [plan, setPlan] = useLocalStorage("index-advisor:plan", SAMPLE_PLAN);

  const dq = useDeferredValue(query);
  const dp = useDeferredValue(plan);
  const result = useMemo(() => advise(dq, dp), [dq, dp]);
  const all = result.suggestions.map((s) => s.sql).join("\n\n");
  const hypo = result.suggestions.length
    ? `CREATE EXTENSION IF NOT EXISTS hypopg;\nSELECT * FROM hypopg_create_index($$${result.suggestions[0].sql.replace(/\s*\n\s*/g, " ").replace(" CONCURRENTLY", "").replace(/;$/, "")}$$);\nEXPLAIN <your query>;  -- plain EXPLAIN: hypothetical indexes are ignored by ANALYZE\nSELECT hypopg_reset();`
    : "";

  return (
    <div className="pg-index-advisor">
      <div className="util-toolbar" role="toolbar" aria-label="Index advisor">
        {heading}
        <span className="util-toolbar-spacer" />
        <CopyButton text={all} label="Copy all" className="button small" />
        <button
          type="button"
          className="button small"
          onClick={() => {
            setQuery(SAMPLE_QUERY);
            setPlan(SAMPLE_PLAN);
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if ((query || plan) && window.confirm("Clear the query and plan?")) {
              setQuery("");
              setPlan("");
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="pia-main">
        <div className="pia-inputs">
          <label className="pia-label" htmlFor="pia-query">
            Query
          </label>
          <textarea
            id="pia-query"
            className="pia-query-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            placeholder="SELECT … FROM … WHERE … ORDER BY … LIMIT …"
          />
          <label className="pia-label" htmlFor="pia-plan">
            EXPLAIN plan <span className="pia-optional">optional · FORMAT JSON, ideally ANALYZE, BUFFERS, VERBOSE</span>
          </label>
          <textarea
            id="pia-plan"
            className="pia-plan-input"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            spellCheck={false}
            placeholder='[ { "Plan": { "Node Type": ... } } ]'
          />
          {result.planError && result.planError !== "empty" && (
            <span className="pia-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> Plan: {result.planError}
            </span>
          )}
        </div>

        <section className="pia-results" aria-label="Index suggestions">
          <p className="pia-warning">
            <i className="fa fa-flask" aria-hidden="true"></i> Heuristic suggestions with no cost model. Test each one (HypoPG,
            EXPLAIN) before creating it on a real database.
          </p>
          <h2 className="pia-h">
            Candidate indexes <span className="pia-count">{result.suggestions.length}</span>
          </h2>
          {result.suggestions.length ? (
            <ol className="pia-list">
              {result.suggestions.map((s, i) => (
                <Suggestion key={s.sql} s={s} n={i + 1} />
              ))}
            </ol>
          ) : (
            <p className="pia-muted">
              {query.trim() || plan.trim()
                ? "No candidates: no filter, join or ORDER BY column that a B-tree index would obviously help."
                : "Paste a query (and optionally its EXPLAIN plan) to get suggestions."}
            </p>
          )}

          {result.notes.length > 0 && (
            <>
              <h3 className="pia-h3">Notes</h3>
              <ul className="pia-plain">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}

          {result.skipped.length > 0 && (
            <>
              <h3 className="pia-h3">Conditions a B-tree won&apos;t help as written</h3>
              <ul className="pia-plain">
                {result.skipped.map((p, i) => (
                  <li key={i}>
                    <code>{p.text}</code> {p.reason}
                  </li>
                ))}
              </ul>
            </>
          )}

          {hypo && (
            <>
              <div className="pia-hypo-head">
                <h3 className="pia-h3">Try it with HypoPG first</h3>
                <CopyButton text={hypo} className="pia-copy" />
              </div>
              <pre className="pia-sql">{hypo}</pre>
            </>
          )}

          <h3 className="pia-h3">Caveats</h3>
          <ul className="pia-plain">
            {CAVEATS.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="util-statusbar">
        <span>
          {result.suggestions.length} candidate{result.suggestions.length === 1 ? "" : "s"}
          {result.planUsed ? " · plan evidence used" : " · query text only"}
        </span>
        <span>Analysed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
