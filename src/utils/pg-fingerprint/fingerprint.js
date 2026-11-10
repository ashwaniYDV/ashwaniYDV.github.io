/**
 * Query fingerprinting in the spirit of pg_stat_statements.
 *
 * pg_stat_statements computes `queryid` by hashing the post-analysis parse
 * tree and stores the query text with each constant replaced by $n. We have no
 * parser here, so this works on tokens instead: constants become $n, comments
 * and whitespace disappear, unquoted identifiers are case-folded, and the
 * resulting canonical text is hashed. Queries that differ only in literal
 * values, spacing, comments or keyword case get the same fingerprint. It is an
 * approximation of queryid, not a reimplementation of it.
 */
import { hasTopLevelSemicolon, significant, splitStatements, tokenize } from "./tokenize.js";

/** Type names whose (n[, m]) modifiers are part of the type, not constants: varchar(20), numeric(10,2). */
const TYPMOD_TYPES = new Set([
  "varchar",
  "char",
  "character",
  "varying",
  "bpchar",
  "nchar",
  "numeric",
  "decimal",
  "dec",
  "bit",
  "varbit",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "interval",
  "float",
]);

/** Keywords after which a '-' is a sign, not a subtraction. */
const UNARY_AFTER = new Set([
  "select",
  "where",
  "and",
  "or",
  "not",
  "then",
  "else",
  "when",
  "by",
  "limit",
  "offset",
  "in",
  "values",
  "return",
  "is",
  "between",
  "case",
  "on",
  "having",
  "set",
  "like",
  "ilike",
  "any",
  "all",
  "some",
  "returning",
  "distinct",
  "from",
  "default",
  "array",
  "fetch",
  "first",
  "next",
]);

/** Keywords that end an ORDER BY / GROUP BY position list. */
const CLAUSE_KEYWORDS = new Set([
  "limit",
  "offset",
  "having",
  "union",
  "intersect",
  "except",
  "fetch",
  "for",
  "window",
  "returning",
  "select",
  "from",
  "where",
  "into",
]);

/** Keywords kept apart from a following '(' in the rendered text. */
const SPACE_BEFORE_PAREN = new Set([
  "in",
  "values",
  "as",
  "on",
  "using",
  "from",
  "join",
  "exists",
  "and",
  "or",
  "not",
  "where",
  "select",
  "over",
  "filter",
  "within",
  "into",
  "table",
  "returning",
  "lateral",
  "when",
  "then",
  "else",
  "by",
  "with",
  "union",
  "all",
  "set",
  "having",
  "case",
  "is",
  "distinct",
  "materialized",
  "recursive",
  "conflict",
  "do",
  "update",
  "between",
  "like",
  "ilike",
  "return",
  "limit",
  "offset",
  "except",
  "intersect",
]);

const lower = (t) => (t.type === "ident" ? t.text.toLowerCase() : null);

const isValueEnd = (t) =>
  t &&
  (["ident", "qident", "number", "string", "dollar", "param"].includes(t.type) || t.text === ")" || t.text === "]") &&
  !(t.type === "ident" && UNARY_AFTER.has(t.text.toLowerCase()));

/**
 * Mark constants. Returns items: { kind: "tok", tok } or { kind: "const", from, to, text }
 * where from/to index into the significant-token array.
 */
function markConstants(sig) {
  const items = [];
  const parens = []; // stack of "typmod" | "other"
  let positional = null; // { depth } while inside ORDER BY / GROUP BY

  for (let i = 0; i < sig.length; i += 1) {
    const t = sig[i];
    const prev = sig[i - 1];
    const prevWord = prev && lower(prev);
    const word = lower(t);

    if (t.type === "punct" && (t.text === "(" || t.text === "[")) {
      const typmod = t.text === "(" && TYPMOD_TYPES.has(prevWord);
      parens.push(typmod ? "typmod" : "other");
      items.push({ kind: "tok", tok: t });
      continue;
    }
    if (t.type === "punct" && (t.text === ")" || t.text === "]")) {
      parens.pop();
      if (positional && parens.length < positional.depth) positional = null;
      items.push({ kind: "tok", tok: t });
      continue;
    }
    if (t.type === "punct" && t.text === ";") positional = null;
    if (word === "by" && (prevWord === "order" || prevWord === "group")) positional = { depth: parens.length };
    else if (word && CLAUSE_KEYWORDS.has(word) && positional && parens.length === positional.depth) positional = null;

    const inTypmod = parens[parens.length - 1] === "typmod";

    if (t.type === "string" || t.type === "dollar") {
      let j = i;
      // 'foo'<newline>'bar' is one literal in PostgreSQL.
      while (sig[j + 1]?.type === "string" && sig[j + 1].kind === "" && sig[j + 1].nlBefore && t.type === "string") j += 1;
      items.push({ kind: "const", from: i, to: j });
      i = j;
      continue;
    }

    if (t.type === "number") {
      const nextIsOp = sig[i + 1]?.type === "op";
      const isPosition =
        positional && parens.length === positional.depth && (prevWord === "by" || prev?.text === ",") && !nextIsOp && /^\d+$/.test(t.text);
      if (inTypmod || isPosition) items.push({ kind: "tok", tok: t });
      else items.push({ kind: "const", from: i, to: i });
      continue;
    }

    // Negative numbers: pg_stat_statements folds the sign into the constant.
    if (t.type === "op" && t.text === "-" && sig[i + 1]?.type === "number" && !isValueEnd(prev) && !inTypmod) {
      items.push({ kind: "const", from: i, to: i + 1 });
      i += 1;
      continue;
    }

    if (word === "true" || word === "false" || word === "null") {
      const afterIs = prevWord === "is" || (prevWord === "not" && lower(sig[i - 2] ?? {}) === "is");
      const qualified = prev?.text === "." || sig[i + 1]?.text === ".";
      if (!afterIs && !qualified) {
        items.push({ kind: "const", from: i, to: i });
        continue;
      }
    }

    items.push({ kind: "tok", tok: t });
  }
  return items;
}

/** Index just past a type name after `::` (ident/qident, dotted, optional (..) and [] suffixes). */
function skipTypeName(items, k) {
  const tokAt = (n) => (items[n]?.kind === "tok" ? items[n].tok : null);
  let n = k;
  if (!tokAt(n) || !["ident", "qident"].includes(tokAt(n).type)) return -1;
  n += 1;
  while (tokAt(n)?.text === "." && ["ident", "qident"].includes(tokAt(n + 1)?.type)) n += 2;
  // multi-word types: double precision, character varying, timestamp with time zone
  while (tokAt(n)?.type === "ident" && /^(precision|varying|with|without|time|zone)$/i.test(tokAt(n).text)) n += 1;
  if (tokAt(n)?.text === "(") {
    let depth = 0;
    for (; n < items.length; n += 1) {
      const t = tokAt(n);
      if (t?.text === "(") depth += 1;
      else if (t?.text === ")") {
        depth -= 1;
        if (depth === 0) {
          n += 1;
          break;
        }
      }
    }
  }
  while (tokAt(n)?.text === "[" && tokAt(n + 1)?.text === "]") n += 2;
  return n;
}

/**
 * Collapse IN (c, c, ...) and ARRAY[c, c, ...] lists of constants into one
 * squashed item, like PostgreSQL 18's pg_stat_statements does.
 */
function squashLists(items) {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const word = it.kind === "tok" ? lower(it.tok) : null;
    const open = items[i + 1]?.kind === "tok" ? items[i + 1].tok.text : null;
    const close = word === "in" && open === "(" ? ")" : word === "array" && open === "[" ? "]" : null;
    if (close) {
      let k = i + 2;
      let count = 0;
      let ok = true;
      for (;;) {
        if (items[k]?.kind !== "const") {
          ok = false;
          break;
        }
        k += 1;
        count += 1;
        if (items[k]?.kind === "tok" && items[k].tok.type === "cast") {
          k = skipTypeName(items, k + 1);
          if (k < 0) {
            ok = false;
            break;
          }
        }
        const sep = items[k]?.kind === "tok" ? items[k].tok.text : null;
        if (sep === ",") {
          k += 1;
          continue;
        }
        if (sep !== close) ok = false;
        break;
      }
      if (ok && count >= 2) {
        out.push(it, items[i + 1], { kind: "squash", count }, items[k]);
        i = k;
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

function needsSpace(a, b) {
  if (!a) return false;
  const at = a.text;
  const bt = b.text;
  if (b.type === "cast" || [",", ";", ")", "]", ".", ":"].includes(bt)) return false;
  if (a.type === "cast" || ["(", "[", ".", ":"].includes(at)) return false;
  if (bt === "(") {
    if (a.type === "qident") return false;
    if (a.type === "ident") return SPACE_BEFORE_PAREN.has(at.toLowerCase());
    return true;
  }
  if (bt === "[") return a.type === "op" || at === ",";
  return true;
}

/** Fold "lowercase" quoted identifiers to plain ones; they mean the same thing. */
function canonicalIdent(tok) {
  if (tok.type === "ident") return tok.text.toLowerCase();
  if (tok.type === "qident" && /^"[a-z_][a-z0-9_$]*"$/.test(tok.text)) return tok.text.slice(1, -1);
  return tok.text;
}

/**
 * Normalise one statement.
 * Returns { text, key, constants: [{ n, text }], squashed, params } where
 * `text` is pg_stat_statements-style display text and `key` is the canonical
 * string that gets hashed.
 */
export function normalize(sql, { squash = true } = {}) {
  const sig = significant(tokenize(sql)).filter((t, i, arr) => !(t.text === ";" && i === arr.length - 1));
  const maxParam = sig.reduce((m, t) => (t.type === "param" ? Math.max(m, t.n) : m), 0);
  let items = markConstants(sig);
  if (squash) items = squashLists(items);

  let n = maxParam;
  const constants = [];
  let squashed = 0;
  const display = [];
  const canon = [];
  let prevTok = null;
  const emit = (tok, shown, key) => {
    const sp = needsSpace(prevTok, tok) ? " " : "";
    display.push(sp + shown);
    canon.push(sp + key);
    prevTok = tok;
  };

  for (const it of items) {
    if (it.kind === "tok") {
      emit(it.tok, it.tok.text, canonicalIdent(it.tok));
    } else if (it.kind === "const") {
      n += 1;
      const raw = sig.slice(it.from, it.to + 1);
      constants.push({ n, text: raw.map((t) => t.text).join(raw.length > 1 && raw[0].type === "string" ? " " : "") });
      emit({ type: "param", text: `$${n}` }, `$${n}`, `$${n}`);
    } else if (it.kind === "squash") {
      n += 1;
      squashed += 1;
      constants.push({ n, text: `(${it.count} values)` });
      emit({ type: "param", text: `$${n}` }, `$${n} /*, ... */`, `$${n} /*, ... */`);
    }
  }
  return {
    text: display.join(""),
    key: canon.join(""),
    constants,
    squashed,
    params: maxParam,
  };
}

// ---------- hashing ----------

/** 64-bit FNV-1a, used only where WebCrypto is unavailable (non-secure contexts). */
function fnv1a64(text) {
  let h = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Stable 16-hex-digit fingerprint: SHA-256 of the canonical text, truncated to 64 bits. */
export async function fingerprintHash(key) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fnv1a64(key);
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- many queries ----------

/**
 * Strip a PostgreSQL server-log prefix such as
 * "2024-05-01 10:00:00 UTC [123] LOG:  duration: 0.5 ms  statement: SELECT ..."
 * so that pasted log lines fingerprint as the query alone.
 */
export function stripLogPrefix(text) {
  const m = /^[^\n]*?\b(?:LOG|STATEMENT|ERROR|DETAIL):\s+(?:duration:\s*[\d.]+\s*ms\s*)?(?:(?:statement|execute\s+[^:\n]*|parse\s+[^:\n]*|bind\s+[^:\n]*):\s+)?/.exec(
    text,
  );
  return m ? text.slice(m[0].length) : text;
}

/** Split pasted text into queries: on top-level ';' when present, else one per line. */
export function splitQueries(text, mode = "auto") {
  const bySemicolon = mode === "semicolon" || (mode === "auto" && hasTopLevelSemicolon(text));
  const parts = bySemicolon
    ? splitStatements(text).map((s) => s.text)
    : text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
  return parts.map((p) => stripLogPrefix(p).trim()).filter((p) => p && significant(tokenize(p)).length > 0);
}

/**
 * Group queries by fingerprint. Returns
 * { total, groups: [{ key, text, count, example, constants }] } sorted by count (desc),
 * then first appearance. `text` is the first query's normalised form, as pg_stat_statements keeps the first text it sees.
 */
export function groupQueries(text, { mode = "auto", squash = true } = {}) {
  const queries = splitQueries(text, mode);
  const byKey = new Map();
  queries.forEach((q, index) => {
    const norm = normalize(q, { squash });
    const g = byKey.get(norm.key);
    if (g) g.count += 1;
    else byKey.set(norm.key, { key: norm.key, text: norm.text, count: 1, example: q, first: index });
  });
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count || a.first - b.first);
  return { total: queries.length, groups };
}
