import { useMemo } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { HINTS, PRESETS, STATUSES, hintsToInfomask, parseSnapshot, satisfiesMVCC, toXid32 } from "./mvcc.js";
import "./MvccSimulator.css";

const DEFAULT_PRESET = PRESETS.find((p) => p.id === "deleted-after");

const HINT_GROUPS = [
  { title: "xmin hints", ids: ["xminCommitted", "xminInvalid"] },
  { title: "xmax hints", ids: ["xmaxCommitted", "xmaxInvalid", "xmaxLockOnly", "xmaxExclLock", "xmaxKeyshrLock", "xmaxIsMulti"] },
];
const hintById = Object.fromEntries(HINTS.map((h) => [h.id, h]));
const HINT_HELP = {
  xminCommitted: "inserter known committed",
  xminInvalid: "inserter known aborted",
  xmaxCommitted: "deleter known committed",
  xmaxInvalid: "no (valid) deleter",
  xmaxLockOnly: "xmax only locked the row",
  xmaxExclLock: "exclusive locker",
  xmaxKeyshrLock: "key-share locker",
  xmaxIsMulti: "xmax is a MultiXactId",
};

const hex = (v) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`;

// ---------- small inputs ----------
function NumField({ id, label, value, onChange, hint }) {
  return (
    <div className="mv-field">
      <label htmlFor={id} className="mv-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="mv-input"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
      />
      {hint && <span className="mv-hint">{hint}</span>}
    </div>
  );
}

function StatusPicker({ label, value, onChange }) {
  return (
    <div className="mv-status" role="radiogroup" aria-label={label}>
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          className={`mv-status-btn is-${s.replace(" ", "-")}${value === s ? " is-active" : ""}`}
          onClick={() => onChange(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

// ---------- snapshot number line ----------
function SnapshotLine({ snap, input }) {
  if (!snap || snap.error) return null;
  const marks = [
    { x: toXid32(Number(input.xmin) || 0), label: "tuple xmin", cls: "is-xmin" },
    ...(Number(input.xmax) ? [{ x: toXid32(Number(input.xmax)), label: "tuple xmax", cls: "is-xmax" }] : []),
    ...(Number(input.myXid) ? [{ x: toXid32(Number(input.myXid)), label: "my xid", cls: "is-me" }] : []),
  ];
  const values = [snap.xmin, snap.xmax, ...snap.xip, ...marks.map((m) => m.x)];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max(2, Math.round((hi - lo) * 0.12));
  lo -= pad;
  hi += pad;
  const W = 640;
  const L = 16;
  const R = W - 16;
  const pos = (v) => L + ((v - lo) / Math.max(1, hi - lo)) * (R - L);
  const axisY = 70;
  // Stagger marker labels that would collide.
  const placed = [];
  // Merge marks on the same xid ("tuple xmax = my xid 124").
  const merged = [];
  for (const m of marks) {
    const same = merged.find((x) => x.x === m.x);
    if (same) same.label = `${same.label} = ${m.label}`;
    else merged.push({ ...m });
  }
  const laid = merged
    .sort((a, b) => a.x - b.x)
    .map((m) => {
      const x = pos(m.x);
      let level = 0;
      while (placed.some((p) => p.level === level && Math.abs(p.x - x) < 78)) level++;
      placed.push({ x, level });
      return { ...m, px: x, level };
    });

  return (
    <svg className="mv-line" viewBox={`0 0 ${W} 120`} role="img" aria-label={`Snapshot ${snap.xmin}:${snap.xmax}:${snap.xip.join(",")}`}>
      <rect x={L} y={axisY - 7} width={pos(snap.xmin) - L} height="14" className="mv-band is-past" />
      <rect x={pos(snap.xmin)} y={axisY - 7} width={pos(snap.xmax) - pos(snap.xmin)} height="14" className="mv-band is-mid" />
      <rect x={pos(snap.xmax)} y={axisY - 7} width={R - pos(snap.xmax)} height="14" className="mv-band is-future" />
      {snap.xip.map((x) => (
        <g key={x}>
          <rect x={pos(x) - 3} y={axisY - 7} width="6" height="14" className="mv-xip" />
          <text x={pos(x)} y={axisY + 22} textAnchor="middle" className="mv-tick is-xip">
            {x}
          </text>
        </g>
      ))}
      {[
        ["snap.xmin", snap.xmin],
        ["snap.xmax", snap.xmax],
      ].map(([label, v]) => (
        <g key={label}>
          <line x1={pos(v)} x2={pos(v)} y1={axisY - 12} y2={axisY + 12} className="mv-bound" />
          <text x={pos(v)} y={axisY + 36} textAnchor="middle" className="mv-tick">
            {label} {v}
          </text>
        </g>
      ))}
      {laid.map((m) => (
        <g key={m.label} className={`mv-mark ${m.cls}`}>
          <line x1={m.px} x2={m.px} y1={axisY - 10} y2={40 - m.level * 14} />
          <circle cx={m.px} cy={axisY} r="4" />
          <text x={m.px} y={36 - m.level * 14} textAnchor="middle">
            {m.label} {m.x}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------- main ----------
export default function MvccSimulator({ heading }) {
  const [stored, setInput, status] = useLocalStorage("mvcc:input", DEFAULT_PRESET.input);
  // Fill gaps if an older or hand-edited value is missing fields.
  const input = useMemo(
    () => ({ ...DEFAULT_PRESET.input, ...stored, hints: { ...DEFAULT_PRESET.input.hints, ...(stored?.hints ?? {}) } }),
    [stored],
  );
  const result = useMemo(() => satisfiesMVCC(input), [input]);
  const snap = useMemo(() => parseSnapshot(input.snapshot), [input.snapshot]);
  const activePreset = PRESETS.find((p) => JSON.stringify(p.input) === JSON.stringify(input));

  const set = (patch) => setInput({ ...input, ...patch });
  const setHint = (id, on) => set({ hints: { ...input.hints, [id]: on } });
  const infomask = hintsToInfomask(input.hints);
  const frozen = input.hints.xminCommitted && input.hints.xminInvalid;

  return (
    <div className="pg-mvcc">
      <div className="util-toolbar" role="toolbar" aria-label="MVCC visibility simulator">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setInput(DEFAULT_PRESET.input)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() =>
            setInput({
              ...DEFAULT_PRESET.input,
              xmin: 0,
              xmax: 0,
              hints: Object.fromEntries(HINTS.map((h) => [h.id, false])),
              snapshot: "",
            })
          }
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="mv-main">
        <section className="mv-pane mv-form" aria-label="Inputs">
          <h3 className="mv-h3 mv-first">Scenarios</h3>
          <div className="mv-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`mv-preset${activePreset?.id === p.id ? " is-active" : ""}`}
                aria-pressed={activePreset?.id === p.id}
                title={p.note}
                onClick={() => setInput(p.input)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {activePreset && <p className="mv-preset-note">{activePreset.note}</p>}

          <h3 className="mv-h3">Tuple</h3>
          <div className="mv-xid-row">
            <NumField id="mv-xmin" label="t_xmin" value={String(input.xmin)} onChange={(v) => set({ xmin: v === "" ? 0 : Number(v) })} />
            <div className="mv-field">
              <span className="mv-label">xmin outcome in pg_xact</span>
              <StatusPicker label="xmin status" value={input.xminStatus} onChange={(v) => set({ xminStatus: v })} />
            </div>
          </div>
          <div className="mv-xid-row">
            <NumField
              id="mv-xmax"
              label="t_xmax"
              value={String(input.xmax)}
              onChange={(v) => set({ xmax: v === "" ? 0 : Number(v) })}
              hint="0 = never deleted"
            />
            <div className="mv-field">
              <span className="mv-label">xmax outcome in pg_xact</span>
              <StatusPicker label="xmax status" value={input.xmaxStatus} onChange={(v) => set({ xmaxStatus: v })} />
            </div>
          </div>

          <h3 className="mv-h3">
            t_infomask hint bits <code className="mv-code">{hex(infomask)}</code>
          </h3>
          <div className="mv-hints">
            {HINT_GROUPS.map((g) => (
              <fieldset key={g.title} className="mv-hint-group">
                <legend>{g.title}</legend>
                {g.ids.map((id) => (
                  <label key={id} className="mv-check">
                    <input type="checkbox" checked={Boolean(input.hints[id])} onChange={(e) => setHint(id, e.target.checked)} />
                    <span className="mv-check-name">{hintById[id].name.replace("HEAP_", "")}</span>
                    <span className="mv-check-help">{HINT_HELP[id]}</span>
                  </label>
                ))}
                {g.title === "xmin hints" && (
                  <button
                    type="button"
                    className={`mv-mini${frozen ? " is-active" : ""}`}
                    aria-pressed={frozen}
                    onClick={() => set({ hints: { ...input.hints, xminCommitted: !frozen, xminInvalid: !frozen } })}
                  >
                    <i className="fa fa-snowflake-o" aria-hidden="true"></i> {frozen ? "Frozen (both bits)" : "Freeze xmin"}
                  </button>
                )}
              </fieldset>
            ))}
          </div>

          <h3 className="mv-h3">My transaction</h3>
          <div className="mv-grid4">
            <NumField id="mv-myxid" label="my xid" value={String(input.myXid)} onChange={(v) => set({ myXid: v === "" ? 0 : Number(v) })} hint="0 = none yet" />
            <NumField id="mv-curcid" label="curcid" value={String(input.curcid)} onChange={(v) => set({ curcid: v === "" ? 0 : Number(v) })} hint="scan's command id" />
            <NumField id="mv-cmin" label="tuple cmin" value={String(input.cmin)} onChange={(v) => set({ cmin: v === "" ? 0 : Number(v) })} />
            <NumField id="mv-cmax" label="tuple cmax" value={String(input.cmax)} onChange={(v) => set({ cmax: v === "" ? 0 : Number(v) })} />
          </div>
          <p className="mv-small">cmin and cmax only matter when xmin or xmax is my own xid.</p>

          <h3 className="mv-h3">Snapshot</h3>
          <div className="mv-field">
            <label htmlFor="mv-snap" className="mv-label">
              xmin:xmax:xip_list
            </label>
            <input
              id="mv-snap"
              type="text"
              autoComplete="off"
              spellCheck={false}
              className="mv-input mv-mono"
              value={input.snapshot}
              placeholder="120:125:121,123"
              onChange={(e) => set({ snapshot: e.target.value })}
            />
            <span className="mv-hint">
              From <code className="mv-code">SELECT pg_current_snapshot();</code> (64-bit values are reduced to 32-bit xids).
            </span>
          </div>
        </section>

        <section className="mv-pane mv-result" aria-label="Result" aria-live="polite">
          {result.error ? (
            <div className="mv-verdict is-error" role="alert">
              <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {result.error}
            </div>
          ) : (
            <div className={`mv-verdict ${result.visible ? "is-visible" : "is-invisible"}`}>
              <i className={`fa ${result.visible ? "fa-eye" : "fa-eye-slash"}`} aria-hidden="true"></i>
              <span>
                <strong>{result.visible ? "Visible" : "Not visible"}</strong>
                <span className="mv-verdict-sub">to this snapshot (HeapTupleSatisfiesMVCC returns {result.visible ? "true" : "false"})</span>
              </span>
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="mv-warnings">
              {result.warnings.map((w) => (
                <li key={w}>
                  <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> {w}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mv-h3">Snapshot</h3>
          <SnapshotLine snap={snap} input={input} />
          <p className="mv-small mv-line-legend">
            <span className="mv-key is-past" /> finished before the snapshot <span className="mv-key is-mid" /> finished unless listed in
            xip <span className="mv-key is-xip" /> running (xip) <span className="mv-key is-future" /> not started yet: running
          </p>

          <h3 className="mv-h3">Reasoning</h3>
          <ol className="mv-steps">
            {result.steps.map((s, i) => (
              <li key={i} className={s.result === undefined ? "" : s.result ? "is-true" : "is-false"}>
                <span className="mv-step-text">{s.text}</span>
                <code className="mv-step-code">{s.code}</code>
              </li>
            ))}
          </ol>

          {result.hintsSet.length > 0 && (
            <>
              <h3 className="mv-h3">Side effect</h3>
              <p className="mv-small">
                A real scan would set {result.hintsSet.map((h) => <code key={h} className="mv-code">{h}</code>)} on the tuple (SetHintBits), so the next
                reader can skip the pg_xact lookup.
              </p>
            </>
          )}

          <h3 className="mv-h3">About this model</h3>
          <p className="mv-small">
            Follows <code className="mv-code">HeapTupleSatisfiesMVCC</code> in src/backend/access/heap/heapam_visibility.c and{" "}
            <code className="mv-code">XidInMVCCSnapshot</code> in snapmgr.c. Simplified: no subtransactions, a MultiXact xmax stands for its
            updater, pre-9.0 MOVED_IN/OFF bits are ignored, and pg_xact is whatever you pick above.
          </p>
        </section>
      </div>

      <div className="util-statusbar">
        <span>{result.error ? "Invalid snapshot" : `${result.visible ? "Visible" : "Not visible"} · ${result.steps.length} steps`}</span>
        <span>Runs locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
