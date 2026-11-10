import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { DEFAULT_OPTIONS, runFormatter } from "./format.js";
import { copyText, highlightSql } from "./highlight.js";
import { SAMPLE_SQL } from "./sample.js";
import "./sql-format.css";

const MODES = [
  { id: "format", label: "Format", icon: "fa-align-left" },
  { id: "minify", label: "Minify", icon: "fa-compress" },
];

function Select({ label, value, onChange, options, disabled }) {
  return (
    <label className="sf-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SqlFormatter({ heading }) {
  const [input, setInput, status] = useLocalStorage("sql-format:input", SAMPLE_SQL);
  const [prefs, setPrefs] = useLocalStorage("sql-format:prefs", { mode: "format", ...DEFAULT_OPTIONS });
  const [copied, setCopied] = useState(false);
  const deferred = useDeferredValue(input);
  const mode = prefs.mode === "minify" ? "minify" : "format";
  const set = (patch) => setPrefs({ ...prefs, ...patch });

  const result = useMemo(() => runFormatter(deferred, mode, prefs), [deferred, mode, prefs]);
  const html = useMemo(() => (result.output ? highlightSql(result.output) : ""), [result.output]);
  const formatting = mode === "format";

  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (result.output && (await copyText(result.output))) setCopied(true);
  };

  return (
    <div className="sf-tool">
      <div className="util-toolbar" role="toolbar" aria-label="SQL formatter">
        {heading}
        <div className="util-segmented" role="group" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? "button small is-active" : "button small"}
              aria-pressed={mode === m.id}
              onClick={() => set({ mode: m.id })}
            >
              <i className={`fa ${m.icon}`} aria-hidden="true"></i>&nbsp;{m.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={copy} disabled={!result.output}>
          <i className={`fa ${copied ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="button small" onClick={() => setInput(SAMPLE_SQL)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (input && window.confirm("Clear the SQL?")) setInput("");
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="sf-options" role="group" aria-label="Formatting options">
        <Select
          label="Keywords"
          value={prefs.keywordCase}
          onChange={(v) => set({ keywordCase: v })}
          disabled={!formatting}
          options={[
            ["upper", "UPPER"],
            ["lower", "lower"],
            ["preserve", "As typed"],
          ]}
        />
        <Select
          label="Indent"
          value={prefs.indent}
          onChange={(v) => set({ indent: v })}
          disabled={!formatting}
          options={[
            ["2", "2 spaces"],
            ["4", "4 spaces"],
            ["tab", "Tabs"],
          ]}
        />
        <Select
          label="Lines between queries"
          value={String(prefs.linesBetweenQueries)}
          onChange={(v) => set({ linesBetweenQueries: Number(v) })}
          disabled={!formatting}
          options={[0, 1, 2, 3].map((n) => [String(n), String(n)])}
        />
        <label className="sf-check">
          <input
            type="checkbox"
            checked={Boolean(prefs.denseOperators)}
            disabled={!formatting}
            onChange={(e) => set({ denseOperators: e.target.checked })}
          />
          <span>Dense operators (a+b)</span>
        </label>
        <span className="sf-options-note">PostgreSQL dialect · formatted by sql-formatter</span>
      </div>

      <div className="sf-panes">
        <div className="sf-pane">
          <textarea
            className="sf-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder="Paste SQL here..."
            aria-label="SQL input"
          />
        </div>
        <section className="sf-pane sf-output" aria-label={formatting ? "Formatted SQL" : "Minified SQL"} aria-live="polite">
          {result.error ? (
            <p className="sf-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> Could not format: {result.error}
              <span className="sf-error-hint">
                The formatter needs valid SQL. psql meta-commands (\d, \set) and some unusual syntax are not supported. Minify
                still works.
              </span>
            </p>
          ) : result.output ? (
            <pre className={mode === "minify" ? "sf-code is-wrap" : "sf-code"}>
              <code className="hljs language-pgsql" dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          ) : (
            <p className="sf-muted">Output appears here as you type.</p>
          )}
        </section>
      </div>

      <div className="util-statusbar">
        <span>
          {input.length.toLocaleString("en-US")} → {(result.output ?? "").length.toLocaleString("en-US")} characters
        </span>
        <span>Formatted locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
