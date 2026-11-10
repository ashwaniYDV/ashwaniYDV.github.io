import { useDeferredValue, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { KINDS, QUERIES, SEVERITY_TEXT, VERSIONS, WRAP, analyze, parseCount, thresholds, validateSettings } from "./xid.js";
import { EMPTY_STATE, SAMPLE_STATE } from "./sample.js";
import "./pg-xid.css";

const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US"));
const fmtShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
};
const fmtPct = (p) => (p === null ? "—" : `${p >= 100 ? Math.round(p) : p.toFixed(1)}%`);
const fmtDays = (d) => {
  if (d === null) return "—";
  if (d <= 0) return "now";
  if (d < 1) return `${Math.round(d * 24)} h`;
  if (d >= 365) return `${(d / 365).toFixed(1)} y`;
  return `${Math.round(d)} d`;
};

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="xid-copy"
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

function Query({ title, sql, open = false }) {
  return (
    <details className="xid-query" open={open}>
      <summary>{title}</summary>
      <pre>{sql}</pre>
      <CopyButton text={sql} label="Copy query" />
    </details>
  );
}

function NumField({ id, label, value, onChange, error, hint, placeholder }) {
  return (
    <div className="xid-field">
      <label htmlFor={id} className="xid-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className={error ? "xid-input is-invalid" : "xid-input"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-msg`}
        autoComplete="off"
      />
      <span id={`${id}-msg`} className={error ? "xid-msg is-error" : "xid-msg"}>
        {error || hint}
      </span>
    </div>
  );
}

/** One horizontal bar on a 0..2^31 scale with threshold ticks. */
function AgeBar({ age, t, sev }) {
  const pos = (v) => `${Math.min(100, (v / WRAP) * 100)}%`;
  const ticks = [
    { v: t.freeze, cls: "is-freeze", label: "freeze max age" },
    t.failsafe !== null && { v: t.failsafe, cls: "is-failsafe", label: "failsafe" },
    { v: t.warn, cls: "is-warn", label: "warning" },
    { v: t.stop, cls: "is-stop", label: "stop" },
  ].filter(Boolean);
  return (
    <span className="xid-bar" role="img" aria-label={`${fmt(age)} of ${fmt(WRAP)} (${((age / WRAP) * 100).toFixed(1)}%)`}>
      <span className={`xid-bar-fill sev-${sev}`} style={{ width: pos(age) }} />
      {ticks.map((k) => (
        <span key={k.cls} className={`xid-tick ${k.cls}`} style={{ left: pos(k.v) }} title={`${k.label}: ${fmt(k.v)}`} />
      ))}
    </span>
  );
}

function Results({ kind, result, rate }) {
  if (result.error) {
    return result.error === "empty" ? (
      <p className="xid-muted">Paste query output above to see each row scored.</p>
    ) : (
      <p className="xid-msg is-error" role="alert">
        <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {result.error}
      </p>
    );
  }
  const t = result.thresholds;
  const worst = result.rows[0];
  const label = KINDS[kind].label;
  return (
    <>
      <div className="xid-stats">
        <div className={`xid-stat sev-${worst.severity}`}>
          <span className="xid-stat-label">Oldest {label} age</span>
          <span className="xid-stat-value">{fmt(worst.age)}</span>
          <span className="xid-stat-hint">{worst.name}</span>
        </div>
        <div className="xid-stat">
          <span className="xid-stat-label">Headroom to stop</span>
          <span className="xid-stat-value">{fmt(worst.remaining)}</span>
          <span className="xid-stat-hint">
            {fmtPct(worst.pctStop)} of the {fmtShort(t.stop)} limit used
          </span>
        </div>
        <div className="xid-stat">
          <span className="xid-stat-label">Days to stop</span>
          <span className="xid-stat-value">{rate ? fmtDays(worst.daysToStop) : "—"}</span>
          <span className="xid-stat-hint">{rate ? `at ${fmtShort(rate)} ${label}s/day` : `enter a ${label}s/day rate`}</span>
        </div>
        <div className="xid-stat">
          <span className="xid-stat-label">Status</span>
          <span className={`xid-sev sev-${worst.severity}`}>{SEVERITY_TEXT[worst.severity]}</span>
          <span className="xid-stat-hint">age column: {result.ageColumn}</span>
        </div>
      </div>

      <div className="xid-table-wrap">
        <table className="xid-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="is-num">
                Age
              </th>
              <th scope="col" className="xid-bar-col">
                0 → 2³¹
              </th>
              <th scope="col" className="is-num" title={`age / ${KINDS[kind].freezeSetting}`}>
                % freeze
              </th>
              <th scope="col" className="is-num" title={`age / effective ${KINDS[kind].failsafeSetting}`}>
                % failsafe
              </th>
              <th scope="col" className="is-num" title="age / stop limit (shutdown of new IDs)">
                % stop
              </th>
              {rate && (
                <th scope="col" className="is-num" title="days until failsafe / stop at the given rate">
                  Days to failsafe / stop
                </th>
              )}
              <th scope="col">Severity</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={`${r.name}-${i}`}>
                <th scope="row" className="xid-name">
                  {r.name}
                </th>
                <td className="is-num">{fmt(r.age)}</td>
                <td className="xid-bar-col">
                  <AgeBar age={r.age} t={t} sev={r.severity} />
                </td>
                <td className={r.pctFreeze >= 100 ? "is-num is-over" : "is-num"}>{fmtPct(r.pctFreeze)}</td>
                <td className={r.pctFailsafe >= 100 ? "is-num is-over" : "is-num"}>{fmtPct(r.pctFailsafe)}</td>
                <td className={r.pctStop >= 100 ? "is-num is-over" : "is-num"}>{fmtPct(r.pctStop)}</td>
                {rate && (
                  <td className="is-num">
                    {fmtDays(r.daysToFailsafe)} / {fmtDays(r.daysToStop)}
                  </td>
                )}
                <td>
                  <span className={`xid-sev sev-${r.severity}`}>{SEVERITY_TEXT[r.severity]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xid-legend">
        <span>
          <span className="xid-tick-key is-freeze" /> {KINDS[kind].freezeSetting} {fmtShort(t.freeze)}: autovacuum forces an
          aggressive (anti-wraparound) vacuum
        </span>
        {t.failsafe !== null && (
          <span>
            <span className="xid-tick-key is-failsafe" /> failsafe {fmtShort(t.failsafe)}: VACUUM skips index cleanup and
            cost delay to finish fast
          </span>
        )}
        <span>
          <span className="xid-tick-key is-warn" /> warn {fmtShort(t.warn)}: WARNING on every new {label}
        </span>
        <span>
          <span className="xid-tick-key is-stop" /> stop {fmtShort(t.stop)}: no new {label}s until VACUUM freezes
        </span>
      </p>
    </>
  );
}

export default function XidWraparound({ heading }) {
  const [stored, setState, status] = useLocalStorage("xid:state", SAMPLE_STATE);
  const state = { ...EMPTY_STATE, ...stored, xid: { ...EMPTY_STATE.xid, ...stored?.xid }, mxid: { ...EMPTY_STATE.mxid, ...stored?.mxid } };
  const kind = state.tab === "mxid" ? "mxid" : "xid";
  const cur = state[kind];
  const k = KINDS[kind];
  const setCur = (patch) =>
    setState((prev) => {
      const base = { ...EMPTY_STATE, ...prev };
      return { ...base, [kind]: { ...EMPTY_STATE[kind], ...base[kind], ...patch } };
    });
  const setTop = (patch) => setState((prev) => ({ ...EMPTY_STATE, ...prev, ...patch }));

  const freezeMaxAge = parseCount(cur.freeze);
  const failsafeAge = parseCount(cur.failsafe);
  const ratePerDay = parseCount(cur.rate);
  const errors = validateSettings(kind, { freezeMaxAge, failsafeAge });
  const rateErr = cur.rate.trim() && !(ratePerDay > 0) ? "Enter a positive number, e.g. 25M." : null;
  const settingsOk = !errors.freezeMaxAge && !errors.failsafeAge;
  const rate = ratePerDay > 0 ? ratePerDay : null;

  const text = useDeferredValue(cur.text);
  const result = useMemo(
    () =>
      settingsOk
        ? analyze(text, kind, { freezeMaxAge, failsafeAge, version: state.version, ratePerDay: rate })
        : { error: "Fix the settings to see results." },
    [text, kind, freezeMaxAge, failsafeAge, state.version, rate, settingsOk],
  );
  const t = settingsOk ? thresholds(kind, { freezeMaxAge, failsafeAge, version: state.version }) : null;

  return (
    <div className="pg-xid">
      <div className="util-toolbar" role="toolbar" aria-label="XID wraparound calculator">
        {heading}
        <div className="util-segmented" role="group" aria-label="ID type">
          {Object.values(KINDS).map((x) => (
            <button
              key={x.id}
              type="button"
              className={kind === x.id ? "button small is-active" : "button small"}
              aria-pressed={kind === x.id}
              onClick={() => setTop({ tab: x.id })}
            >
              {x.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setState({ ...SAMPLE_STATE, tab: kind })}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (window.confirm("Clear all inputs (both tabs)?")) setState({ ...EMPTY_STATE, tab: kind });
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="xid-grid">
        <section className="xid-card" aria-labelledby="xid-input-h">
          <h2 id="xid-input-h" className="xid-h">
            {k.label} ages
          </h2>
          <p className="xid-sub">
            Paste psql (aligned or <code>\x</code>) or CSV output with a name column and{" "}
            {kind === "xid" ? (
              <>
                <code>age(datfrozenxid)</code> or <code>age(relfrozenxid)</code>
              </>
            ) : (
              <>
                <code>mxid_age(datminmxid)</code> or <code>mxid_age(relminmxid)</code>
              </>
            )}
            . Database-level and table-level output both work.
          </p>
          <textarea
            className="xid-textarea"
            value={cur.text}
            onChange={(e) => setCur({ text: e.target.value })}
            spellCheck={false}
            aria-label={`${k.label} age query output`}
            placeholder={kind === "xid" ? " datname | xid_age\n---------+---------\n mydb    | 123456" : " relname | mxid_age\n---------+---------\n t1      | 123456"}
          />
          <Query title="Per-database query" sql={QUERIES.database} />
          <Query title="Per-table query" sql={QUERIES.relation} />
        </section>

        <section className="xid-card" aria-labelledby="xid-settings-h">
          <h2 id="xid-settings-h" className="xid-h">
            Settings
          </h2>
          <div className="xid-field">
            <label htmlFor="xid-version" className="xid-label">
              Server version
            </label>
            <select id="xid-version" className="xid-input" value={state.version} onChange={(e) => setTop({ version: e.target.value })}>
              {VERSIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className="xid-msg">
              {state.version === "legacy"
                ? "No failsafe; stop 1M (MultiXact: 100) and warn 10M before the stop."
                : state.version === "pg19"
                  ? "Stop 3M, warn 100M before wraparound."
                  : "Stop 3M, warn 40M before wraparound."}
            </span>
          </div>
          <NumField
            id="xid-freeze"
            label={k.freezeSetting}
            value={cur.freeze}
            onChange={(v) => setCur({ freeze: v })}
            error={errors.freezeMaxAge}
            hint={`Default ${fmtShort(k.defaults.freezeMaxAge)}. Per-table reloptions can lower it.`}
          />
          {state.version !== "legacy" && (
            <NumField
              id="xid-failsafe"
              label={k.failsafeSetting}
              value={cur.failsafe}
              onChange={(v) => setCur({ failsafe: v })}
              error={errors.failsafeAge}
              hint={t ? `Default 1.6B. Effective: ${fmt(t.failsafe)} (at least 105% of the freeze max age).` : undefined}
            />
          )}
          <NumField
            id="xid-rate"
            label={`${k.label}s consumed per day (optional)`}
            value={cur.rate}
            onChange={(v) => setCur({ rate: v })}
            error={rateErr}
            placeholder="25M"
            hint="Used for days remaining. Accepts 25M, 1.2B, 300k."
          />
          <Query title="How to measure the rate" sql={QUERIES.rate[kind]} />
          <Query title="Show current settings" sql={QUERIES.settings} />
          {t && (
            <dl className="xid-limits">
              <dt>Forced autovacuum at</dt>
              <dd>{fmt(t.freeze)}</dd>
              {t.failsafe !== null && (
                <>
                  <dt>Failsafe at</dt>
                  <dd>{fmt(t.failsafe)}</dd>
                </>
              )}
              <dt>Warnings from</dt>
              <dd>{fmt(t.warn)}</dd>
              <dt>Stops assigning at</dt>
              <dd>{fmt(t.stop)}</dd>
              <dt>Wraparound horizon</dt>
              <dd>{fmt(WRAP)} (2³¹ − 1)</dd>
            </dl>
          )}
        </section>

        <section className="xid-card xid-card-wide" aria-labelledby="xid-results-h">
          <h2 id="xid-results-h" className="xid-h">
            Results
          </h2>
          <Results kind={kind} result={result} rate={rate} />
        </section>
      </div>

      <div className="util-statusbar">
        <span>
          {result.rows ? `${result.rows.length} rows · ${result.rows.filter((r) => r.severity !== "ok").length} need attention` : "No data"}
        </span>
        <span>Computed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
