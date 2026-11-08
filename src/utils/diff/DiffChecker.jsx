import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { createTwoFilesPatch, diffArrays, diffWordsWithSpace } from "diff";
import { download, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";

const CONTEXT_LINES = 3;
const DIFF_TIMEOUT_MS = 2000; // give up on pathological inputs instead of freezing the tab

const SAMPLE_ORIGINAL = `SELECT o.id, o.created_at, sum(l.amount) AS total
FROM orders o
JOIN line_items l ON l.order_id = o.id
WHERE o.created_at > now() - interval '7 days'
GROUP BY o.id
ORDER BY total DESC
LIMIT 10;`;

const SAMPLE_CHANGED = `SELECT o.id, o.customer_id, o.created_at, sum(l.amount) AS total
FROM orders o
JOIN line_items l ON l.order_id = o.id
WHERE o.created_at > now() - interval '30 days'
  AND o.status = 'paid'
GROUP BY o.id
ORDER BY total DESC
LIMIT 25;`;

const toLines = (text) => (text === "" ? [] : text.replace(/\r\n?/g, "\n").split("\n"));

/**
 * Line-level diff, then word-level diff inside lines that changed.
 * Rows: { type: "equal" | "del" | "add" | "mod", left?, right?, words? }
 * where left/right are { n: lineNumber, text }.
 */
function computeRows(original, changed, { ignoreWhitespace, ignoreCase }) {
  const a = toLines(original);
  const b = toLines(changed);
  const norm = (line) => {
    let s = ignoreWhitespace ? line.trim().replace(/\s+/g, " ") : line;
    if (ignoreCase) s = s.toLowerCase();
    return s;
  };
  const parts = diffArrays(a, b, { comparator: (x, y) => norm(x) === norm(y), timeout: DIFF_TIMEOUT_MS });
  if (!parts) return null; // timed out

  const rows = [];
  let i = 0; // index into a
  let j = 0; // index into b
  const take = (from, start, count) => from.slice(start, start + count);

  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const count = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      for (let x = 0; x < count; x++) {
        rows.push({ type: "equal", left: { n: i + x + 1, text: a[i + x] }, right: { n: j + x + 1, text: b[j + x] } });
      }
      i += count;
      j += count;
    } else if (part.removed) {
      const removed = take(a, i, count);
      const next = parts[k + 1];
      const added = next?.added ? take(b, j, next.count ?? next.value.length) : [];
      if (next?.added) k += 1;
      // Pair removed/added lines up as "modified" rows; extras are plain del/add.
      const paired = Math.min(removed.length, added.length);
      for (let x = 0; x < Math.max(removed.length, added.length); x++) {
        if (x < paired) {
          rows.push({
            type: "mod",
            left: { n: i + x + 1, text: removed[x] },
            right: { n: j + x + 1, text: added[x] },
            words: diffWordsWithSpace(removed[x], added[x], { ignoreCase }),
          });
        } else if (x < removed.length) {
          rows.push({ type: "del", left: { n: i + x + 1, text: removed[x] } });
        } else {
          rows.push({ type: "add", right: { n: j + x + 1, text: added[x] } });
        }
      }
      i += removed.length;
      j += added.length;
    } else {
      // Added block with no preceding removal.
      take(b, j, count).forEach((text, x) => rows.push({ type: "add", right: { n: j + x + 1, text } }));
      j += count;
    }
  }
  return rows;
}

/** Replace long unchanged runs with a single "N unchanged lines" marker. */
function collapse(rows) {
  const out = [];
  let run = [];
  const flush = (atStart, atEnd) => {
    const keepHead = atStart ? 0 : CONTEXT_LINES;
    const keepTail = atEnd ? 0 : CONTEXT_LINES;
    if (run.length > keepHead + keepTail + 1) {
      out.push(...run.slice(0, keepHead));
      out.push({ type: "skip", count: run.length - keepHead - keepTail });
      out.push(...run.slice(run.length - keepTail));
    } else {
      out.push(...run);
    }
    run = [];
  };
  rows.forEach((row) => {
    if (row.type === "equal") run.push(row);
    else {
      flush(out.length === 0, false);
      out.push(row);
    }
  });
  flush(out.length === 0, true);
  return out;
}

/** Text of one side of a modified line, with the changed words highlighted. */
function WordDiff({ words, side }) {
  return words.map((w, i) => {
    if (side === "left" && w.added) return null;
    if (side === "right" && w.removed) return null;
    if (w.added || w.removed) {
      return (
        <mark key={i} className={w.added ? "dw-add" : "dw-del"}>
          {w.value}
        </mark>
      );
    }
    return <Fragment key={i}>{w.value}</Fragment>;
  });
}

const Num = ({ n }) => <span className="d-num">{n ?? ""}</span>;
const Code = ({ children, className = "" }) => <span className={`d-code ${className}`}>{children}</span>;

function SplitView({ rows }) {
  return (
    <div className="diff-grid diff-split" role="table" aria-label="Side-by-side diff">
      {rows.map((row, idx) => {
        if (row.type === "skip") {
          return (
            <div key={idx} className="d-row d-skip" role="row">
              ⋯ {row.count} unchanged {row.count === 1 ? "line" : "lines"}
            </div>
          );
        }
        const leftCls = row.type === "del" || row.type === "mod" ? "is-del" : row.type === "add" ? "is-empty" : "";
        const rightCls = row.type === "add" || row.type === "mod" ? "is-add" : row.type === "del" ? "is-empty" : "";
        return (
          <div key={idx} className="d-row" role="row">
            <Num n={row.left?.n} />
            <Code className={leftCls}>{row.type === "mod" ? <WordDiff words={row.words} side="left" /> : row.left?.text}</Code>
            <Num n={row.right?.n} />
            <Code className={rightCls}>{row.type === "mod" ? <WordDiff words={row.words} side="right" /> : row.right?.text}</Code>
          </div>
        );
      })}
    </div>
  );
}

function UnifiedView({ rows }) {
  const lines = [];
  rows.forEach((row, idx) => {
    if (row.type === "skip") {
      lines.push(
        <div key={idx} className="d-row d-skip" role="row">
          ⋯ {row.count} unchanged {row.count === 1 ? "line" : "lines"}
        </div>,
      );
      return;
    }
    const line = (key, l, r, sign, cls, content) => (
      <div key={key} className="d-row" role="row">
        <Num n={l} />
        <Num n={r} />
        <span className={`d-sign ${cls}`}>{sign}</span>
        <Code className={cls}>{content}</Code>
      </div>
    );
    if (row.type === "equal") lines.push(line(idx, row.left.n, row.right.n, " ", "", row.left.text));
    if (row.type === "del" || row.type === "mod") {
      lines.push(line(`${idx}-`, row.left.n, null, "−", "is-del", row.type === "mod" ? <WordDiff words={row.words} side="left" /> : row.left.text));
    }
    if (row.type === "add" || row.type === "mod") {
      lines.push(line(`${idx}+`, null, row.right.n, "+", "is-add", row.type === "mod" ? <WordDiff words={row.words} side="right" /> : row.right.text));
    }
  });
  return (
    <div className="diff-grid diff-unified" role="table" aria-label="Unified diff">
      {lines}
    </div>
  );
}

export default function DiffChecker({ heading }) {
  const [inputs, setInputs, status] = useLocalStorage("diff:inputs", { original: SAMPLE_ORIGINAL, changed: SAMPLE_CHANGED });
  const [options, setOptions] = useLocalStorage("diff:options", {
    view: "split",
    ignoreWhitespace: false,
    ignoreCase: false,
    hideUnchanged: false,
  });
  const [copied, setCopied] = useState(false);

  const original = useDeferredValue(inputs.original);
  const changed = useDeferredValue(inputs.changed);
  const { ignoreWhitespace, ignoreCase } = options;

  const rows = useMemo(
    () => computeRows(original, changed, { ignoreWhitespace, ignoreCase }),
    [original, changed, ignoreWhitespace, ignoreCase],
  );

  const stats = useMemo(() => {
    if (!rows) return null;
    let added = 0;
    let removed = 0;
    rows.forEach((r) => {
      if (r.type === "add" || r.type === "mod") added += 1;
      if (r.type === "del" || r.type === "mod") removed += 1;
    });
    return { added, removed };
  }, [rows]);

  const shown = rows && options.hideUnchanged ? collapse(rows) : rows;
  const setOpt = (key, value) => setOptions({ ...options, [key]: value });
  const patch = () => createTwoFilesPatch("original", "changed", inputs.original, inputs.changed, "", "", { context: CONTEXT_LINES });

  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(patch());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("Copy failed. Your browser blocked clipboard access.");
    }
  };

  const checkbox = (key, label) => (
    <label className="diff-option">
      <input type="checkbox" checked={options[key]} onChange={(e) => setOpt(key, e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  const identical = stats && stats.added === 0 && stats.removed === 0;

  return (
    <div className="diff-checker">
      <div className="util-toolbar" role="toolbar" aria-label="Diff checker">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {[
            { id: "split", label: "Split", icon: "fa-columns" },
            { id: "unified", label: "Unified", icon: "fa-align-left" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              className={options.view === v.id ? "button small is-active" : "button small"}
              aria-pressed={options.view === v.id}
              onClick={() => setOpt("view", v.id)}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        {checkbox("ignoreWhitespace", "Ignore whitespace")}
        {checkbox("ignoreCase", "Ignore case")}
        {checkbox("hideUnchanged", "Hide unchanged")}
        <span className="util-toolbar-spacer" />
        <button
          type="button"
          className="button small"
          onClick={() => setInputs({ original: inputs.changed, changed: inputs.original })}
          title="Swap original and changed"
        >
          <i className="fa fa-exchange" aria-hidden="true"></i>&nbsp;Swap
        </button>
        <button type="button" className="button small" onClick={copyPatch}>
          <i className={copied ? "fa fa-check" : "fa fa-clipboard"} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : "Copy patch"}
        </button>
        <button type="button" className="button small" onClick={() => download("changes.diff", patch(), "text/x-diff")}>
          <i className="fa fa-download" aria-hidden="true"></i>&nbsp;.diff
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => setInputs({ original: SAMPLE_ORIGINAL, changed: SAMPLE_CHANGED })}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => (inputs.original || inputs.changed) && window.confirm("Clear both texts?") && setInputs({ original: "", changed: "" })}
        >
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Clear
        </button>
      </div>

      <div className="diff-inputs">
        <label className="diff-input">
          <span className="diff-input-label">Original</span>
          <textarea
            value={inputs.original}
            onChange={(e) => setInputs({ ...inputs, original: e.target.value })}
            spellCheck={false}
            placeholder="Paste the original text…"
          />
        </label>
        <label className="diff-input">
          <span className="diff-input-label">Changed</span>
          <textarea
            value={inputs.changed}
            onChange={(e) => setInputs({ ...inputs, changed: e.target.value })}
            spellCheck={false}
            placeholder="Paste the changed text…"
          />
        </label>
      </div>

      <section className="diff-result" aria-live="polite">
        <header className="diff-result-header">
          <h2>Differences</h2>
          {stats && !identical && (
            <span className="diff-stats">
              <span className="diff-stat-add">+{stats.added}</span>
              <span className="diff-stat-del">−{stats.removed}</span>
              <span>
                {stats.added + stats.removed} {stats.added + stats.removed === 1 ? "line" : "lines"} changed
              </span>
            </span>
          )}
        </header>
        {!rows && <p className="diff-empty">These texts are too different to compare quickly. Try smaller inputs.</p>}
        {rows && rows.length === 0 && <p className="diff-empty">Paste text into both boxes to compare.</p>}
        {rows && rows.length > 0 && identical && (
          <p className="diff-empty">
            <i className="fa fa-check-circle" aria-hidden="true"></i>&nbsp;No differences
            {ignoreWhitespace || ignoreCase ? " (with the current ignore options)" : ""}.
          </p>
        )}
        {shown && shown.length > 0 && !identical && (options.view === "split" ? <SplitView rows={shown} /> : <UnifiedView rows={shown} />)}
      </section>

      <div className="util-statusbar">
        <span>
          Original {toLines(inputs.original).length} lines · Changed {toLines(inputs.changed).length} lines
        </span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
