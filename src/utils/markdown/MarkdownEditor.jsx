import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import pgsql from "highlight.js/lib/languages/pgsql";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { markedHighlight } from "marked-highlight";
import { download, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";

// Only the languages registered here are bundled (the full set is ~1 MB).
Object.entries({ bash, c, cpp, css, go, java, javascript, json, pgsql, python, sql, typescript, xml, yaml }).forEach(
  ([name, lang]) => hljs.registerLanguage(name, lang),
);
hljs.registerAliases(["sh", "shell"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["html"], { languageName: "xml" });
hljs.registerAliases(["postgres", "postgresql", "plpgsql"], { languageName: "pgsql" });

const marked = new Marked(
  { gfm: true, breaks: false },
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
    },
  }),
);

// Preview HTML comes from whatever is typed or pasted, so it is always sanitized.
// External links open in a new tab.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")?.startsWith("http")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const SAMPLE = `# Markdown editor

Type on the left, see the result on the right. Your document is **saved automatically** in this browser.

## Formatting

*Italic*, **bold**, \`inline code\`, ~~strikethrough~~ and [links](https://github.com/ashwaniYDV).

- [x] Task lists
- [ ] Tables, quotes and code blocks

> Two roads diverged in a wood.

| Isolation level   | Dirty read | Phantom read |
|-------------------|:----------:|:------------:|
| Read committed    | No         | Possible     |
| Repeatable read   | No         | No (in PG)   |
| Serializable      | No         | No           |

\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, sum(l.amount)
FROM orders o JOIN line_items l ON l.order_id = o.id
WHERE o.created_at > now() - interval '7 days'
GROUP BY o.id;
\`\`\`
`;

const VIEWS = [
  { id: "write", label: "Write", icon: "fa-pencil" },
  { id: "split", label: "Split", icon: "fa-columns" },
  { id: "preview", label: "Preview", icon: "fa-eye" },
];

const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;

export default function MarkdownEditor({ heading }) {
  const [doc, setDoc, status] = useLocalStorage("markdown:doc", SAMPLE, { debounceMs: 400 });
  const [view, setView] = useLocalStorage("markdown:view", "split");
  // Share of the width given to the source pane in split view (0.2 – 0.8).
  const [split, setSplit] = useLocalStorage("markdown:split", 0.5);
  const [dragging, setDragging] = useState(false); // drives the drag styling
  const draggingRef = useRef(false); // read by handlers, so no move is lost before a re-render
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef(null);
  const panesRef = useRef(null);

  const clampSplit = (r) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, r));
  const ratio = clampSplit(Number(split) || 0.5);

  const splitAt = (clientX) => {
    const rect = panesRef.current?.getBoundingClientRect();
    if (rect?.width) setSplit(Math.round(clampSplit((clientX - rect.left) / rect.width) * 1000) / 1000);
  };

  const onDividerPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves outside the handle
    } catch {
      /* pointer already gone; the drag still works while over the handle */
    }
    draggingRef.current = true;
    setDragging(true);
  };
  const onDividerPointerMove = (e) => {
    if (draggingRef.current) splitAt(e.clientX);
  };
  const endDrag = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    setDragging(false);
  };
  const onDividerKeyDown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const next = { ArrowLeft: ratio - step, ArrowRight: ratio + step, Home: MIN_SPLIT, End: MAX_SPLIT }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setSplit(Math.round(clampSplit(next) * 1000) / 1000);
  };

  // The page scrolls as a whole, so the textarea grows to fit its content
  // instead of scrolling inside itself. CSS min-height keeps short docs full-screen.
  const fitTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`; // +2: borders
  };
  useLayoutEffect(fitTextarea, [doc, view]);
  useEffect(() => {
    // Re-wrap on width changes (window resize, split <-> write).
    const el = textareaRef.current;
    if (!el) return undefined;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        fitTextarea();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep typing responsive on long documents: render the preview at lower priority.
  const deferredDoc = useDeferredValue(doc);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(deferredDoc)), [deferredDoc]);

  const words = doc.trim() ? doc.trim().split(/\s+/).length : 0;
  const title = doc.match(/^#\s+(.+)$/m)?.[1]?.trim() || "document";

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("Copy failed. Your browser blocked clipboard access.");
    }
  };

  return (
    <div className={`md-editor view-${view}`}>
      <div className="util-toolbar" role="toolbar" aria-label="Markdown editor">
        {heading}
        <div className="util-segmented" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={view === v.id ? "button small is-active" : "button small"}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              <i className={`fa ${v.icon}`} aria-hidden="true"></i>&nbsp;{v.label}
            </button>
          ))}
        </div>
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={() => download(`${title}.md`, doc, "text/markdown")}>
          <i className="fa fa-download" aria-hidden="true"></i>&nbsp;.md
        </button>
        <button type="button" className="button small" onClick={copyHtml}>
          <i className={copied ? "fa fa-check" : "fa fa-code"} aria-hidden="true"></i>&nbsp;{copied ? "Copied" : "Copy HTML"}
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => window.confirm("Replace your document with the sample?") && setDoc(SAMPLE)}
        >
          <i className="fa fa-undo" aria-hidden="true"></i>&nbsp;Sample
        </button>
      </div>

      <div
        ref={panesRef}
        className={dragging ? "md-panes is-dragging" : "md-panes"}
        style={{ "--md-left": `${ratio}fr`, "--md-right": `${1 - ratio}fr` }}
      >
        <div className="md-pane md-input">
          <label htmlFor="md-text" className="visually-hidden">
            Markdown source
          </label>
          <textarea
            ref={textareaRef}
            id="md-text"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            spellCheck={false}
            placeholder="# Start writing…"
          />
        </div>
        <div
          className="md-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and preview"
          aria-controls="md-text"
          aria-valuemin={MIN_SPLIT * 100}
          aria-valuemax={MAX_SPLIT * 100}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setSplit(0.5)}
          onKeyDown={onDividerKeyDown}
        />
        {/* Sanitized with DOMPurify above. */}
        <div className="md-pane md-preview post-body" aria-label="Preview" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      <div className="util-statusbar">
        <span>
          {words} words · {doc.length} characters
        </span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
