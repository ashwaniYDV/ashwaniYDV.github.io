import { useDeferredValue, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import {
  BULK_QUERY,
  DEFAULT_SETTINGS,
  VERSIONS,
  effectiveSettings,
  evaluate,
  evaluateBulk,
  parseBulk,
  qualifiedName,
  resetStatement,
  tuneStatement,
} from "./autovacuum.js";
import { BLANK_TABLE, SAMPLE_BULK, SAMPLE_TABLE } from "./sample.js";
import "./pg-autovacuum.css";

const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "∞");
const fmtPct = (r) => (Number.isFinite(r) ? `${r >= 10 ? Math.round(r * 100).toLocaleString("en-US") : (r * 100).toFixed(r < 0.1 ? 1 : 0)}%` : "∞");
const level = (c) => (c.disabled ? "is-off" : c.triggers ? "is-due" : c.ratio >= 0.75 ? "is-near" : "is-ok");

const SETTING_FIELDS = [
  { key: "autovacuum_vacuum_threshold", label: "vacuum_threshold", step: "1" },
  { key: "autovacuum_vacuum_scale_factor", label: "vacuum_scale_factor", step: "0.01" },
  { key: "autovacuum_analyze_threshold", label: "analyze_threshold", step: "1" },
  { key: "autovacuum_analyze_scale_factor", label: "analyze_scale_factor", step: "0.01" },
  { key: "autovacuum_vacuum_insert_threshold", label: "vacuum_insert_threshold", step: "1", hint: "-1 disables" },
  { key: "autovacuum_vacuum_insert_scale_factor", label: "vacuum_insert_scale_factor", step: "0.01" },
  { key: "autovacuum_vacuum_max_threshold", label: "vacuum_max_threshold", step: "1", minVersion: 18, hint: "PG18, -1 disables" },
];

const DEFAULT_GLOBALS = { version: "17", ...Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, String(v)])) };

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

function NumField({ id, label, value, onChange, step = "1", hint, placeholder }) {
  return (
    <div className="pa-field">
      <label htmlFor={id} className="pa-label">
        {label}
      </label>
      <input id={id} className="pa-input" type="number" step={step} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="pa-hint">{hint}</span>}
    </div>
  );
}

function Gauge({ title, check, formula }) {
  const pct = Math.min(100, Number.isFinite(check.ratio) ? check.ratio * 100 : 100);
  return (
    <div className={`pa-gauge ${level(check)}`}>
      <div className="pa-gauge-head">
        <span className="pa-gauge-title">{title}</span>
        <span className="pa-status">{check.disabled ? "disabled" : check.triggers ? "due now" : `${fmtPct(check.ratio)} of threshold`}</span>
      </div>
      <div className="pa-bar" role="meter" aria-label={`${title}: ${fmtPct(check.ratio)} of threshold`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="pa-gauge-nums">
        <span>
          <strong>{fmt(check.count)}</strong> rows
        </span>
        <span>threshold {fmt(check.threshold)}</span>
      </div>
      <p className="pa-formula">{formula}</p>
      {!check.disabled && (
        <p className="pa-remaining">
          {check.triggers ? "Autovacuum picks this up on its next pass of the database (autovacuum_naptime)." : `Triggers after ${fmt(check.remaining)} more rows.`}
        </p>
      )}
    </div>
  );
}

function SingleTable({ form, setForm, globals, version, copied, copy }) {
  const set = (k) => (v) => setForm({ ...form, [k]: v });
  const settings = effectiveSettings(globals);
  const table = {
    reltuples: form.reltuples,
    n_dead_tup: form.n_dead_tup,
    n_mod_since_analyze: form.n_mod_since_analyze,
    n_ins_since_vacuum: form.n_ins_since_vacuum,
    frozenFraction: Number(form.frozenPct || 0) / 100,
  };
  const r = evaluate(table, settings, version);
  const rel = fmt(r.reltuples);
  const s = settings;
  const tune = tuneStatement({
    schema: form.schema,
    table: form.table,
    reltuples: r.reltuples,
    settings,
    vacuumTarget: form.vacuumTarget,
    analyzeTarget: form.analyzeTarget,
    mode: form.mode,
  });
  const reset = resetStatement(form.schema, form.table);

  return (
    <div className="pa-single">
      <section className="pa-pane" aria-label="Table statistics">
        <h2 className="pa-h">Table</h2>
        <div className="pa-grid">
          <div className="pa-field">
            <label htmlFor="pa-schema" className="pa-label">
              Schema
            </label>
            <input id="pa-schema" className="pa-input" type="text" value={form.schema} placeholder="public" onChange={(e) => set("schema")(e.target.value)} />
          </div>
          <div className="pa-field">
            <label htmlFor="pa-table" className="pa-label">
              Table
            </label>
            <input id="pa-table" className="pa-input" type="text" value={form.table} placeholder="my_table" onChange={(e) => set("table")(e.target.value)} />
          </div>
          <NumField id="pa-reltuples" label="reltuples" value={form.reltuples} onChange={set("reltuples")} hint="pg_class; -1 = never analyzed" />
          <NumField id="pa-dead" label="n_dead_tup" value={form.n_dead_tup} onChange={set("n_dead_tup")} />
          <NumField id="pa-mod" label="n_mod_since_analyze" value={form.n_mod_since_analyze} onChange={set("n_mod_since_analyze")} />
          <NumField id="pa-ins" label="n_ins_since_vacuum" value={form.n_ins_since_vacuum} onChange={set("n_ins_since_vacuum")} />
          {version >= 18 && (
            <NumField id="pa-frozen" label="All-frozen pages %" value={form.frozenPct} onChange={set("frozenPct")} hint="relallfrozen / relpages × 100" />
          )}
        </div>
      </section>

      <section className="pa-pane" aria-label="Triggers">
        <h2 className="pa-h">When does autovacuum run?</h2>
        {r.neverAnalyzed && <p className="pa-note">reltuples is -1 (never vacuumed or analyzed), so the scale factors count as 0 rows.</p>}
        <div className="pa-gauges">
          <Gauge
            title="Vacuum (dead tuples)"
            check={r.vacuum}
            formula={`${s.autovacuum_vacuum_threshold} + ${s.autovacuum_vacuum_scale_factor} × ${rel}${r.vacuum.capped ? ` → capped at vacuum_max_threshold ${fmt(s.autovacuum_vacuum_max_threshold)}` : ""}`}
          />
          <Gauge
            title="Insert vacuum"
            check={r.insert}
            formula={
              r.insert.disabled
                ? "vacuum_insert_threshold = -1 disables insert-triggered vacuum."
                : `${s.autovacuum_vacuum_insert_threshold} + ${s.autovacuum_vacuum_insert_scale_factor} × ${rel}${version >= 18 && table.frozenFraction > 0 ? ` × ${(1 - table.frozenFraction).toFixed(2)} unfrozen` : ""}`
            }
          />
          <Gauge title="Analyze (modified rows)" check={r.analyze} formula={`${s.autovacuum_analyze_threshold} + ${s.autovacuum_analyze_scale_factor} × ${rel}`} />
        </div>
      </section>

      <section className="pa-pane" aria-label="Per-table tuning">
        <h2 className="pa-h">Tune this table</h2>
        <div className="pa-grid">
          <NumField id="pa-vt" label="Vacuum at dead tuples" value={form.vacuumTarget} onChange={set("vacuumTarget")} placeholder="e.g. 100000" />
          <NumField id="pa-at" label="Analyze at modified rows" value={form.analyzeTarget} onChange={set("analyzeTarget")} hint="optional" />
        </div>
        <fieldset className="pa-fieldset">
          <legend className="pa-label">Approach</legend>
          <div className="pa-choices">
            {[
              { id: "fixed", label: "Fixed threshold (scale factor 0)" },
              { id: "scale", label: "Scale factor for current size" },
            ].map((m) => (
              <button key={m.id} type="button" className={form.mode === m.id ? "pa-chip is-on" : "pa-chip"} aria-pressed={form.mode === m.id} onClick={() => set("mode")(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>
        {tune.sql ? (
          <>
            <div className="pa-code-wrap">
              <pre className="pa-code" tabIndex={0} aria-label="ALTER TABLE statement">
                {tune.sql}
              </pre>
              <button type="button" className="pa-copy" onClick={() => copy("tune", tune.sql)} aria-label="Copy ALTER TABLE statement">
                <i className={`fa ${copied === "tune" ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>
              </button>
            </div>
            <p className="pa-hint">{tune.note}</p>
            <details className="pa-details">
              <summary>Undo: back to the global settings</summary>
              <pre className="pa-code">{reset}</pre>
            </details>
          </>
        ) : (
          <p className="pa-hint">{tune.note}</p>
        )}
      </section>
    </div>
  );
}

function Cell({ check }) {
  const pct = Math.min(100, Number.isFinite(check.ratio) ? check.ratio * 100 : 100);
  return (
    <span role="cell" className={`pa-cell ${level(check)}`} title={check.disabled ? "disabled" : `${fmt(check.count)} / ${fmt(check.threshold)}`}>
      <span className="pa-cell-text">{check.disabled ? "off" : check.triggers ? `due · ${fmtPct(check.ratio)}` : fmtPct(check.ratio)}</span>
      <span className="pa-minibar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function Bulk({ text, setText, globals, version, onTune, copied, copy }) {
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => parseBulk(deferred), [deferred]);
  const results = useMemo(() => (parsed.rows.length ? evaluateBulk(parsed.rows, globals, version) : []), [parsed, globals, version]);
  const due = results.filter((x) => x.result.vacuum.triggers || x.result.insert.triggers || x.result.analyze.triggers).length;

  return (
    <div className="pa-bulk">
      <section className="pa-pane" aria-label="Paste statistics">
        <div className="pa-row-between">
          <h2 className="pa-h">Paste many tables</h2>
          <button type="button" className="pa-chip" onClick={() => copy("query", BULK_QUERY)}>
            <i className={`fa ${copied === "query" ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i> {copied === "query" ? "Copied" : "Copy query"}
          </button>
        </div>
        <p className="pa-hint">
          Run this query and paste the psql output (aligned), CSV or TSV with a header row. A <code className="pa-ic">reloptions</code> column applies per-table overrides.
        </p>
        <pre className="pa-code pa-query">{BULK_QUERY}</pre>
        <textarea className="pa-textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="pg_stat_user_tables output" placeholder="schemaname | relname | reltuples | n_dead_tup | ..." />
        {parsed.error && parsed.error !== "empty" && (
          <p className="pa-error" role="alert">
            <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {parsed.error}
          </p>
        )}
      </section>

      {results.length > 0 && (
        <section className="pa-pane" aria-label="Results">
          <h2 className="pa-h">
            {results.length} tables · {due} due now
          </h2>
          <div className="pa-table" role="table" aria-label="Autovacuum status per table">
            <div className="pa-tr pa-th" role="row">
              <span role="columnheader">Table</span>
              <span role="columnheader">reltuples</span>
              <span role="columnheader">Vacuum</span>
              <span role="columnheader">Insert</span>
              <span role="columnheader">Analyze</span>
              <span role="columnheader">
                <span className="pa-sr">Actions</span>
              </span>
            </div>
            {results.map(({ row, result, hasOverrides }, i) => (
              <div className="pa-tr" role="row" key={`${row.schema}.${row.table}.${i}`}>
                <span role="cell" className="pa-tname">
                  {qualifiedName(row.schema, row.table)}
                  {hasOverrides && (
                    <span className="pa-tag" title={Object.entries(row.overrides).map(([k, v]) => `${k}=${v}`).join(", ")}>
                      overrides
                    </span>
                  )}
                  {!row.enabled && (
                    <span className="pa-tag is-warn" title="autovacuum_enabled = false: only anti-wraparound vacuums run">
                      autovacuum off
                    </span>
                  )}
                </span>
                <span role="cell" className="pa-num">
                  {result.neverAnalyzed ? "-1" : fmt(result.reltuples)}
                </span>
                <Cell check={result.vacuum} />
                <Cell check={result.insert} />
                <Cell check={result.analyze} />
                <span role="cell">
                  <button type="button" className="pa-chip pa-small" onClick={() => onTune(row)} aria-label={`Tune ${row.table}`}>
                    Tune
                  </button>
                </span>
              </div>
            ))}
          </div>
          <p className="pa-hint">Percent of each trigger threshold reached. Sorted by the closest trigger. Tune opens the table in the single-table view.</p>
        </section>
      )}
    </div>
  );
}

export default function AutovacuumCalc({ heading }) {
  const [globals, setGlobals, status] = useLocalStorage("autovacuum:settings", DEFAULT_GLOBALS);
  const [form, setForm] = useLocalStorage("autovacuum:table", SAMPLE_TABLE);
  const [bulk, setBulk] = useLocalStorage("autovacuum:bulk", SAMPLE_BULK);
  const [view, setView] = useLocalStorage("autovacuum:view", "single");
  const [copied, copy] = useCopy();
  const version = Number(globals.version) || 17;

  const onTune = (row) => {
    setForm({
      ...form,
      schema: row.schema,
      table: row.table,
      reltuples: String(row.reltuples),
      n_dead_tup: String(row.n_dead_tup),
      n_mod_since_analyze: String(row.n_mod_since_analyze),
      n_ins_since_vacuum: String(row.n_ins_since_vacuum),
      frozenPct: row.frozenFraction ? String(Math.round(row.frozenFraction * 100)) : "",
    });
    setView("single");
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="pg-autovac">
      <div className="util-toolbar" role="toolbar" aria-label="Autovacuum threshold calculator">
        {heading}
        <div className="util-segmented" role="group" aria-label="Mode">
          {[
            { id: "single", label: "One table", icon: "fa-table" },
            { id: "bulk", label: "Many tables", icon: "fa-list" },
          ].map((v) => (
            <button key={v.id} type="button" className={view === v.id ? "button small is-active" : "button small"} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (view === "bulk") setBulk(SAMPLE_BULK);
            else setForm(SAMPLE_TABLE);
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (view === "bulk") setBulk("");
            else setForm(BLANK_TABLE);
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="pa-main">
        <aside className="pa-pane pa-settings" aria-label="Autovacuum settings">
          <h2 className="pa-h">Settings</h2>
          <div className="pa-field">
            <label htmlFor="pa-version" className="pa-label">
              PostgreSQL version
            </label>
            <select id="pa-version" className="pa-input" value={globals.version} onChange={(e) => setGlobals({ ...globals, version: e.target.value })}>
              {VERSIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <p className="pa-hint pa-prefix">
            autovacuum_<em>…</em> (from <code className="pa-ic">SHOW</code> or postgresql.conf)
          </p>
          <div className="pa-settings-list">
            {SETTING_FIELDS.filter((f) => !f.minVersion || version >= f.minVersion).map((f) => (
              <NumField key={f.key} id={`pa-${f.key}`} label={f.label} step={f.step} hint={f.hint} value={globals[f.key]} placeholder={String(DEFAULT_SETTINGS[f.key])} onChange={(v) => setGlobals({ ...globals, [f.key]: v })} />
            ))}
          </div>
          <button type="button" className="pa-chip pa-reset" onClick={() => setGlobals({ ...DEFAULT_GLOBALS, version: globals.version })}>
            <i className="fa fa-undo" aria-hidden="true"></i> Defaults
          </button>
        </aside>

        {view === "bulk" ? (
          <Bulk text={bulk} setText={setBulk} globals={globals} version={version} onTune={onTune} copied={copied} copy={copy} />
        ) : (
          <SingleTable form={form} setForm={setForm} globals={globals} version={version} copied={copied} copy={copy} />
        )}
      </div>

      <div className="util-statusbar">
        <span>Formulas follow the PostgreSQL {version} docs (Routine Vacuuming).</span>
        <span>Calculated locally, nothing is uploaded.</span>
        {copied === "error" && <span className="pa-copy-error">Copy failed: select the text and copy manually.</span>}
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
