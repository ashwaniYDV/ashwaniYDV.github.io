import { useMemo, useState } from "react";
import { download, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { DEFAULT_CONNECTIONS, STORAGE, VERSIONS, WORKLOADS, normalizeInput, recommend, toAlterSystem, toConf } from "./tuner.js";
import "./pg-tuner.css";

const SAMPLE = { version: "17", ramGb: "64", cpus: "16", storage: "ssd", workload: "oltp", maxConnections: "300" };
const BLANK = { version: "17", ramGb: "", cpus: "", storage: "ssd", workload: "web", maxConnections: "" };

function useCopy() {
  const [copied, setCopied] = useState("");
  const copy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
    } catch {
      setCopied("error");
    }
    window.setTimeout(() => setCopied(""), 1600);
  };
  return [copied, copy];
}

function Field({ id, label, hint, children }) {
  return (
    <div className="pt-field">
      <label htmlFor={id} className="pt-label">
        {label}
      </label>
      {children}
      {hint && <span className="pt-hint">{hint}</span>}
    </div>
  );
}

export default function PgTuner({ heading }) {
  const [form, setForm, status] = useLocalStorage("tuner:form", SAMPLE);
  const [outView, setOutView] = useLocalStorage("tuner:out", "conf");
  const [copied, copy] = useCopy();

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const parsed = useMemo(() => normalizeInput(form), [form]);
  const result = useMemo(() => (parsed.input ? recommend(parsed.input) : null), [parsed]);
  const conf = result ? toConf(result, parsed.input) : "";
  const alter = result ? toAlterSystem(result) : "";
  const output = outView === "alter" ? alter : conf;
  const workload = WORKLOADS.find((w) => w.id === form.workload);

  return (
    <div className="pg-tuner">
      <div className="util-toolbar" role="toolbar" aria-label="postgresql.conf tuner">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" disabled={!result} onClick={() => copy("conf", conf)}>
          <i className={`fa ${copied === "conf" ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>&nbsp;
          {copied === "conf" ? "Copied" : "Copy .conf"}
        </button>
        <button type="button" className="button small" disabled={!result} onClick={() => copy("alter", alter)}>
          <i className={`fa ${copied === "alter" ? "fa-check" : "fa-terminal"}`} aria-hidden="true"></i>&nbsp;
          {copied === "alter" ? "Copied" : "Copy ALTER SYSTEM"}
        </button>
        <button type="button" className="button small" disabled={!result} onClick={() => download("postgresql.tuned.conf", conf)}>
          <i className="fa fa-download" aria-hidden="true"></i>
          <span className="pt-sr">Download postgresql.conf snippet</span>
        </button>
        <button type="button" className="button small" onClick={() => setForm(SAMPLE)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button type="button" className="button small" onClick={() => setForm(BLANK)}>
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="pt-main">
        <form className="pt-pane pt-form" onSubmit={(e) => e.preventDefault()} aria-label="Server details">
          <h2 className="pt-h">Your server</h2>
          <div className="pt-grid">
            <Field id="pt-version" label="PostgreSQL version">
              <select id="pt-version" className="pt-input" value={form.version} onChange={set("version")}>
                {VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pt-ram" label="RAM (GB)">
              <input id="pt-ram" className="pt-input" type="number" min="0.25" step="any" inputMode="decimal" value={form.ramGb} onChange={set("ramGb")} placeholder="e.g. 16" />
            </Field>
            <Field id="pt-cpus" label="vCPUs">
              <input id="pt-cpus" className="pt-input" type="number" min="1" step="1" inputMode="numeric" value={form.cpus} onChange={set("cpus")} placeholder="e.g. 4" />
            </Field>
            <Field id="pt-conn" label="max_connections" hint={`blank = ${DEFAULT_CONNECTIONS[form.workload] ?? 100}`}>
              <input
                id="pt-conn"
                className="pt-input"
                type="number"
                min="5"
                step="1"
                inputMode="numeric"
                value={form.maxConnections}
                onChange={set("maxConnections")}
                placeholder={String(DEFAULT_CONNECTIONS[form.workload] ?? 100)}
              />
            </Field>
          </div>

          <fieldset className="pt-fieldset">
            <legend className="pt-label">Storage</legend>
            <div className="pt-choices">
              {STORAGE.map((s) => (
                <button key={s.id} type="button" className={form.storage === s.id ? "pt-chip is-on" : "pt-chip"} aria-pressed={form.storage === s.id} onClick={() => setForm({ ...form, storage: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="pt-fieldset">
            <legend className="pt-label">Workload</legend>
            <div className="pt-choices">
              {WORKLOADS.map((w) => (
                <button key={w.id} type="button" className={form.workload === w.id ? "pt-chip is-on" : "pt-chip"} aria-pressed={form.workload === w.id} onClick={() => setForm({ ...form, workload: w.id })}>
                  {w.label}
                </button>
              ))}
            </div>
            {workload && <p className="pt-hint">{workload.hint}</p>}
          </fieldset>

          <div className="pt-caveat" role="note">
            <i className="fa fa-info-circle" aria-hidden="true"></i> These are <strong>starting points</strong> from widely published rules of thumb, not a
            tuned configuration. Change one thing at a time, measure (pg_stat_statements, checkpoint and temp-file logs), and keep what helps.
          </div>
        </form>

        <section className="pt-pane pt-results" aria-label="Recommendations">
          {parsed.error ? (
            <p className="pt-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {parsed.error}
            </p>
          ) : (
            <>
              <h2 className="pt-h">Recommended settings</h2>
              {result.warnings.length > 0 && (
                <ul className="pt-warnings">
                  {result.warnings.map((w) => (
                    <li key={w}>
                      <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> {w}
                    </li>
                  ))}
                </ul>
              )}
              <div className="pt-table" role="table" aria-label="Settings">
                <div className="pt-tr pt-th" role="row">
                  <span role="columnheader">Setting</span>
                  <span role="columnheader">Value</span>
                  <span role="columnheader">Why</span>
                </div>
                {result.settings.map((s) => (
                  <div className="pt-tr" role="row" key={s.name}>
                    <span role="cell" className="pt-name">
                      {s.name}
                      {s.restart && (
                        <span className="pt-badge" title="Needs a server restart">
                          restart
                        </span>
                      )}
                    </span>
                    <span role="cell" className="pt-value">
                      {s.value}
                    </span>
                    <span role="cell" className="pt-reason">
                      {s.reason}
                    </span>
                  </div>
                ))}
              </div>

              {result.notes.length > 0 && (
                <ul className="pt-notes">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}

              <div className="pt-out-head">
                <h3 className="pt-h3">Output</h3>
                <div className="pt-choices" role="group" aria-label="Output format">
                  {[
                    { id: "conf", label: "postgresql.conf" },
                    { id: "alter", label: "ALTER SYSTEM" },
                  ].map((v) => (
                    <button key={v.id} type="button" className={outView === v.id ? "pt-chip is-on" : "pt-chip"} aria-pressed={outView === v.id} onClick={() => setOutView(v.id)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <pre className="pt-code" tabIndex={0} aria-label={outView === "alter" ? "ALTER SYSTEM statements" : "postgresql.conf snippet"}>
                {output}
              </pre>
            </>
          )}
        </section>
      </div>

      <div className="util-statusbar">
        <span>{result ? `${result.settings.length} settings · ${result.settings.filter((s) => s.restart).length} need a restart` : "Waiting for input"}</span>
        <span>Calculated locally, nothing is uploaded.</span>
        {copied === "error" && <span className="pt-copy-error">Copy failed: select the text and copy manually.</span>}
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
