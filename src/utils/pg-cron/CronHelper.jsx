import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { copyText, highlightSql } from "../pg-format/highlight.js";
import { FIELDS, explain, isValidTimeZone, nextRuns, parseSchedule, scheduleSql, unscheduleSql } from "./cron.js";
import "./cron.css";

const PRESETS = [
  ["*/5 * * * *", "Every 5 min"],
  ["0 * * * *", "Hourly"],
  ["30 3 * * *", "Daily 03:30"],
  ["0 9 * * 1-5", "Weekdays 09:00"],
  ["0 12 $ * *", "Last day of month"],
  ["0 0 1,15 * 1", "1st, 15th or Monday"],
  ["30 seconds", "Every 30 s"],
];

const SAMPLE = {
  schedule: "30 3 * * 6",
  name: "purge-old-events",
  command: "DELETE FROM events WHERE created_at < now() - interval '90 days'",
  database: "",
  cronTz: "GMT",
  displayTz: "",
  matchDomAndDow: false,
};

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

function timeZones() {
  let list = [];
  try {
    list = Intl.supportedValuesOf("timeZone");
  } catch {
    list = ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo"];
  }
  return ["GMT", "UTC", ...list.filter((z) => z !== "UTC" && z !== "GMT")];
}

function fmtIn(ms, timeZone, withSeconds) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(ms));
}

function fmtRelative(ms, now) {
  const mins = Math.round((ms - now) / 60000);
  if (Math.abs(ms - now) < 60000) return `in ${Math.max(0, Math.round((ms - now) / 1000))} s`;
  if (mins < 60) return `in ${mins} min`;
  const hours = mins / 60;
  if (hours < 48) return `in ${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  const days = hours / 24;
  if (days < 60) return `in ${days.toFixed(days < 10 ? 1 : 0)} days`;
  return `in ${(days / 30.44).toFixed(1)} months`;
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const t = window.setTimeout(() => setDone(false), 1400);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button type="button" className="pc-btn" onClick={async () => setDone(await copyText(text))} aria-label={`Copy ${label}`}>
      <i className={`fa ${done ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i> {done ? "Copied" : "Copy"}
    </button>
  );
}

function SqlBlock({ title, code }) {
  return (
    <div className="pc-sql">
      <div className="pc-sql-head">
        <h3 className="pc-h3">{title}</h3>
        <CopyButton text={code} label={title} />
      </div>
      <pre className="pc-code">
        <code className="hljs language-pgsql" dangerouslySetInnerHTML={{ __html: highlightSql(code) }} />
      </pre>
    </div>
  );
}

function TzSelect({ id, label, value, onChange, zones }) {
  return (
    <div className="pc-tz">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function CronHelper({ heading }) {
  const [state, setState, status] = useLocalStorage("cron:state", SAMPLE);
  const set = (patch) => setState({ ...state, ...patch });
  const zones = useMemo(timeZones, []);
  const cronTz = isValidTimeZone(state.cronTz) ? state.cronTz : "GMT";
  const displayTz = state.displayTz && isValidTimeZone(state.displayTz) ? state.displayTz : browserTz();
  const zoneOptions = zones.includes(displayTz) ? zones : [displayTz, ...zones];

  // Tick once a minute so "next runs" stay current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const schedule = useDeferredValue(state.schedule);
  const parsed = useMemo(() => {
    try {
      return { schedule: parseSchedule(schedule) };
    } catch (e) {
      return { error: e.message };
    }
  }, [schedule]);
  const minute = Math.floor(now / 60000);
  const runs = useMemo(
    () =>
      parsed.schedule
        ? nextRuns(parsed.schedule, parsed.schedule.kind === "interval" ? now : minute * 60000, 10, {
            timeZone: cronTz,
            matchDomAndDow: state.matchDomAndDow,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed, parsed.schedule?.kind === "interval" ? now : minute, cronTz, state.matchDomAndDow],
  );
  const info = parsed.schedule ? explain(parsed.schedule, { matchDomAndDow: state.matchDomAndDow }) : null;
  const interval = parsed.schedule?.kind === "interval";

  const sqlSchedule = scheduleSql({
    name: state.name.trim(),
    schedule: state.schedule,
    command: state.command || "SELECT 1",
    database: state.database.trim(),
  });
  const sqlUnschedule = unscheduleSql({ name: state.name.trim() });
  const sqlInspect = state.name.trim()
    ? `SELECT jobid, schedule, active FROM cron.job WHERE jobname = '${state.name.trim().replace(/'/g, "''")}';\n\nSELECT status, start_time, end_time, return_message\n  FROM cron.job_run_details\n WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = '${state.name.trim().replace(/'/g, "''")}')\n ORDER BY start_time DESC LIMIT 10;`
    : "SELECT jobid, jobname, schedule, active FROM cron.job;";

  return (
    <div className="pg-cron">
      <div className="util-toolbar" role="toolbar" aria-label="pg_cron schedule helper">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setState({ ...SAMPLE, displayTz: state.displayTz })}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (window.confirm("Clear the schedule and job?")) set({ schedule: "", name: "", command: "", database: "" });
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <section className="pc-card pc-schedule" aria-label="Schedule">
        <label className="pc-big-label" htmlFor="pc-expr">
          Schedule
        </label>
        <input
          id="pc-expr"
          className={parsed.error ? "pc-expr is-invalid" : "pc-expr"}
          value={state.schedule}
          onChange={(e) => set({ schedule: e.target.value })}
          spellCheck={false}
          autoComplete="off"
          placeholder="*/5 * * * *"
          aria-invalid={Boolean(parsed.error)}
          aria-describedby="pc-explain"
        />
        <div className="pc-presets" role="group" aria-label="Examples">
          {PRESETS.map(([expr, label]) => (
            <button
              key={expr}
              type="button"
              className={state.schedule.trim() === expr ? "pc-chip is-active" : "pc-chip"}
              onClick={() => set({ schedule: expr })}
              title={expr}
            >
              {label}
            </button>
          ))}
        </div>

        {parsed.schedule?.kind === "cron" && (
          <div className="pc-fields">
            {FIELDS.map((f) => (
              <div key={f.id} className="pc-fieldbox">
                <code>{parsed.schedule.fields[f.id].text}</code>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        )}

        <div id="pc-explain" className="pc-explain" aria-live="polite">
          {parsed.error ? (
            <p className="pc-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {parsed.error}
            </p>
          ) : (
            <>
              <p className="pc-sentence">{info.text}</p>
              {!interval && <p className="pc-tzline">in cron.timezone = {cronTz}</p>}
              {info.notes.length > 0 && (
                <ul className="pc-notes">
                  {info.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      <div className="pc-grid">
        <section className="pc-card" aria-label="Next runs">
          <div className="pc-card-head">
            <h2 className="pc-h">Next {runs.length || 10} runs</h2>
          </div>
          <div className="pc-tzrow">
            <TzSelect id="pc-crontz" label="cron.timezone (server)" value={cronTz} onChange={(v) => set({ cronTz: v })} zones={zones} />
            <TzSelect id="pc-displaytz" label="Show times in" value={displayTz} onChange={(v) => set({ displayTz: v })} zones={zoneOptions} />
            <label className="pc-check">
              <input
                type="checkbox"
                checked={Boolean(state.matchDomAndDow)}
                onChange={(e) => set({ matchDomAndDow: e.target.checked })}
              />
              <span>cron.match_dom_and_dow</span>
            </label>
          </div>
          {parsed.error ? (
            <p className="pc-muted">Fix the schedule to see run times.</p>
          ) : runs.length === 0 ? (
            <p className="pc-muted">This schedule never matches a real date in the next 8 years (e.g. 30 February).</p>
          ) : (
            <div className="pc-table-wrap">
              <table className="pc-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">UTC</th>
                    <th scope="col">{displayTz}</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((t, i) => (
                    <tr key={t}>
                      <td>{i + 1}</td>
                      <td>{fmtIn(t, "UTC", interval)}</td>
                      <td>{fmtIn(t, displayTz, interval)}</td>
                      <td>{fmtRelative(t, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!parsed.error && runs.length > 0 && runs.length < 10 && (
            <p className="pc-muted">Only {runs.length} runs in the next 8 years.</p>
          )}
          <div className="pc-explainer">
            <h3 className="pc-h3">Which time zone does pg_cron use?</h3>
            <p>
              Cron schedules are read in the server setting <code>cron.timezone</code>, which defaults to <code>GMT</code>, not
              in your session&apos;s <code>TimeZone</code>. So <code>0 9 * * *</code> means 09:00 GMT unless the server says
              otherwise. Check it with <code>SHOW cron.timezone;</code>. Changing it needs a server restart.
            </p>
            {interval ? (
              <p>Second-based schedules ignore time zones; the times above assume a run starts now.</p>
            ) : (
              <p>
                In a zone with daylight saving time, a local time that is skipped when clocks go forward does not run that day,
                and a time that repeats when clocks go back can run twice. The list above follows pg_cron&apos;s minute-by-minute
                check, so it shows this.
              </p>
            )}
            {cronTz !== "GMT" && (
              <SqlBlock title="Set the server time zone" code={`ALTER SYSTEM SET cron.timezone = '${cronTz}';\n-- then restart PostgreSQL`} />
            )}
          </div>
        </section>

        <section className="pc-card" aria-label="SQL">
          <div className="pc-card-head">
            <h2 className="pc-h">SQL</h2>
          </div>
          <div className="pc-form">
            <div className="pc-input">
              <label htmlFor="pc-name">Job name</label>
              <input id="pc-name" value={state.name} onChange={(e) => set({ name: e.target.value })} placeholder="nightly-vacuum" />
            </div>
            <div className="pc-input">
              <label htmlFor="pc-db">Database (optional)</label>
              <input
                id="pc-db"
                value={state.database}
                onChange={(e) => set({ database: e.target.value })}
                placeholder="current database"
              />
            </div>
            <div className="pc-input pc-wide">
              <label htmlFor="pc-cmd">Command</label>
              <textarea
                id="pc-cmd"
                rows={3}
                value={state.command}
                onChange={(e) => set({ command: e.target.value })}
                spellCheck={false}
                placeholder="VACUUM ANALYZE events"
              />
            </div>
          </div>
          {parsed.error && <p className="pc-error">The schedule is invalid, so cron.schedule() would reject it.</p>}
          <SqlBlock title="Schedule" code={sqlSchedule} />
          <SqlBlock title="Unschedule" code={sqlUnschedule} />
          <SqlBlock title="Inspect" code={sqlInspect} />
          <p className="pc-muted">
            A named job is replaced if you schedule the same name again. The command is wrapped in dollar quotes, so it can
            contain single quotes.
          </p>
        </section>
      </div>

      <div className="util-statusbar">
        <span>Computed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
