import { useDeferredValue, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import {
  MB,
  SEGMENT_SIZES,
  addBytes,
  formatLsn,
  groupDigits,
  humanBytes,
  lsnToSegment,
  parseByteAmount,
  parseLsn,
  replicationLag,
  segmentToLsn,
  validateTimeline,
} from "./lsn.js";
import { REPLICATION_QUERY, SAMPLE_STATE } from "./sample.js";
import "./pg-lsn.css";

const EMPTY_STATE = { a: "", b: "", delta: "", tli: "1", segMb: "16", segName: "", repl: "", current: "" };

function Field({ id, label, value, onChange, placeholder, error, hint, width }) {
  return (
    <div className="lsn-field" style={width ? { maxWidth: width } : undefined}>
      <label htmlFor={id} className="lsn-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        className={error ? "lsn-input is-invalid" : "lsn-input"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
      />
      {(error || hint) && (
        <span id={`${id}-msg`} className={error ? "lsn-msg is-error" : "lsn-msg"}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

function Out({ label, children, mono = true }) {
  return (
    <div className="lsn-out">
      <span className="lsn-out-label">{label}</span>
      <span className={mono ? "lsn-out-value is-mono" : "lsn-out-value"}>{children}</span>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="lsn-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
      aria-label={`${label}: ${text.length > 40 ? "query" : text}`}
    >
      <i className={`fa ${done ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>
      {done ? " Copied" : ` ${label}`}
    </button>
  );
}

const errOf = (p, raw) => (raw.trim() && p.error ? p.error : null);

// ---------- LSN arithmetic ----------
function Arithmetic({ state, set }) {
  const a = parseLsn(state.a);
  const b = parseLsn(state.b);
  const d = parseByteAmount(state.delta);
  const diff = !a.error && !b.error ? a.value - b.value : undefined;
  const plus = !a.error && !d.error ? addBytes(a.value, d.value) : null;
  const minus = !a.error && !d.error ? addBytes(a.value, -d.value) : null;

  return (
    <section className="lsn-card" aria-labelledby="lsn-arith-h">
      <h2 id="lsn-arith-h" className="lsn-h">
        LSN arithmetic
      </h2>
      <p className="lsn-sub">
        Same as <code>pg_wal_lsn_diff(a, b)</code> and <code>a + bytes</code> (PG 14+), without a database.
      </p>
      <div className="lsn-row">
        <Field id="lsn-a" label="LSN A" value={state.a} onChange={(v) => set({ a: v })} placeholder="16/B374D848" error={errOf(a, state.a)} />
        <Field id="lsn-b" label="LSN B" value={state.b} onChange={(v) => set({ b: v })} placeholder="16/A9000000" error={errOf(b, state.b)} />
      </div>
      {!a.error && (
        <div className="lsn-outs">
          <Out label="A as bytes">{groupDigits(a.value)}</Out>
          <Out label="A hex">0x{a.value.toString(16).toUpperCase().padStart(16, "0")}</Out>
          {a.fromBytes && <Out label="A as LSN">{formatLsn(a.value)}</Out>}
        </div>
      )}
      {diff !== undefined && (
        <div className={diff < 0n ? "lsn-result is-neg" : "lsn-result"}>
          <span className="lsn-result-label">A − B</span>
          <span className="lsn-result-big">{humanBytes(diff)}</span>
          <span className="lsn-result-small">
            {groupDigits(diff)} bytes{diff < 0n ? " · A is behind B" : diff > 0n ? " · A is ahead of B" : " · same position"}
          </span>
        </div>
      )}
      <div className="lsn-row">
        <Field
          id="lsn-delta"
          label="Bytes to add / subtract"
          value={state.delta}
          onChange={(v) => set({ delta: v })}
          placeholder="16MB, 8192, -1GB"
          error={errOf(d, state.delta)}
          hint={!d.error ? `${groupDigits(d.value)} bytes (1 kB = 1024)` : undefined}
        />
      </div>
      {plus && (
        <div className="lsn-outs">
          <Out label="A + bytes">{plus.error ?? formatLsn(plus.value)}</Out>
          <Out label="A − bytes">{minus.error ?? formatLsn(minus.value)}</Out>
        </div>
      )}
    </section>
  );
}

// ---------- LSN -> segment ----------
function SegmentInfo({ state, set, segSize }) {
  const a = parseLsn(state.a);
  const tliErr = state.tli.trim() === "" ? "Enter a timeline (usually 1)." : validateTimeline(state.tli);
  const info = !a.error && !tliErr ? lsnToSegment(a.value, Number(state.tli), segSize) : null;

  return (
    <section className="lsn-card" aria-labelledby="lsn-seg-h">
      <h2 id="lsn-seg-h" className="lsn-h">
        LSN → WAL segment
      </h2>
      <p className="lsn-sub">
        Uses LSN A above. File name per <code>XLogFileName()</code>: timeline, then segment number split into log and
        segment parts.
      </p>
      <div className="lsn-row">
        <Field id="lsn-tli" label="Timeline" value={state.tli} onChange={(v) => set({ tli: v })} placeholder="1" error={tliErr && state.tli.trim() ? tliErr : null} width="9em" />
        <div className="lsn-field" style={{ maxWidth: "12em" }}>
          <label htmlFor="lsn-segsize" className="lsn-label">
            wal_segment_size
          </label>
          <select id="lsn-segsize" className="lsn-input" value={state.segMb} onChange={(e) => set({ segMb: e.target.value })}>
            {SEGMENT_SIZES.map((s) => (
              <option key={String(s)} value={String(s / MB)}>
                {s / MB >= 1024n ? "1 GB" : `${s / MB} MB`}
                {s === 16n * MB ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      {a.error ? (
        <p className="lsn-muted">Enter a valid LSN A to see its segment.</p>
      ) : info?.error ? (
        <p className="lsn-msg is-error">{info.error}</p>
      ) : info ? (
        <>
          <div className="lsn-result">
            <span className="lsn-result-label">WAL file</span>
            <span className="lsn-result-big is-mono">
              {info.fileName} <CopyButton text={info.fileName} />
            </span>
            {info.onBoundary && info.walfileName !== info.fileName && (
              <span className="lsn-result-small">
                On a segment boundary: <code>pg_walfile_name()</code> returns the previous file, <code>{info.walfileName}</code>.
              </span>
            )}
          </div>
          <div className="lsn-outs">
            <Out label="Segment number">{groupDigits(info.segno)}</Out>
            <Out label="Offset in segment">
              {groupDigits(info.offset)} (0x{info.offset.toString(16).toUpperCase()})
            </Out>
            <Out label="WAL page / offset">
              page {groupDigits(info.page)} + {String(info.pageOffset)}
            </Out>
            <Out label="Segment starts">{formatLsn(info.start)}</Out>
            <Out label="Next segment starts">{formatLsn(info.end)}</Out>
            <Out label="Room left in segment">{humanBytes(info.end - a.value)}</Out>
          </div>
        </>
      ) : null}
    </section>
  );
}

// ---------- segment -> LSN range ----------
function SegmentRange({ state, set, segSize }) {
  const r = state.segName.trim() ? segmentToLsn(state.segName, segSize) : null;
  return (
    <section className="lsn-card" aria-labelledby="lsn-range-h">
      <h2 id="lsn-range-h" className="lsn-h">
        WAL file → LSN range
      </h2>
      <p className="lsn-sub">Paste a segment name from pg_wal/ or the archive. Uses the segment size selected above.</p>
      <Field
        id="lsn-segname"
        label="WAL segment file"
        value={state.segName}
        onChange={(v) => set({ segName: v })}
        placeholder="000000010000001600000002"
        error={r?.error ?? null}
      />
      {r && !r.error && (
        <div className="lsn-outs">
          <Out label="Timeline">{r.tli}</Out>
          <Out label="Segment number">{groupDigits(r.segno)}</Out>
          <Out label="First LSN">{formatLsn(r.start)}</Out>
          <Out label="Last LSN">{formatLsn(r.end - 1n)}</Out>
          <Out label="Next segment starts">{formatLsn(r.end)}</Out>
          {r.isBackupLabel && <Out label="Note" mono={false}>Backup history file: shows its segment.</Out>}
        </div>
      )}
    </section>
  );
}

// ---------- replication lag ----------
const LAG_PARTS = [
  { id: "send", label: "Not sent", hint: "current − sent_lsn: WAL still on the primary" },
  { id: "write", label: "Write", hint: "sent − write_lsn: received, not yet written" },
  { id: "flush", label: "Flush", hint: "write − flush_lsn: written, not yet fsynced" },
  { id: "replay", label: "Replay", hint: "flush − replay_lsn: durable, not yet applied" },
];

function ReplicationLag({ state, set }) {
  const repl = useDeferredValue(state.repl);
  const current = useDeferredValue(state.current);
  const result = useMemo(() => replicationLag(repl, current), [repl, current]);
  const curErr = state.current.trim() ? parseLsn(state.current).error : null;
  const max = result.standbys?.reduce((m, s) => (s.lag.total !== undefined && s.lag.total > m ? s.lag.total : m), 0n) ?? 0n;

  return (
    <section className="lsn-card lsn-card-wide" aria-labelledby="lsn-repl-h">
      <h2 id="lsn-repl-h" className="lsn-h">
        Replication lag
      </h2>
      <p className="lsn-sub">
        Paste <code>pg_stat_replication</code> from the primary (psql aligned, expanded <code>\x</code>, or CSV). Lag is
        bytes of WAL at each stage.
      </p>
      <details className="lsn-query">
        <summary>Query to run</summary>
        <pre>{REPLICATION_QUERY}</pre>
        <CopyButton text={REPLICATION_QUERY} label="Copy query" />
      </details>
      <div className="lsn-repl-grid">
        <div className="lsn-field">
          <label htmlFor="lsn-repl" className="lsn-label">
            pg_stat_replication output
          </label>
          <textarea
            id="lsn-repl"
            className="lsn-textarea"
            value={state.repl}
            onChange={(e) => set({ repl: e.target.value })}
            spellCheck={false}
            placeholder=" pid | application_name | sent_lsn | write_lsn | flush_lsn | replay_lsn"
          />
        </div>
        <Field
          id="lsn-current"
          label="pg_current_wal_lsn() (optional)"
          value={state.current}
          onChange={(v) => set({ current: v })}
          placeholder="16/B3750F00"
          error={curErr}
          hint={!state.current.trim() ? "Blank: the highest sent_lsn is used." : undefined}
        />
      </div>
      {result.error && result.error !== "empty" && <p className="lsn-msg is-error" role="alert">{result.error}</p>}
      {result.problems?.map((p) => (
        <p key={p} className="lsn-msg is-error">
          {p}
        </p>
      ))}
      {result.standbys?.length > 0 && (
        <>
          <p className="lsn-muted">
            Reference: {result.current !== undefined ? formatLsn(result.current) : "unknown"} ({result.currentSource})
          </p>
          <div className="lsn-table-wrap">
            <table className="lsn-table">
              <thead>
                <tr>
                  <th scope="col">Standby</th>
                  <th scope="col">State</th>
                  {LAG_PARTS.map((p) => (
                    <th key={p.id} scope="col" title={p.hint}>
                      {p.label}
                    </th>
                  ))}
                  <th scope="col">Total (to replay)</th>
                  <th scope="col" className="lsn-bar-col">
                    Breakdown
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.standbys.map((s, i) => (
                  <tr key={`${s.name}-${i}`}>
                    <th scope="row">
                      {s.name}
                      {s.syncState && <span className="lsn-tag">{s.syncState}</span>}
                    </th>
                    <td>{s.state || "—"}</td>
                    {LAG_PARTS.map((p) => (
                      <td key={p.id} className="is-num" title={s.lag[p.id] !== undefined ? `${groupDigits(s.lag[p.id])} bytes` : undefined}>
                        {s.lag[p.id] === undefined ? "—" : humanBytes(s.lag[p.id])}
                      </td>
                    ))}
                    <td className="is-num is-strong">{s.lag.total === undefined ? "—" : humanBytes(s.lag.total)}</td>
                    <td className="lsn-bar-col">
                      <LagBar lag={s.lag} max={max} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lsn-legend">
            {LAG_PARTS.map((p) => (
              <span key={p.id}>
                <span className={`lsn-swatch is-${p.id}`} aria-hidden="true" /> {p.hint}
              </span>
            ))}
          </p>
        </>
      )}
    </section>
  );
}

function LagBar({ lag, max }) {
  if (!max || max <= 0n) return <span className="lsn-muted">no lag</span>;
  const pct = (v) => (v === undefined || v <= 0n ? 0 : Number((v * 10000n) / max) / 100);
  return (
    <span className="lsn-bar" role="img" aria-label={`Total ${lag.total === undefined ? "unknown" : humanBytes(lag.total)}`}>
      {LAG_PARTS.map((p) => (
        <span key={p.id} className={`is-${p.id}`} style={{ width: `${pct(lag[p.id])}%` }} />
      ))}
    </span>
  );
}

// ---------- main ----------
export default function LsnCalculator({ heading }) {
  const [state, setState, status] = useLocalStorage("lsn:state", SAMPLE_STATE);
  const s = { ...EMPTY_STATE, ...state };
  const set = (patch) => setState((prev) => ({ ...EMPTY_STATE, ...prev, ...patch }));
  const segSize = BigInt(s.segMb || "16") * MB;

  return (
    <div className="pg-lsn">
      <div className="util-toolbar" role="toolbar" aria-label="LSN and WAL calculator">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setState(SAMPLE_STATE)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (window.confirm("Clear all inputs?")) setState(EMPTY_STATE);
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="lsn-grid">
        <Arithmetic state={s} set={set} />
        <div className="lsn-stack">
          <SegmentInfo state={s} set={set} segSize={segSize} />
          <SegmentRange state={s} set={set} segSize={segSize} />
        </div>
        <ReplicationLag state={s} set={set} />
      </div>

      <div className="util-statusbar">
        <span>LSNs are 64-bit byte positions in WAL, printed as two 32-bit hex halves.</span>
        <span>Computed locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
