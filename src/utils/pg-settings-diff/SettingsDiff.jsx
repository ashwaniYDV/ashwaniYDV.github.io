import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { diffSettings, filterDiff, parseSettings, shownValue, toMarkdown } from "./settings.js";
import { SAMPLE_LEFT, SAMPLE_RIGHT } from "./sample.js";
import "./settings-diff.css";

const STATUS = {
  changed: { label: "Changed", icon: "fa-pencil" },
  left: { label: "Only left", icon: "fa-arrow-left" },
  right: { label: "Only right", icon: "fa-arrow-right" },
  equal: { label: "Same", icon: "fa-check" },
};

const FORMAT_LABEL = { psql: "psql table", tsv: "tab-separated", csv: "CSV", conf: "name = value" };

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

function Value({ s }) {
  if (!s) return <span className="psd-missing">—</span>;
  const shown = shownValue(s);
  const showNorm = (s.norm.kind || s.unit) && s.norm.display !== shown;
  return (
    <>
      <span className="psd-raw">{shown === "" ? <em className="psd-empty">(empty)</em> : shown}</span>
      {showNorm && <span className="psd-norm"> = {s.norm.display}</span>}
    </>
  );
}

function Pane({ id, label, onLabel, value, onChange, parsed }) {
  return (
    <div className="psd-pane">
      <div className="psd-pane-head">
        <label htmlFor={`${id}-label`} className="psd-sr">
          Name for this side
        </label>
        <input id={`${id}-label`} className="psd-name" value={label} onChange={(e) => onLabel(e.target.value)} maxLength={40} />
        <span className="psd-pane-meta">
          {parsed.settings.size ? `${parsed.settings.size} settings · ${FORMAT_LABEL[parsed.format]}` : "empty"}
        </span>
      </div>
      <textarea
        id={id}
        aria-label={`${label} settings`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={"Paste SHOW ALL output, or\nSELECT name, setting, unit FROM pg_settings;"}
      />
    </div>
  );
}

export default function SettingsDiff({ heading }) {
  const [left, setLeft, status] = useLocalStorage("settings-diff:left", SAMPLE_LEFT);
  const [right, setRight] = useLocalStorage("settings-diff:right", SAMPLE_RIGHT);
  const [prefs, setPrefs] = useLocalStorage("settings-diff:prefs", { search: "", hideEqual: true, leftLabel: "Left", rightLabel: "Right" });
  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const dl = useDeferredValue(left);
  const dr = useDeferredValue(right);
  const parsedLeft = useMemo(() => parseSettings(dl), [dl]);
  const parsedRight = useMemo(() => parseSettings(dr), [dr]);
  const rows = useMemo(() => diffSettings(dl, dr), [dl, dr]);
  const shown = filterDiff(rows, { search: prefs.search ?? "", hideEqual: prefs.hideEqual });
  const counts = rows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
  const normalisedCount = rows.filter((r) => r.normalised).length;
  const leftLabel = prefs.leftLabel || "Left";
  const rightLabel = prefs.rightLabel || "Right";

  return (
    <div className="pg-settings-diff">
      <div className="util-toolbar" role="toolbar" aria-label="Settings diff">
        {heading}
        <input
          type="search"
          className="psd-search"
          placeholder="Filter settings…"
          aria-label="Filter settings by name or value"
          value={prefs.search ?? ""}
          onChange={(e) => set({ search: e.target.value })}
        />
        <label className="psd-option">
          <input type="checkbox" checked={prefs.hideEqual} onChange={(e) => set({ hideEqual: e.target.checked })} />
          <span>Hide equal</span>
        </label>
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" disabled={!shown.length} onClick={async () => setCopied(await copyText(toMarkdown(shown, { leftLabel, rightLabel })))}>
          <i className={`fa ${copied ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : "Copy as Markdown"}
        </button>
        <button
          type="button"
          className="button small"
          title="Swap left and right"
          onClick={() => {
            setLeft(right);
            setRight(left);
            set({ leftLabel: prefs.rightLabel, rightLabel: prefs.leftLabel });
          }}
        >
          <i className="fa fa-exchange" aria-hidden="true"></i>&nbsp;Swap
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            setLeft(SAMPLE_LEFT);
            setRight(SAMPLE_RIGHT);
            set({ leftLabel: "Left", rightLabel: "Right", search: "" });
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if ((left || right) && window.confirm("Clear both listings?")) {
              setLeft("");
              setRight("");
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <p className="psd-hint">
        Paste <code>SHOW ALL</code> or <code>SELECT name, setting, unit FROM pg_settings</code> from two servers (psql aligned,
        unaligned <code>-A</code>, or CSV). Units are normalised, so <code>128MB</code> equals <code>16384 × 8kB</code>.
      </p>

      <div className="psd-inputs">
        <Pane id="psd-left" label={prefs.leftLabel ?? "Left"} onLabel={(v) => set({ leftLabel: v })} value={left} onChange={setLeft} parsed={parsedLeft} />
        <Pane id="psd-right" label={prefs.rightLabel ?? "Right"} onLabel={(v) => set({ rightLabel: v })} value={right} onChange={setRight} parsed={parsedRight} />
      </div>

      <section className="psd-result" aria-label="Differences">
        <div className="psd-summary">
          {["changed", "left", "right", "equal"].map((k) => (
            <span key={k} className={`psd-chip is-${k}`}>
              <i className={`fa ${STATUS[k].icon}`} aria-hidden="true"></i> {STATUS[k].label}: <strong>{counts[k] ?? 0}</strong>
            </span>
          ))}
          {normalisedCount > 0 && (
            <span className="psd-chip-note">
              {normalisedCount} written differently but equal after unit/boolean normalisation
            </span>
          )}
        </div>
        {shown.length ? (
          <div className="psd-table-wrap">
            <table className="psd-table">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">{leftLabel}</th>
                  <th scope="col">{rightLabel}</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.name} className={`is-${r.status}`}>
                    <td className="psd-name-cell">
                      <code>{r.name}</code>
                    </td>
                    <td className={r.status === "changed" ? "psd-old" : ""}>
                      <Value s={r.left} />
                    </td>
                    <td className={r.status === "changed" ? "psd-new" : ""}>
                      <Value s={r.right} />
                    </td>
                    <td>
                      <span className={`psd-status is-${r.status}`}>{STATUS[r.status].label}</span>
                      {r.normalised && (
                        <span className="psd-normalised" title="The raw text differs but the values are equal once units are normalised">
                          {" "}
                          (units)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="psd-none">
            {rows.length ? "No differences match." : "Paste a settings listing on each side to compare."}
          </p>
        )}
      </section>

      <div className="util-statusbar">
        <span>
          {rows.length} settings · {shown.length} shown
        </span>
        <span>Compared locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
