/** highlight.js core with only the SQL grammars registered (keeps the tool chunks small). */
import hljs from "highlight.js/lib/core";
import pgsql from "highlight.js/lib/languages/pgsql";
import sql from "highlight.js/lib/languages/sql";

if (!hljs.getLanguage("pgsql")) hljs.registerLanguage("pgsql", pgsql);
if (!hljs.getLanguage("sql")) hljs.registerLanguage("sql", sql);

/** HTML for highlighted PostgreSQL (hljs escapes the input). */
export const highlightSql = (code) => hljs.highlight(code, { language: "pgsql", ignoreIllegals: true }).value;

/** Copy text to the clipboard; resolves true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
