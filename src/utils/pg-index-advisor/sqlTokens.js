/**
 * A small SQL tokenizer and expression helpers. Not a parser: just enough to
 * pull table references, predicates and ORDER BY columns out of typical
 * queries and out of EXPLAIN's Filter / Index Cond / Sort Key strings.
 */

/** Words that are never column names in the places we look for columns. */
export const KEYWORDS = new Set(
  (
    "select from where and or not in is null true false like ilike similar between join inner left right full outer cross " +
    "natural on using as group by order having limit offset fetch first next rows row only with recursive union all intersect " +
    "except distinct case when then else end asc desc nulls last for update delete insert into values set returning lateral " +
    "exists any some current_date current_timestamp current_time current_user session_user localtime localtimestamp escape " +
    "window over partition materialized default collate array unknown share nowait skip locked of no key to"
  ).split(" "),
);

const MULTI_OPS = ["!~~*", "->>", "#>>", "!~~", "~~*", "::", "<=", ">=", "<>", "!=", "->", "#>", "||", "@>", "<@", "~~", "&&", "!~"];
const SINGLE_OPS = "=<>+-*/%^~!@#&|";
const PUNCT = "(),;.[]";

/** Tokens: { t: "ident"|"string"|"number"|"param"|"op"|"punct", v, raw, quoted? }. Identifiers are lower-cased unless quoted. */
export function tokenize(sql) {
  const s = sql ?? "";
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "-" && s[i + 1] === "-") {
      const j = s.indexOf("\n", i);
      i = j === -1 ? s.length : j;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2);
      i = j === -1 ? s.length : j + 2;
      continue;
    }
    // 'text', E'text' (backslash escapes)
    if (ch === "'" || ((ch === "E" || ch === "e") && s[i + 1] === "'")) {
      const escapes = ch !== "'";
      let j = escapes ? i + 2 : i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            v += "'";
            j += 2;
            continue;
          }
          break;
        }
        if (escapes && s[j] === "\\") {
          v += s[j + 1] ?? "";
          j += 2;
          continue;
        }
        v += s[j++];
      }
      out.push({ t: "string", v, raw: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "$") {
      const p = /^\$\d+/.exec(s.slice(i, i + 12));
      if (p) {
        out.push({ t: "param", v: p[0], raw: p[0] });
        i += p[0].length;
        continue;
      }
      const d = /^\$([A-Za-z_]\w*)?\$/.exec(s.slice(i, i + 64));
      if (d) {
        const end = s.indexOf(d[0], i + d[0].length);
        const stop = end === -1 ? s.length : end;
        out.push({ t: "string", v: s.slice(i + d[0].length, stop), raw: s.slice(i, stop + d[0].length) });
        i = stop + d[0].length;
        continue;
      }
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j++];
      }
      out.push({ t: "ident", v, quoted: true, raw: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(s[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i, i + 64));
      out.push({ t: "number", v: m[0], raw: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_\u0080-\uffff]/.test(ch)) {
      const m = /^[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*/.exec(s.slice(i, i + 128));
      out.push({ t: "ident", v: m[0].toLowerCase(), raw: m[0] });
      i += m[0].length;
      continue;
    }
    const op = MULTI_OPS.find((o) => s.startsWith(o, i));
    if (op) {
      out.push({ t: "op", v: op, raw: op });
      i += op.length;
      continue;
    }
    if (PUNCT.includes(ch)) {
      out.push({ t: "punct", v: ch, raw: ch });
      i++;
      continue;
    }
    if (ch === "?") {
      out.push({ t: "param", v: "?", raw: "?" });
      i++;
      continue;
    }
    if (SINGLE_OPS.includes(ch)) out.push({ t: "op", v: ch, raw: ch });
    i++;
  }
  return out;
}

export const is = (tok, t, v) => Boolean(tok) && tok.t === t && (v === undefined || tok.v === v);
export const isKw = (tok, ...words) => Boolean(tok) && tok.t === "ident" && !tok.quoted && words.includes(tok.v);
const isOpen = (tok) => is(tok, "punct", "(");
const isClose = (tok) => is(tok, "punct", ")");

const TYPE_TAILS = {
  timestamp: [["with", "time", "zone"], ["without", "time", "zone"]],
  time: [["with", "time", "zone"], ["without", "time", "zone"]],
  character: [["varying"]],
  double: [["precision"]],
  bit: [["varying"]],
};

/** Drop `::type` casts (EXPLAIN adds them everywhere: 'x'::text, now() - '7 days'::interval). */
export function stripCasts(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!is(tokens[i], "op", "::")) {
      out.push(tokens[i]);
      continue;
    }
    let j = i + 1;
    if (tokens[j]?.t !== "ident") continue;
    const base = tokens[j].v;
    j++;
    while (is(tokens[j], "punct", ".") && tokens[j + 1]?.t === "ident") j += 2;
    for (const tail of TYPE_TAILS[base] ?? []) {
      if (tail.every((w, k) => isKw(tokens[j + k], w) || tokens[j + k]?.v === w)) {
        j += tail.length;
        break;
      }
    }
    if (isOpen(tokens[j])) j = matchParen(tokens, j) + 1;
    while (is(tokens[j], "punct", "[") && is(tokens[j + 1], "punct", "]")) j += 2;
    i = j - 1;
  }
  return out;
}

/** Index of the bracket closing the one at `i` (or the last index if unbalanced). */
export function matchParen(tokens, i) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    if (isOpen(tokens[j])) depth++;
    else if (isClose(tokens[j])) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return tokens.length - 1;
}

export function stripOuter(tokens) {
  let t = tokens;
  while (t.length >= 2 && isOpen(t[0]) && matchParen(t, 0) === t.length - 1) t = t.slice(1, -1);
  return t;
}

/** Split at depth-0 tokens for which `test(tok, index)` is true. */
export function splitTop(tokens, test) {
  const parts = [[]];
  let depth = 0;
  tokens.forEach((tok, i) => {
    if (isOpen(tok)) depth++;
    else if (isClose(tok)) depth--;
    if (depth === 0 && test(tok, i)) parts.push([]);
    else parts[parts.length - 1].push(tok);
  });
  return parts.filter((p) => p.length);
}

export function hasTop(tokens, test) {
  let depth = 0;
  return tokens.some((tok) => {
    if (isOpen(tok)) depth++;
    else if (isClose(tok)) depth--;
    return depth === 0 && test(tok);
  });
}

/** Top-level AND conjuncts, recursing into parenthesised groups. BETWEEN x AND y stays together. */
export function conjuncts(tokens) {
  const t = stripOuter(tokens);
  const parts = [[]];
  let depth = 0;
  let between = false;
  for (const tok of t) {
    if (isOpen(tok)) depth++;
    else if (isClose(tok)) depth--;
    if (depth === 0 && isKw(tok, "between")) between = true;
    if (depth === 0 && isKw(tok, "and")) {
      if (between) between = false;
      else {
        parts.push([]);
        continue;
      }
    }
    parts[parts.length - 1].push(tok);
  }
  const nonEmpty = parts.filter((p) => p.length);
  if (nonEmpty.length <= 1) return nonEmpty;
  return nonEmpty.flatMap(conjuncts);
}

/** Render tokens back to compact SQL text. */
export function render(tokens) {
  let out = "";
  tokens.forEach((tok, i) => {
    const prev = tokens[i - 1];
    const tight =
      i === 0 ||
      is(tok, "punct", ")") ||
      is(tok, "punct", ",") ||
      is(tok, "punct", ".") ||
      is(tok, "punct", "]") ||
      is(prev, "punct", "(") ||
      is(prev, "punct", ".") ||
      is(prev, "punct", "[") ||
      (is(tok, "punct", "(") && prev?.t === "ident" && !KEYWORDS.has(prev.v)) ||
      (is(tok, "punct", "[") && prev && prev.t !== "op");
    const raw = tok.t === "ident" ? (tok.quoted ? tok.raw : tok.v) : tok.t === "string" ? `'${tok.v.replace(/'/g, "''")}'` : tok.raw;
    out += (tight ? "" : " ") + raw;
  });
  return out;
}

/**
 * Column reference at `i`: ident(.ident)* not followed by "(" (function) or a string (typed literal like interval '1 day').
 * Returns { parts, end } (end exclusive) or null.
 */
export function colrefAt(tokens, i) {
  const tok = tokens[i];
  if (tok?.t !== "ident" || (!tok.quoted && KEYWORDS.has(tok.v))) return null;
  const parts = [tok.quoted ? tok.v : tok.v];
  const quoted = [Boolean(tok.quoted)];
  let j = i + 1;
  while (is(tokens[j], "punct", ".") && tokens[j + 1]?.t === "ident") {
    parts.push(tokens[j + 1].v);
    quoted.push(Boolean(tokens[j + 1].quoted));
    j += 2;
  }
  if (is(tokens[j], "punct", ".") && is(tokens[j + 1], "op", "*")) return null; // alias.*
  if (isOpen(tokens[j]) || tokens[j]?.t === "string") return null;
  if (is(tokens[i - 1], "punct", ".")) return null;
  return { parts, quoted, end: j };
}

/** Every column reference in `tokens` (skipping function names and keywords). */
export function colrefs(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const ref = colrefAt(tokens, i);
    if (ref) {
      out.push(ref);
      i = ref.end - 1;
    }
  }
  return out;
}
