import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import {
  HEAP_XMAX_INVALID,
  HEAP_XMIN_COMMITTED,
  HEAP_XMIN_INVALID,
  ITEM_ID_SIZE,
  LP_FLAGS,
  PAGE_HEADER_SIZE,
  bin16,
  hex16,
  hexBytes,
  inspect,
  leInt,
} from "./pageinspect.js";
import { SAMPLE_BTREE, SAMPLE_HEAP } from "./sample.js";
import "./PageInspector.css";

const EDGE_LABEL = { redirect: "redirect", hot: "HOT", update: "update" };

// ---------- page map ----------
const BPR = 1024; // bytes per map row
const UNIT = 1; // viewBox units per byte
const ROW_H = 28;
const ROW_GAP = 7;
const LEFT = 56;

function segments(start, end) {
  const out = [];
  for (let r = Math.floor(start / BPR); r * BPR < end; r++) {
    const s = Math.max(start, r * BPR);
    const e = Math.min(end, (r + 1) * BPR);
    if (e > s) out.push({ x: LEFT + (s - r * BPR) * UNIT, y: r * (ROW_H + ROW_GAP), w: (e - s) * UNIT, row: r });
  }
  return out;
}

const regionClass = (r) => `pi-r-${r.kind}${r.tone ? ` is-${r.tone}` : ""}`;

const REGION_TITLE = {
  header: "Page header (24 bytes): LSN, checksum, flags, pd_lower, pd_upper, pd_special, version, prune xid",
  linp: "Line pointer array (4 bytes each), grows forward up to pd_lower",
  free: "Free space between pd_lower and pd_upper",
  gap: "Alignment padding or space not accounted for by a live line pointer",
  items: "Index tuples (bt_page_items has no offsets, so they are drawn as one block)",
  special: "Special space (B-tree: BTPageOpaqueData with sibling links and level)",
};

function PageMap({ layout, tuples = [], chains, selectedLp, onSelect }) {
  const rows = Math.ceil(layout.pagesize / BPR);
  const height = rows * (ROW_H + ROW_GAP);
  const width = LEFT + BPR * UNIT + 4;
  const byLp = new Map(tuples.map((t) => [t.lp, t]));

  const tupleAnchor = (lp) => {
    const t = byLp.get(lp);
    if (!t) return null;
    if (t.lpFlags === 1 && t.lpLen > 0) {
      const seg = segments(t.lpOff, t.lpOff + t.lpLen)[0];
      return seg && { x: seg.x + seg.w / 2, y: seg.y };
    }
    return slotAnchor(lp);
  };
  const slotAnchor = (lp) => {
    const off = PAGE_HEADER_SIZE + ITEM_ID_SIZE * (lp - 1);
    const seg = segments(off, off + ITEM_ID_SIZE)[0];
    return seg && { x: seg.x + seg.w / 2, y: seg.y };
  };

  const arrows = [];
  (chains ?? []).forEach((chain, ci) =>
    chain.forEach((node, i) => {
      if (i === 0 || node.lp === undefined) return;
      const from = chain[i - 1].lp;
      const a = node.kind === "redirect" ? slotAnchor(from) : tupleAnchor(from);
      const b = tupleAnchor(node.lp);
      if (!a || !b) return;
      const lift = Math.max(ROW_H * 0.9, Math.min(120, Math.abs(a.x - b.x) / 3));
      const d = `M ${a.x} ${a.y} C ${a.x} ${a.y - lift}, ${b.x} ${b.y - lift}, ${b.x} ${b.y}`;
      arrows.push({ key: `${ci}-${i}`, d, kind: node.kind });
    }),
  );

  const sel = selectedLp !== null ? byLp.get(selectedLp) : null;
  let selLink = null;
  if (sel && sel.lpFlags === 1 && sel.lpLen > 0) {
    const a = slotAnchor(sel.lp);
    const b = tupleAnchor(sel.lp);
    if (a && b) selLink = `M ${a.x} ${a.y + ROW_H} L ${b.x} ${b.y + ROW_H}`;
  }

  const activate = (lp) => (e) => {
    if (e.type === "click" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(lp);
    }
  };

  return (
    <svg className="pi-map" viewBox={`0 ${-ROW_H * 1.2} ${width} ${height + ROW_H * 1.2}`} role="group" aria-label="Page layout">
      <defs>
        {["redirect", "hot", "update"].map((k) => (
          <marker key={k} id={`pi-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`pi-arrowhead is-${k}`} />
          </marker>
        ))}
        <pattern id="pi-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="pi-hatch-line" />
        </pattern>
      </defs>

      {Array.from({ length: rows }, (_, r) => (
        <text key={r} x={LEFT - 6} y={r * (ROW_H + ROW_GAP) + ROW_H / 2 + 4} className="pi-map-offset" textAnchor="end">
          {r * BPR}
        </text>
      ))}

      {layout.regions.map((region, i) => {
        if (region.kind === "linp") return null;
        const segs = segments(region.start, region.end);
        const size = region.end - region.start;
        const title =
          region.kind === "tuple"
            ? `lp ${region.lp}: bytes ${region.start}–${region.end - 1} (${size} B)`
            : `${REGION_TITLE[region.kind]} · bytes ${region.start}–${region.end - 1} (${size} B)`;
        const clickable = region.kind === "tuple";
        const label =
          region.kind === "tuple" ? `${region.lp}` : region.kind === "free" ? `free ${size} B` : region.kind === "header" ? "hdr" : region.kind === "special" ? "special" : region.kind === "items" ? "index tuples" : "";
        const widest = segs.reduce((a, b) => (b.w > a.w ? b : a), segs[0]);
        return (
          <g
            key={i}
            className={[regionClass(region), clickable && selectedLp === region.lp ? "is-selected" : ""].join(" ")}
            {...(clickable
              ? { role: "button", tabIndex: 0, "aria-label": `Tuple at line pointer ${region.lp}`, onClick: activate(region.lp), onKeyDown: activate(region.lp) }
              : {})}
          >
            <title>{title}</title>
            {segs.map((s, j) => (
              <rect key={j} x={s.x} y={s.y} width={s.w} height={ROW_H} rx="2" />
            ))}
            {label && widest && widest.w >= label.length * 7 + 6 && (
              <text x={widest.x + widest.w * (region.kind === "free" ? 0.2 : 0.5)} y={widest.y + ROW_H / 2 + 4} textAnchor="middle" className="pi-map-label">
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* line pointer slots, coloured by lp_flags */}
      {tuples.length > 0
        ? tuples.map((t) => {
            const off = PAGE_HEADER_SIZE + ITEM_ID_SIZE * (t.lp - 1);
            return segments(off, off + ITEM_ID_SIZE).map((s, j) => (
              <rect
                key={`${t.lp}-${j}`}
                x={s.x + 0.5}
                y={s.y}
                width={s.w - 1}
                height={ROW_H}
                className={`pi-slot is-lp${t.lpFlags}${selectedLp === t.lp ? " is-selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Line pointer ${t.lp} (${LP_FLAGS[t.lpFlags]?.short ?? t.lpFlags})`}
                onClick={activate(t.lp)}
                onKeyDown={activate(t.lp)}
              >
                <title>{`lp ${t.lp}: ${LP_FLAGS[t.lpFlags]?.name ?? t.lpFlags}, off ${t.lpOff}, len ${t.lpLen}`}</title>
              </rect>
            ));
          })
        : layout.regions
            .filter((r) => r.kind === "linp")
            .flatMap((r) => segments(r.start, r.end))
            .map((s, j) => <rect key={j} x={s.x} y={s.y} width={s.w} height={ROW_H} className="pi-slot is-lp1" />)}

      {selLink && <path d={selLink} className="pi-sel-link" />}
      {arrows.map((a) => (
        <path key={a.key} d={a.d} className={`pi-arrow is-${a.kind}`} markerEnd={`url(#pi-arrow-${a.kind})`} />
      ))}
    </svg>
  );
}

// ---------- chains ----------
function Chains({ chains, tuples, selectedLp, onSelect }) {
  const byLp = new Map(tuples.map((t) => [t.lp, t]));
  if (!chains.length) return <p className="pi-muted">No update chains on this page.</p>;
  return (
    <ol className="pi-chains">
      {chains.map((chain, i) => (
        <li key={i}>
          {chain.map((node, j) => (
            <span key={j} className="pi-chain-step">
              {j > 0 && (
                <span className={`pi-chain-arrow is-${node.kind}`}>
                  <span>{EDGE_LABEL[node.kind]}</span>
                  <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
                </span>
              )}
              {node.lp !== undefined ? (
                <button
                  type="button"
                  className={`pi-chip is-${byLp.get(node.lp)?.state.tone ?? "muted"}${selectedLp === node.lp ? " is-selected" : ""}`}
                  onClick={() => onSelect(node.lp)}
                  disabled={node.missing}
                  title={byLp.get(node.lp)?.state.label ?? "line pointer not in the input"}
                >
                  lp {node.lp}
                </button>
              ) : (
                <span className="pi-chip is-external" title="New version on another page">
                  {node.external}
                </span>
              )}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

// ---------- tables ----------
const abbreviations = {
  HEAP_HASNULL: "N",
  HEAP_HASVARWIDTH: "V",
  HEAP_HASEXTERNAL: "E",
  HEAP_XMIN_COMMITTED: "xminC",
  HEAP_XMIN_INVALID: "xminI",
  HEAP_XMAX_COMMITTED: "xmaxC",
  HEAP_XMAX_INVALID: "xmaxI",
  HEAP_XMAX_LOCK_ONLY: "LOCK",
  HEAP_XMAX_EXCL_LOCK: "EXCL",
  HEAP_XMAX_KEYSHR_LOCK: "KSHR",
  HEAP_XMAX_IS_MULTI: "MULTI",
  HEAP_UPDATED: "UPD",
  HEAP_COMBOCID: "COMBO",
  HEAP_HOT_UPDATED: "HOT",
  HEAP_ONLY_TUPLE: "HOnly",
  HEAP_KEYS_UPDATED: "KEYS",
};

function FlagPills({ flags }) {
  return (
    <span className="pi-pills">
      {flags
        .filter((f) => f.set)
        .map((f) => (
          <span key={f.name} className={`pi-pill is-${f.group}`} title={f.name}>
            {abbreviations[f.name] ?? f.name.replace("HEAP_", "")}
          </span>
        ))}
    </span>
  );
}

function HeapTable({ tuples, selectedLp, onSelect }) {
  return (
    <div className="pi-table-wrap">
      <table className="pi-table">
        <thead>
          <tr>
            <th scope="col">lp</th>
            <th scope="col">lp_flags</th>
            <th scope="col">off</th>
            <th scope="col">len</th>
            <th scope="col">xmin</th>
            <th scope="col">xmax</th>
            <th scope="col">t_ctid</th>
            <th scope="col">t_infomask</th>
            <th scope="col">t_infomask2</th>
            <th scope="col">state</th>
          </tr>
        </thead>
        <tbody>
          {tuples.map((t) => (
            <tr key={t.lp} className={selectedLp === t.lp ? "is-selected" : ""} onClick={() => onSelect(t.lp)}>
              <td>
                <button type="button" className="pi-row-btn" onClick={() => onSelect(t.lp)} aria-pressed={selectedLp === t.lp}>
                  {t.lp}
                </button>
              </td>
              <td>
                <span className={`pi-lp is-lp${t.lpFlags}`}>{LP_FLAGS[t.lpFlags]?.short ?? t.lpFlags}</span>
              </td>
              <td className="pi-num">{t.lpOff}</td>
              <td className="pi-num">{t.lpLen}</td>
              <td className="pi-num">{t.xmin ?? ""}</td>
              <td className="pi-num">{t.xmax ?? ""}</td>
              <td>{t.ctidText ?? ""}</td>
              <td>
                {t.infomask !== null && (
                  <>
                    <code className="pi-hex">{hex16(t.infomask)}</code> <FlagPills flags={t.infomaskFlags} />
                  </>
                )}
              </td>
              <td>
                {t.infomask2 !== null && (
                  <>
                    <span className="pi-natts" title="Number of attributes">
                      {t.natts} att
                    </span>{" "}
                    <FlagPills flags={t.infomask2Flags} />
                  </>
                )}
              </td>
              <td>
                <span className={`pi-state is-${t.state.tone}`}>{t.state.label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BtreeTable({ items }) {
  const cols = ["itemoffset", "ctid", "itemlen", "nulls", "vars", "dead", "htid", "data"];
  return (
    <div className="pi-table-wrap">
      <table className="pi-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
            <th scope="col">decoded</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.itemoffset}>
              {cols.map((c) => (
                <td key={c} className={c === "data" ? "pi-mono" : ""}>
                  {it.raw[c] ?? ""}
                </td>
              ))}
              <td>
                {it.pivot && <span className="pi-state is-hot">pivot / high key</span>}
                {it.posting && <span className="pi-state is-live">posting list: {it.tids.length} TIDs {it.tids.join(" ")}</span>}
                {it.dead === "t" && <span className="pi-state is-dead">LP_DEAD hint</span>}
                {it.int4 !== null && (
                  <span className="pi-muted" title="First 4 bytes read as a little-endian int4">
                    {" "}
                    int4 {it.int4}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- side panel ----------
function KV({ rows }) {
  return (
    <dl className="pi-kv">
      {rows.map(([k, v, hint]) => (
        <div key={k} className="pi-kv-row">
          <dt>{k}</dt>
          <dd>
            {v}
            {hint && <span className="pi-kv-hint">{hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BitGrid({ value, flags, natts }) {
  return (
    <div className="pi-bits">
      <div className="pi-bits-head">
        <code className="pi-hex">{hex16(value)}</code> <span className="pi-muted">= {value} = {bin16(value).replace(/(.{4})/g, "$1 ").trim()}</span>
      </div>
      <ul className="pi-flaglist">
        {natts !== undefined && (
          <li className="is-set">
            <code>0x07FF</code> <span className="pi-flagname">HEAP_NATTS_MASK</span>
            <span className="pi-flagdesc">{natts} attribute(s)</span>
          </li>
        )}
        {flags.map((f) => (
          <li key={f.name} className={f.set ? "is-set" : ""}>
            <code>{hex16(f.bit)}</code> <span className="pi-flagname">{f.name}</span>
            {f.set && <span className="pi-flagdesc">{f.desc}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TupleDetails({ t, onBack, onSelect, onMvcc }) {
  const lp = LP_FLAGS[t.lpFlags];
  const bytes = hexBytes(t.data);
  return (
    <div className="pi-details">
      <button type="button" className="pi-back" onClick={onBack}>
        <i className="fa fa-angle-left" aria-hidden="true"></i>&nbsp;Page summary
      </button>
      <h2 className="pi-h">
        lp {t.lp} <span className={`pi-lp is-lp${t.lpFlags}`}>{lp?.short ?? t.lpFlags}</span>
      </h2>
      <p className="pi-subtitle">
        <span className={`pi-state is-${t.state.tone}`}>{t.state.label}</span> · TID ({t.selfTid.block},{t.lp})
      </p>
      {t.state.notes.length > 0 && (
        <ul className="pi-notes">
          {t.state.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h3 className="pi-h3">Line pointer</h3>
      <KV
        rows={[
          ["lp_flags", `${t.lpFlags} (${lp?.name ?? "?"})`, lp?.desc],
          [
            "lp_off",
            t.lpFlags === 2 ? (
              <button type="button" className="pi-inline-link" onClick={() => onSelect(t.lpOff)}>
                → lp {t.lpOff}
              </button>
            ) : (
              t.lpOff
            ),
            t.lpFlags === 2 ? "redirect target" : t.lpFlags === 1 ? "byte offset of the tuple in the page" : undefined,
          ],
          ["lp_len", t.lpLen, t.lpFlags === 1 ? "tuple length in bytes (header + data)" : undefined],
        ]}
      />

      {t.infomask !== null && (
        <>
          <h3 className="pi-h3">Tuple header</h3>
          <KV
            rows={[
              ["t_xmin", t.xmin, "inserting transaction"],
              ["t_xmax", t.xmax, t.xmax ? "deleting/updating/locking transaction" : "0: never deleted or locked"],
              ["t_field3", t.field3, t.infomask & 0x0020 ? "combo command id" : "cmin or cmax (or xvac for pre-9.0 VACUUM FULL)"],
              [
                "t_ctid",
                t.ctidText,
                t.ctid && (t.ctid.block !== t.selfTid.block || t.ctid.offset !== t.lp) ? "points to a newer version" : "points to itself: latest version",
              ],
              ["t_hoff", t.hoff, t.hoff !== null ? `header + null bitmap + padding; data starts at byte ${t.hoff}` : undefined],
              ...(t.bits ? [["t_bits", t.bits, t.nulls.length ? `NULL attributes: ${t.nulls.join(", ")}` : "no NULLs"]] : []),
              ...(t.oid ? [["t_oid", t.oid]] : []),
            ]}
          />
          <h3 className="pi-h3">t_infomask</h3>
          <BitGrid value={t.infomask} flags={t.infomaskFlags} />
          {t.infomask2 !== null && (
            <>
              <h3 className="pi-h3">t_infomask2</h3>
              <BitGrid value={t.infomask2} flags={t.infomask2Flags} natts={t.natts} />
            </>
          )}
          {bytes.length > 0 && (
            <>
              <h3 className="pi-h3">t_data ({bytes.length} bytes)</h3>
              <code className="pi-hexdump">{bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}</code>
              {bytes.length >= 4 && <p className="pi-muted">First 4 bytes as a little-endian int4: {leInt(bytes, 4)}</p>}
            </>
          )}
          {t.xmin !== null && (
            <button type="button" className="pi-action" onClick={() => onMvcc(t)}>
              <i className="fa fa-eye" aria-hidden="true"></i>&nbsp;Check visibility in the MVCC simulator
            </button>
          )}
        </>
      )}
    </div>
  );
}

function PageSummary({ result, view }) {
  const header = result.header;
  const layout = view === "btree" ? result.btree.layout : result.heap?.layout ?? result.layout;
  const counts = {};
  (result.heap?.tuples ?? []).forEach((t) => (counts[t.lpFlags] = (counts[t.lpFlags] ?? 0) + 1));
  return (
    <div className="pi-details">
      <h2 className="pi-h">Page summary</h2>
      {layout.inferred && (
        <p className="pi-note">No page_header() output, so pd_lower and pd_upper are inferred from the line pointers.</p>
      )}
      <KV
        rows={[
          ["page size", `${layout.pagesize} B`],
          ["pd_lower", layout.lower, "end of the line pointer array"],
          ["pd_upper", layout.upper, "start of tuple data"],
          ["pd_special", layout.special, layout.special === layout.pagesize ? "no special space (heap)" : `${layout.pagesize - layout.special} B special space`],
          ["free space", `${layout.free} B`, `${((layout.free / layout.pagesize) * 100).toFixed(1)}% of the page`],
          ...(header
            ? [
                ["lsn", header.lsn, "WAL position of the last change to this page"],
                ["checksum", header.checksum, header.checksum === 0 ? "0: data checksums are probably off" : undefined],
                [
                  "pd_flags",
                  header.flags,
                  header.flagList.filter((f) => f.set).map((f) => f.name).join(", ") || "none set",
                ],
                ["version", header.version],
                ["prune_xid", header.pruneXid, header.pruneXid ? "oldest xmax that may make pruning worthwhile" : "0: nothing to prune"],
              ]
            : []),
        ]}
      />
      {result.heap && (
        <>
          <h3 className="pi-h3">Line pointers</h3>
          <KV rows={Object.entries(LP_FLAGS).map(([k, f]) => [f.name, counts[k] ?? 0])} />
        </>
      )}
      <h3 className="pi-h3">Legend</h3>
      <ul className="pi-legend">
        <li>
          <span className="pi-swatch pi-r-header" /> header
        </li>
        <li>
          <span className="pi-swatch pi-slot is-lp1" /> line pointer
        </li>
        <li>
          <span className="pi-swatch pi-r-free" /> free space
        </li>
        {result.heap && (
          <>
            <li>
              <span className="pi-swatch pi-r-tuple is-live" /> live tuple
            </li>
            <li>
              <span className="pi-swatch pi-r-tuple is-dead" /> dead / old version
            </li>
            <li>
              <span className="pi-swatch pi-r-tuple is-warn" /> no hint bits yet
            </li>
            <li>
              <span className="pi-legend-arrow is-hot" /> HOT
            </li>
            <li>
              <span className="pi-legend-arrow is-redirect" /> redirect
            </li>
            <li>
              <span className="pi-legend-arrow is-update" /> update
            </li>
          </>
        )}
        <li>
          <span className="pi-swatch pi-r-special" /> special
        </li>
      </ul>
      <p className="pi-muted pi-tip">
        {result.heap ? "Click a tuple (in the map, chains or table) to decode every field." : "Hover a region for its byte range."} States are
        read from hint bits only; this tool can&apos;t see pg_xact.
      </p>
    </div>
  );
}

// ---------- main ----------
export default function PageInspector({ heading }) {
  const [input, setInput, status] = useLocalStorage("page-inspector:input", SAMPLE_HEAP);
  const [prefs, setPrefs] = useLocalStorage("page-inspector:prefs", { view: "page" });
  const [selectedLp, setSelectedLp] = useState(null);
  const navigate = useNavigate();

  const deferred = useDeferredValue(input);
  const result = useMemo(() => inspect(deferred), [deferred]);
  useEffect(() => setSelectedLp(null), [deferred]);

  const view = prefs.view === "input" || result.error ? "input" : "page";
  const kind = result.heap ? "heap" : result.btree ? "btree" : "header";
  const selected = selectedLp !== null ? result.heap?.tuples.find((t) => t.lp === selectedLp) : null;
  const setView = (v) => setPrefs({ ...prefs, view: v });

  const openMvcc = (t) => {
    // Hand the tuple to the MVCC simulator through its persisted input.
    const key = "ashwaniydv:utils:mvcc:input";
    let prev = {};
    try {
      prev = JSON.parse(window.localStorage.getItem(key)) ?? {};
    } catch {
      prev = {};
    }
    const im = t.infomask ?? 0;
    const hints = {
      xminCommitted: (im & HEAP_XMIN_COMMITTED) !== 0,
      xminInvalid: (im & HEAP_XMIN_INVALID) !== 0,
      xmaxCommitted: (im & 0x0400) !== 0,
      xmaxInvalid: (im & HEAP_XMAX_INVALID) !== 0,
      xmaxLockOnly: (im & 0x0080) !== 0,
      xmaxExclLock: (im & 0x0040) !== 0,
      xmaxKeyshrLock: (im & 0x0010) !== 0,
      xmaxIsMulti: (im & 0x1000) !== 0,
    };
    const status = (committed, invalid) => (committed ? "committed" : invalid ? "aborted" : "committed");
    const next = {
      snapshot: "100:100:",
      myXid: 0,
      curcid: 0,
      ...prev,
      xmin: t.xmin ?? 0,
      xmax: t.xmax ?? 0,
      hints,
      xminStatus: status(hints.xminCommitted, hints.xminInvalid && !hints.xminCommitted),
      xmaxStatus: status(hints.xmaxCommitted, hints.xmaxInvalid),
      cmin: t.field3 ?? 0,
      cmax: t.field3 ?? 0,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage disabled: the simulator opens with its own state */
    }
    navigate("/pgutils/mvcc");
  };

  return (
    <div className="pg-page-inspector">
      <div className="util-toolbar" role="toolbar" aria-label="Page inspector">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {[
            { id: "input", label: "Input", icon: "fa-code" },
            { id: "page", label: "Page", icon: "fa-th" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              disabled={v.id === "page" && Boolean(result.error)}
              onClick={() => setView(v.id)}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button
          type="button"
          className="button small"
          onClick={() => {
            setInput(SAMPLE_HEAP);
            setView("page");
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Heap sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            setInput(SAMPLE_BTREE);
            setView("page");
          }}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;B-tree sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (input && window.confirm("Clear the pasted output?")) {
              setInput("");
              setView("input");
            }
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      {view === "input" ? (
        <div className="pi-input">
          <p className="pi-input-hint">
            <code>CREATE EXTENSION pageinspect;</code> then paste the output of{" "}
            <code>SELECT * FROM heap_page_items(get_raw_page(&apos;t&apos;, 0));</code>, optionally together with{" "}
            <code>page_header(get_raw_page(&apos;t&apos;, 0))</code>, or <code>bt_page_items(&apos;t_idx&apos;, 1)</code>. Aligned, expanded (
            <code>\x</code>), unaligned (<code>\a</code>) and CSV output all work.
          </p>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder=" lp | lp_off | lp_flags | lp_len | t_xmin | ..."
            aria-label="pageinspect output"
          />
          <div className="pi-input-actions">
            {result.error && result.error !== "empty" && (
              <span className="pi-error" role="alert">
                <i className="fa fa-exclamation-circle" aria-hidden="true"></i> {result.error}
              </span>
            )}
            <span className="util-toolbar-spacer" />
            <button type="button" className="button small primary" disabled={Boolean(result.error)} onClick={() => setView("page")}>
              Inspect&nbsp;<i className="fa fa-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      ) : (
        <div className="pi-main">
          <aside className="pi-side" aria-label={selected ? "Tuple details" : "Page summary"}>
            {selected ? (
              <TupleDetails t={selected} onBack={() => setSelectedLp(null)} onSelect={setSelectedLp} onMvcc={openMvcc} />
            ) : (
              <PageSummary result={result} view={kind} />
            )}
          </aside>
          <section className="pi-canvas" aria-label="Page">
            <h3 className="pi-h3 pi-first">
              Page layout{result.heap ? ` · block ${result.heap.block}` : ""}
            </h3>
            <PageMap
              layout={kind === "heap" ? result.heap.layout : kind === "btree" ? result.btree.layout : result.layout}
              tuples={result.heap?.tuples}
              chains={result.heap?.chains}
              selectedLp={selectedLp}
              onSelect={setSelectedLp}
            />
            {result.heap && (
              <>
                <h3 className="pi-h3">Update and HOT chains</h3>
                <Chains chains={result.heap.chains} tuples={result.heap.tuples} selectedLp={selectedLp} onSelect={setSelectedLp} />
                <h3 className="pi-h3">heap_page_items</h3>
                <HeapTable tuples={result.heap.tuples} selectedLp={selectedLp} onSelect={setSelectedLp} />
              </>
            )}
            {result.btree && (
              <>
                <h3 className="pi-h3">bt_page_items</h3>
                <BtreeTable items={result.btree.items} />
              </>
            )}
          </section>
        </div>
      )}

      <div className="util-statusbar">
        <span>
          {result.error
            ? "No page"
            : result.heap
              ? `${result.heap.tuples.length} line pointers · ${result.heap.layout.free} B free · ${result.heap.chains.length} chains`
              : result.btree
                ? `${result.btree.items.length} index items · ${result.btree.layout.free} B free`
                : "Page header only"}
        </span>
        <span>Decoded locally, nothing is uploaded.</span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
