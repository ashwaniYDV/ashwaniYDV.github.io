/**
 * A small PostgreSQL lexer, close to the rules in src/backend/parser/scan.l.
 *
 * It does not parse SQL. It only splits text into tokens precisely enough to
 * find constants, comments and statement boundaries without being fooled by
 * quotes, dollar-quoting or nested comments. Every input character belongs to
 * exactly one token, so joining `text` of all tokens gives back the input.
 *
 * Token types:
 *   ws       whitespace
 *   comment  -- line comment or nested /* block comment *\/
 *   string   '...', E'...', B'...', X'...', N'...', U&'...'
 *   dollar   $$...$$ or $tag$...$tag$ (a string constant)
 *   qident   "quoted identifier" or U&"..."
 *   ident    identifier or keyword (unquoted)
 *   number   integer / decimal / exponent / 0x 0o 0b, with _ separators
 *   param    $1, $2, ...
 *   cast     ::
 *   op       operator (+ - * / < > = ~ ! @ # % ^ & | ` ?)
 *   punct    ( ) [ ] , ; . :
 *   unknown  anything else (a lone $, a backslash, ...)
 */

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_CONT = /[A-Za-z0-9_$\u0080-\uffff]/;
const OP_CHARS = "+-*/<>=~!@#%^&|`?";
const OP_SPECIAL = "~!@#%^&|`?";
const NUMBER_RE =
  /^(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.(?!\.)[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/;
const DOLLAR_TAG_RE = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

/** Read a '...' body starting at the opening quote. Returns the end index (exclusive). */
function readQuoted(sql, quoteAt, backslashEscapes) {
  let i = quoteAt + 1;
  while (i < sql.length) {
    const ch = sql[i];
    if (backslashEscapes && ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "'") {
      if (sql[i + 1] === "'") {
        i += 2; // '' is an escaped quote
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length; // unterminated: swallow the rest
}

function readQuotedIdent(sql, quoteAt) {
  let i = quoteAt + 1;
  while (i < sql.length) {
    if (sql[i] === '"') {
      if (sql[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function readBlockComment(sql, start) {
  let depth = 0;
  let i = start;
  while (i < sql.length) {
    if (sql[i] === "/" && sql[i + 1] === "*") {
      depth += 1;
      i += 2;
    } else if (sql[i] === "*" && sql[i + 1] === "/") {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

/** Operator per scan.l: stop at a comment start; a multi-char op cannot end in + or - unless it has a "special" char. */
function readOperator(sql, start) {
  let i = start;
  while (i < sql.length && OP_CHARS.includes(sql[i])) {
    if (i > start && ((sql[i] === "-" && sql[i + 1] === "-") || (sql[i] === "/" && sql[i + 1] === "*"))) break;
    i += 1;
  }
  let text = sql.slice(start, i);
  if (text.length > 1 && ![...text].some((c) => OP_SPECIAL.includes(c))) {
    while (text.length > 1 && (text.endsWith("+") || text.endsWith("-"))) text = text.slice(0, -1);
  }
  return start + text.length;
}

export function tokenize(sql) {
  const tokens = [];
  const push = (type, start, end, extra) => {
    tokens.push({ type, text: sql.slice(start, end), start, end, ...extra });
    return end;
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /\s/.test(sql[j])) j += 1;
      i = push("ws", i, j);
      continue;
    }
    if (ch === "-" && next === "-") {
      let j = sql.indexOf("\n", i);
      if (j === -1) j = sql.length;
      i = push("comment", i, j);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = push("comment", i, readBlockComment(sql, i));
      continue;
    }

    // Prefixed strings: E'..', B'..', X'..', N'..', U&'..', U&"..".
    if (/[eEbBxXnN]/.test(ch) && next === "'") {
      const kind = ch.toUpperCase();
      i = push("string", i, readQuoted(sql, i + 1, kind === "E"), { kind });
      continue;
    }
    if (/[uU]/.test(ch) && next === "&" && (sql[i + 2] === "'" || sql[i + 2] === '"')) {
      if (sql[i + 2] === "'") i = push("string", i, readQuoted(sql, i + 2, false), { kind: "U" });
      else i = push("qident", i, readQuotedIdent(sql, i + 2));
      continue;
    }
    if (ch === "'") {
      i = push("string", i, readQuoted(sql, i, false), { kind: "" });
      continue;
    }
    if (ch === '"') {
      i = push("qident", i, readQuotedIdent(sql, i));
      continue;
    }

    if (ch === "$") {
      const param = /^\$(\d+)/.exec(sql.slice(i, i + 12));
      if (param) {
        i = push("param", i, i + param[0].length, { n: Number(param[1]) });
        continue;
      }
      const tag = DOLLAR_TAG_RE.exec(sql.slice(i, i + 80));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        i = push("dollar", i, end, { tag: tag[0] });
        continue;
      }
      i = push("unknown", i, i + 1);
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < sql.length && IDENT_CONT.test(sql[j])) j += 1;
      i = push("ident", i, j);
      continue;
    }

    if (/\d/.test(ch) || (ch === "." && /\d/.test(next ?? ""))) {
      const m = NUMBER_RE.exec(sql.slice(i, i + 200));
      i = push("number", i, i + m[0].length);
      continue;
    }

    if (ch === ":" && next === ":") {
      i = push("cast", i, i + 2);
      continue;
    }
    if ("()[],;.:".includes(ch)) {
      i = push("punct", i, i + 1);
      continue;
    }
    if (OP_CHARS.includes(ch)) {
      i = push("op", i, readOperator(sql, i));
      continue;
    }
    i = push("unknown", i, i + 1);
  }
  return tokens;
}

/** Tokens without whitespace and comments; each keeps `nlBefore` (whitespace before it had a newline). */
export function significant(tokens) {
  const out = [];
  let nl = false;
  let gap = false;
  for (const t of tokens) {
    if (t.type === "ws" || t.type === "comment") {
      if (t.text.includes("\n")) nl = true;
      gap = true;
      continue;
    }
    out.push({ ...t, nlBefore: nl, gapBefore: gap });
    nl = false;
    gap = false;
  }
  return out;
}

/**
 * Split text into statements on top-level semicolons (never inside strings,
 * comments or dollar quotes). Returns [{ text, start, end }], trimmed, without
 * empty / comment-only statements.
 */
export function splitStatements(sql) {
  const tokens = tokenize(sql);
  const out = [];
  let start = 0;
  let hasCode = false;
  const flush = (end) => {
    const text = sql.slice(start, end).trim();
    if (hasCode && text) out.push({ text, start, end });
    hasCode = false;
  };
  for (const t of tokens) {
    if (t.type === "punct" && t.text === ";") {
      flush(t.start);
      start = t.end;
    } else if (t.type !== "ws" && t.type !== "comment") {
      hasCode = true;
    }
  }
  flush(sql.length);
  return out;
}

/** True when the text has a semicolon outside strings/comments. */
export function hasTopLevelSemicolon(sql) {
  return tokenize(sql).some((t) => t.type === "punct" && t.text === ";");
}
