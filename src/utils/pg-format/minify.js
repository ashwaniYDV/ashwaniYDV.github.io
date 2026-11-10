/**
 * SQL minifier built on the PGUtils tokenizer: drops comments and collapses
 * whitespace, keeping a space only where removing it would change how
 * PostgreSQL lexes the text. Strings, quoted identifiers and dollar-quoted
 * bodies are copied verbatim. Each statement ends up on its own line.
 */
import { tokenize } from "../pg-fingerprint/tokenize.js";

const WORDISH = /[A-Za-z0-9_$\u0080-\uffff'"]/;

function needsSpace(a, b, hadNewline) {
  if (!a) return "";
  // 'a'<newline>'b' is string continuation; a plain space would be a syntax error.
  if (a.type === "string" && b.type === "string" && b.kind === "") return hadNewline ? "\n" : " ";
  const last = a.text[a.text.length - 1];
  const first = b.text[0];
  if (WORDISH.test(last) && WORDISH.test(first)) return " ";
  // Two operators side by side would merge into a different operator.
  if (a.type === "op" && b.type === "op") return " ";
  // 1 .5 or x. 5: keep numbers apart from dots.
  if ((a.type === "number" && first === ".") || (last === "." && b.type === "number")) return " ";
  // A number followed by a word char is fine to join only for punctuation; keep 1e5 vs 1 e5 distinct.
  if (a.type === "number" && /[A-Za-z_]/.test(first)) return " ";
  // ':' then ':' would form a cast.
  if (last === ":" && first === ":") return " ";
  return "";
}

export function minifySql(sql) {
  const lines = [];
  let line = "";
  let prev = null;
  let newline = false;
  for (const t of tokenize(sql)) {
    if (t.type === "ws" || t.type === "comment") {
      if (t.text.includes("\n")) newline = true;
      continue;
    }
    if (t.type === "punct" && t.text === ";") {
      lines.push(`${line};`);
      line = "";
      prev = null;
      newline = false;
      continue;
    }
    line += needsSpace(prev, t, newline) + t.text;
    prev = t;
    newline = false;
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
}
