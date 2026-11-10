import { useMemo, useState } from "react";
import { newId, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";
import { ELEM_TYPES, TOAST_THRESHOLD, TYPES, createTable, estimate, estimateBtree, fmtBytes, sqlType } from "./rowsize.js";
import { BLANK_TABLE, SAMPLE_TABLE, newColumn } from "./sample.js";
import "./pg-rowsize.css";

const fmtN = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—");
const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#a855f7", "#ef4444"];

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

const needsLen = (t) => t === "text" || t === "varchar" || t === "bytea" || t === "jsonb";

function TypeParams({ col, update, idx }) {
  if (needsLen(col.type)) {
    return (
      <input
        className="pr-input pr-param"
        type="number"
        min="0"
        value={col.avgLen}
        onChange={(e) => update({ avgLen: e.target.value })}
        placeholder="avg bytes"
        aria-label={`Column ${idx + 1} average size in bytes`}
        title="Average stored size in bytes"
      />
    );
  }
  if (col.type === "numeric") {
    return (
      <span className="pr-param pr-param-pair">
        <input className="pr-input" type="number" min="1" max="1000" value={col.precision} onChange={(e) => update({ precision: e.target.value })} placeholder="p" aria-label={`Column ${idx + 1} precision`} title="Precision (total digits)" />
        <input className="pr-input" type="number" min="0" value={col.scale} onChange={(e) => update({ scale: e.target.value })} placeholder="s" aria-label={`Column ${idx + 1} scale`} title="Scale (digits after the point)" />
      </span>
    );
  }
  if (col.type === "array") {
    return (
      <span className="pr-param pr-param-pair">
        <select className="pr-input" value={col.elemType} onChange={(e) => update({ elemType: e.target.value })} aria-label={`Column ${idx + 1} element type`}>
          {ELEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}[]
            </option>
          ))}
        </select>
        <input className="pr-input" type="number" min="0" value={col.elemCount} onChange={(e) => update({ elemCount: e.target.value })} placeholder="n" aria-label={`Column ${idx + 1} average element count`} title="Average number of elements" />
        {col.elemType === "text" && (
          <input className="pr-input" type="number" min="0" value={col.avgLen} onChange={(e) => update({ avgLen: e.target.value })} placeholder="len" aria-label={`Column ${idx + 1} average element length`} title="Average element length in bytes" />
        )}
      </span>
    );
  }
  return <span className="pr-param pr-fixed">{TYPES[col.type].len} B</span>;
}

function ColumnEditor({ columns, setColumns }) {
  const update = (id, patch) => setColumns(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= columns.length) return;
    const next = columns.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };
  return (
    <div className="pr-cols" role="table" aria-label="Columns">
      <div className="pr-col-row pr-col-head" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Size</span>
        <span role="columnheader" title="Percent of rows where this column is NULL">
          NULL %
        </span>
        <span role="columnheader" title="Estimate a btree index on this column">
          Idx
        </span>
        <span role="columnheader">
          <span className="pr-sr">Actions</span>
        </span>
      </div>
      {columns.map((c, i) => (
        <div className="pr-col-row" role="row" key={c.id}>
          <input className="pr-input" type="text" value={c.name} placeholder={`col${i + 1}`} onChange={(e) => update(c.id, { name: e.target.value })} aria-label={`Column ${i + 1} name`} />
          <select className="pr-input" value={c.type} onChange={(e) => update(c.id, { type: e.target.value })} aria-label={`Column ${i + 1} type`}>
            {Object.entries(TYPES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
          <TypeParams col={c} idx={i} update={(p) => update(c.id, p)} />
          <input className="pr-input" type="number" min="0" max="100" value={c.nullPct} onChange={(e) => update(c.id, { nullPct: e.target.value })} aria-label={`Column ${i + 1} percent NULL`} />
          <span className="pr-check">
            <input type="checkbox" id={`pr-idx-${c.id}`} checked={Boolean(c.indexed)} onChange={(e) => update(c.id, { indexed: e.target.checked })} />
            <label htmlFor={`pr-idx-${c.id}`} className="pr-sr">
              Index column {i + 1}
            </label>
          </span>
          <span className="pr-actions">
            <button type="button" className="pr-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move column ${i + 1} up`}>
              <i className="fa fa-arrow-up" aria-hidden="true"></i>
            </button>
            <button type="button" className="pr-icon" onClick={() => move(i, 1)} disabled={i === columns.length - 1} aria-label={`Move column ${i + 1} down`}>
              <i className="fa fa-arrow-down" aria-hidden="true"></i>
            </button>
            <button type="button" className="pr-icon" onClick={() => setColumns(columns.filter((x) => x.id !== c.id))} disabled={columns.length === 1} aria-label={`Remove column ${i + 1}`}>
              <i className="fa fa-times" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="pr-stat">
      <span className="pr-stat-label">{label}</span>
      <span className="pr-stat-value">{value}</span>
      {hint && <span className="pr-stat-hint">{hint}</span>}
    </div>
  );
}

/** Byte strip: one segment per column, padding hatched. Wide values are capped so the strip stays readable. */
function Strip({ layout, header, colorOf }) {
  const segs = [{ key: "hdr", label: "header", bytes: header, cls: "is-header" }];
  layout.rows.forEach((r, i) => {
    if (r.pad) segs.push({ key: `p${i}`, label: `${r.pad} B padding`, bytes: r.pad, cls: "is-pad" });
    segs.push({ key: `c${i}`, label: `${r.col.name || r.col.type}: ${r.size.len} B`, bytes: r.size.len, color: colorOf(r.col) });
  });
  if (layout.tail) segs.push({ key: "tail", label: `${layout.tail} B tail padding`, bytes: layout.tail, cls: "is-pad" });
  return (
    <div className="pr-strip" aria-hidden="true">
      {segs.map((s) => (
        <span key={s.key} className={`pr-seg ${s.cls ?? ""}`} style={{ flexGrow: Math.min(s.bytes, 24), background: s.color }} title={s.label} />
      ))}
    </div>
  );
}

function LayoutTable({ layout, toastedSet, colorOf }) {
  return (
    <div className="pr-table" role="table" aria-label="Column layout">
      <div className="pr-tr pr-th" role="row">
        <span role="columnheader">Column</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Align</span>
        <span role="columnheader">Offset</span>
        <span role="columnheader">Pad</span>
        <span role="columnheader">Bytes</span>
      </div>
      {layout.rows.map((r, i) => (
        <div className="pr-tr" role="row" key={r.col.id ?? i}>
          <span role="cell" className="pr-cname">
            <span className="pr-swatch" style={{ background: colorOf(r.col) }} aria-hidden="true" />
            {r.col.name || `col${i + 1}`}
          </span>
          <span role="cell" className="pr-ctype">
            {sqlType(r.col)}
            {toastedSet.has(r.col) && <span className="pr-tag">TOAST</span>}
            {r.size.varlena && !toastedSet.has(r.col) && <span className="pr-tag is-soft">{r.size.short ? "1-B hdr" : "4-B hdr"}</span>}
          </span>
          <span role="cell">{r.size.align}</span>
          <span role="cell">{r.offset}</span>
          <span role="cell" className={r.pad ? "pr-pad" : ""}>
            {r.pad || "·"}
          </span>
          <span role="cell">{r.size.len}</span>
        </div>
      ))}
      <div className="pr-tr pr-total" role="row">
        <span role="cell">Data (all present)</span>
        <span role="cell" />
        <span role="cell" />
        <span role="cell" />
        <span role="cell" className={layout.padding ? "pr-pad" : ""}>
          {layout.padding}
        </span>
        <span role="cell">
          {layout.data}
          {layout.tail ? ` +${layout.tail}` : ""}
        </span>
      </div>
    </div>
  );
}

export default function RowSize({ heading }) {
  const [state, setState, status] = useLocalStorage("rowsize:table", SAMPLE_TABLE);
  const [copied, copy] = useCopy();
  const setColumns = (columns) => setState({ ...state, columns });
  const set = (k) => (e) => setState({ ...state, [k]: e.target.value });

  const est = useMemo(() => estimate({ columns: state.columns, rowCount: state.rowCount, fillfactor: state.fillfactor }), [state]);
  const colorOf = useMemo(() => {
    const map = new Map(state.columns.map((c, i) => [c.id, PALETTE[i % PALETTE.length]]));
    return (c) => map.get(c.id) ?? "#999";
  }, [state.columns]);

  const indexes = useMemo(() => {
    if (est.error) return [];
    const picked = est.cols.filter((c) => c.indexed);
    const list = picked.map((c) => ({ name: c.name || c.type, cols: [c] }));
    if (picked.length > 1) list.push({ name: picked.map((c) => c.name || c.type).join(", "), cols: picked, composite: true });
    return list.map((ix) => ({ ...ix, est: estimateBtree(ix.cols, est.rows) }));
  }, [est]);

  const toastedSet = useMemo(() => new Set(est.error ? [] : est.cols.filter((_, i) => est.toasted[i])), [est]);
  const ddl = est.error ? "" : createTable(state.tableName, est.suggestion.cols, est.fillfactor);

  return (
    <div className="pg-rowsize">
      <div className="util-toolbar" role="toolbar" aria-label="Row and table size estimator">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => setState(SAMPLE_TABLE)}>
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            if (window.confirm("Clear all columns?")) setState(BLANK_TABLE);
          }}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="pr-main">
        <section className="pr-pane pr-editor" aria-label="Table definition">
          <h2 className="pr-h">Table</h2>
          <div className="pr-grid">
            <div className="pr-field">
              <label htmlFor="pr-name" className="pr-label">
                Name
              </label>
              <input id="pr-name" className="pr-input" type="text" value={state.tableName} onChange={set("tableName")} />
            </div>
            <div className="pr-field">
              <label htmlFor="pr-rows" className="pr-label">
                Rows
              </label>
              <input id="pr-rows" className="pr-input" type="number" min="0" value={state.rowCount} onChange={set("rowCount")} />
            </div>
            <div className="pr-field">
              <label htmlFor="pr-ff" className="pr-label">
                Fillfactor %
              </label>
              <input id="pr-ff" className="pr-input" type="number" min="10" max="100" value={state.fillfactor} onChange={set("fillfactor")} />
            </div>
          </div>
          <h3 className="pr-h3">Columns (declared order)</h3>
          <ColumnEditor columns={state.columns} setColumns={setColumns} />
          <button type="button" className="pr-chip pr-add" onClick={() => setColumns([...state.columns, newColumn(newId())])}>
            <i className="fa fa-plus" aria-hidden="true"></i> Add column
          </button>
          <p className="pr-hint">
            Size: average stored bytes for text/bytea/jsonb (UTF-8 bytes, not characters). Values under 127 bytes get a 1-byte header and no alignment; larger ones a
            4-byte header aligned like the type. Idx estimates a btree on that column.
          </p>
        </section>

        <section className="pr-pane pr-results" aria-label="Estimate">
          {est.error ? (
            <p className="pr-error" role="alert">
              {est.error}
            </p>
          ) : (
            <>
              <h2 className="pr-h">Estimate</h2>
              <div className="pr-stats">
                <Stat label="Avg row on page" value={`${fmtN(est.tuple, 1)} B`} hint={`+4 B line pointer · max ${est.maxTuple} B`} />
                <Stat label="Tuple header" value={`${fmtN(est.header, 1)} B`} hint={`${est.headerNoNull} B, or ${est.headerNull} B with a NULL (${fmtN(est.pAnyNull * 100, 0)}% of rows)`} />
                <Stat label="Rows per 8kB page" value={fmtN(est.rowsPerPage)} hint={`fillfactor ${est.fillfactor}%`} />
                <Stat label="Heap size" value={fmtBytes(est.heapBytes)} hint={`${fmtN(est.heapPages)} pages for ${fmtN(est.rows)} rows`} />
                {est.toastPages > 0 && <Stat label="TOAST (uncompressed)" value={fmtBytes(est.toastBytes)} hint={`${fmtN(est.toastPages)} pages`} />}
                <Stat label="Alignment padding" value={`${fmtN(est.expected.padding + est.expected.tail, 1)} B/row`} hint={`${fmtN(((est.expected.padding + est.expected.tail) / est.tuple) * 100, 0)}% of each row`} />
              </div>

              {est.warnings.length > 0 && (
                <ul className="pr-warnings">
                  {est.warnings.map((w) => (
                    <li key={w}>
                      <i className="fa fa-exclamation-triangle" aria-hidden="true"></i> {w}
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="pr-h3">Declared order</h3>
              <Strip layout={est.full} header={est.headerNoNull} colorOf={colorOf} />
              <LayoutTable layout={est.full} toastedSet={toastedSet} colorOf={colorOf} />

              <h3 className="pr-h3">Suggested order</h3>
              {est.suggestion.better ? (
                <p className="pr-good">
                  <i className="fa fa-check-circle" aria-hidden="true"></i> Saves {fmtN(est.suggestion.savesBytes, 1)} B per row ({fmtN((est.suggestion.savesBytes / est.tuple) * 100, 1)}%): heap{" "}
                  {fmtBytes(est.heapBytes)} → {fmtBytes(est.suggestion.heapBytes)}, {fmtN(est.rowsPerPage)} → {fmtN(est.suggestion.rowsPerPage)} rows/page.
                </p>
              ) : (
                <p className="pr-hint">The declared order already has no avoidable padding.</p>
              )}
              {est.suggestion.better && (
                <>
                  <Strip layout={est.suggestion.full} header={est.headerNoNull} colorOf={colorOf} />
                  <div className="pr-code-wrap">
                    <pre className="pr-code" tabIndex={0} aria-label="CREATE TABLE in suggested order">
                      {ddl}
                    </pre>
                    <button type="button" className="pr-copy" onClick={() => copy("ddl", ddl)} aria-label="Copy CREATE TABLE">
                      <i className={`fa ${copied === "ddl" ? "fa-check" : "fa-clipboard"}`} aria-hidden="true"></i>
                    </button>
                  </div>
                  <p className="pr-hint">Fixed-width columns from 8-byte to 1-byte alignment, then variable-length ones. Reordering an existing table means rewriting it.</p>
                </>
              )}

              <h3 className="pr-h3">Btree indexes</h3>
              {indexes.length === 0 ? (
                <p className="pr-hint">Tick Idx on a column to estimate its index.</p>
              ) : (
                <div className="pr-table" role="table" aria-label="Index estimates">
                  <div className="pr-tr pr-ix pr-th" role="row">
                    <span role="columnheader">Index on</span>
                    <span role="columnheader">Tuple</span>
                    <span role="columnheader">Per leaf</span>
                    <span role="columnheader">Levels</span>
                    <span role="columnheader">Size</span>
                  </div>
                  {indexes.map((ix) => (
                    <div className="pr-tr pr-ix" role="row" key={ix.name + (ix.composite ? "*" : "")}>
                      <span role="cell" className="pr-cname">
                        ({ix.name}){ix.composite && <span className="pr-tag is-soft">composite</span>}
                      </span>
                      <span role="cell">{fmtN(ix.est.tuple, 1)} B</span>
                      <span role="cell">{fmtN(ix.est.leafPerPage)}</span>
                      <span role="cell">{ix.est.levels}</span>
                      <span role="cell">{fmtBytes(ix.est.bytes)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="pr-hint">
                Leaf pages at the default fillfactor 90 and unique-ish keys. PG13+ deduplication makes indexes on repeated values smaller; bloat makes real ones bigger.
              </p>
              <p className="pr-hint">
                Rows over ~{fmtN(TOAST_THRESHOLD)} B trigger TOAST: values are compressed, then moved to the TOAST table in ~2kB chunks. Heap size excludes the free space and
                visibility maps.
              </p>
            </>
          )}
        </section>
      </div>

      <div className="util-statusbar">
        <span>{est.error ? "No columns" : `${est.natts} columns · ${fmtN(est.tuple, 1)} B/row · ${fmtBytes(est.heapBytes)} heap`}</span>
        <span>Calculated locally, nothing is uploaded.</span>
        {copied === "error" && <span className="pr-copy-error">Copy failed: select the text and copy manually.</span>}
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
