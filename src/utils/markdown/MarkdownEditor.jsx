import { useDeferredValue, useMemo, useState } from "react";
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

export default function MarkdownEditor() {
  const [doc, setDoc, status] = useLocalStorage("markdown:doc", SAMPLE, { debounceMs: 400 });
  const [view, setView] = useLocalStorage("markdown:view", "split");
  const [copied, setCopied] = useState(false);

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

      <div className="md-panes">
        <div className="md-pane md-input">
          <label htmlFor="md-text" className="visually-hidden">
            Markdown source
          </label>
          <textarea
            id="md-text"
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            spellCheck={false}
            placeholder="# Start writing…"
          />
        </div>
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
