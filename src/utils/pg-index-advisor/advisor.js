/**
 * Heuristic index advisor for PostgreSQL.
 *
 * From a query (lightweight tokenizer, no SQL parser) and optionally an
 * EXPLAIN (FORMAT JSON) plan, propose B-tree indexes:
 *   - equality columns first, then one range column (or the ORDER BY columns),
 *   - constant predicates (IS NULL, = true, = 'literal') as a partial-index WHERE,
 *   - INCLUDE columns when the remaining referenced columns are few (index-only scans),
 *   - plan evidence: Seq Scans discarding many rows, Sorts under a Limit,
 *     inner sides of Nested Loops that re-scan a table per outer row.
 * There is no cost model: every suggestion must be tested (HypoPG, EXPLAIN).
 */
import { parsePlan } from "../pg-explain/plan.js";
import {
  KEYWORDS,
  colrefAt,
  colrefs,
  conjuncts,
  hasTop,
  is,
  isKw,
  matchParen,
  render,
  splitTop,
  stripCasts,
  stripOuter,
  tokenize,
} from "./sqlTokens.js";

export const CAVEATS = [
  "These are heuristics from the query text and plan shape. There is no cost model and no knowledge of your data, so a suggested index can be useless or even slower.",
  "Check existing indexes first (\\d table): an index whose leading columns match already covers many of these.",
  "Test before building: with the HypoPG extension, SELECT * FROM hypopg_create_index('CREATE INDEX ON ...'); then EXPLAIN the query (without ANALYZE) to see if the planner would use it.",
  "CREATE INDEX CONCURRENTLY avoids blocking writes but takes longer, cannot run inside a transaction block, and leaves an INVALID index behind if it fails (drop it and retry).",
  "Every index slows down writes and uses disk and cache. Prefer one index that serves several queries over many narrow ones.",
];

const fmtCount = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (p) => `${Math.round(p * 100)}%`;

// ---------- identifiers ----------
const SAFE_IDENT = /^[a-z_][a-z0-9_$]*$/;

export function quoteIdent(name) {
  return SAFE_IDENT.test(name) && !KEYWORDS.has(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

const qualified = (t) => (t.schema && t.schema !== "public" ? `${quoteIdent(t.schema)}.${quoteIdent(t.name)}` : quoteIdent(t.name));
const tableKey = (t) => `${t.schema && t.schema !== "public" ? `${t.schema}.` : ""}${t.name}`;

// ---------- predicates ----------
const COMPARE = new Set(["=", "<", ">", "<=", ">=", "<>", "!=", "~~", "~~*", "!~~", "!~~*"]);
const FLIP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

/**
 * Classify an operand. `resolve(parts)` -> { table } | { outer: true } | { table: null } (unknown).
 * Returns { kind: "column"|"expr"|"const"|"param"|"value"|"complex", col?, text }.
 */
function operand(tokens, resolve) {
  const t = stripOuter(tokens);
  const text = render(t);
  if (!t.length) return { kind: "value", text };
  if (t.length === 1) {
    const tok = t[0];
    if (tok.t === "string" || tok.t === "number") return { kind: "const", text, literal: tok };
    if (tok.t === "param") return { kind: "param", text };
    if (isKw(tok, "true", "false")) return { kind: "const", text: tok.v, literal: tok };
    if (isKw(tok, "null")) return { kind: "const", text: "NULL", literal: tok };
  }
  if (t.length === 2 && is(t[0], "op", "-") && t[1].t === "number") return { kind: "const", text };
  const ref = colrefAt(t, 0);
  if (ref && ref.end === t.length) {
    const r = resolve(ref.parts);
    if (r.outer) return { kind: "value", text, outer: true };
    return { kind: "column", col: { table: r.table, column: ref.parts[ref.parts.length - 1], quoted: ref.quoted.at(-1) }, text };
  }
  if (isKw(t[0], "any", "all", "some") && is(t[1], "punct", "(") && matchParen(t, 1) === t.length - 1) {
    const inner = operand(t.slice(2, -1), resolve);
    return inner.kind === "column" || inner.kind === "expr" ? { kind: "complex", text } : { kind: "value", text, array: true };
  }
  const refs = colrefs(t)
    .map((r) => ({ ref: r, res: resolve(r.parts) }))
    .filter((x) => !x.res.outer);
  if (!refs.length) return { kind: "value", text };
  // f(col [, constants]) -> expression index key, e.g. lower(email), date_trunc('day', created_at)
  if (refs.length === 1 && t[0].t === "ident" && is(t[1], "punct", "(") && matchParen(t, 1) === t.length - 1) {
    const { ref, res } = refs[0];
    return { kind: "expr", col: { table: res.table, column: ref.parts.at(-1), expr: render(unqualify(t)) }, text };
  }
  return { kind: "complex", text, cols: refs.map((x) => ({ table: x.res.table, column: x.ref.parts.at(-1) })) };
}

/** Remove alias qualifiers (o.created_at -> created_at) for index expressions. */
function unqualify(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const ref = colrefAt(tokens, i);
    if (ref && ref.parts.length > 1) {
      out.push(tokens[ref.end - 1]);
      i = ref.end - 1;
    } else out.push(tokens[i]);
  }
  return out;
}

const isColumnish = (o) => o.kind === "column" || o.kind === "expr";
const isValueish = (o) => o.kind === "const" || o.kind === "param" || o.kind === "value";

/** Column display name (expression text or identifier). */
const colName = (c) => c.expr ?? (c.quoted ? quoteIdent(c.column) : c.column);

/**
 * One conjunct -> predicate.
 *   { kind: "pred", col, op: "eq"|"range"|"prefix"|"null"|"notnull"|"bool", value, text, constant }
 *   { kind: "join", left, right, text }
 *   { kind: "skip", text, reason }
 */
export function classify(tokens, resolve) {
  const t = stripOuter(tokens);
  const text = render(t);
  // EXISTS (...) / x IN (...) with a subquery: the subquery is analysed on its own.
  if (t.some((tok) => is(tok, "param", "$sub"))) return { kind: "skip", text, reason: "Subquery (analysed separately).", silent: true };
  if (hasTop(t, (tok) => isKw(tok, "or"))) return { kind: "skip", text, reason: "OR conditions need one index per branch (BitmapOr) or a rewrite as UNION." };

  // Find the first top-level operator.
  let depth = 0;
  let at = -1;
  for (let i = 0; i < t.length; i++) {
    const tok = t[i];
    if (is(tok, "punct", "(")) depth++;
    else if (is(tok, "punct", ")")) depth--;
    if (depth !== 0 || i === 0) continue;
    if ((tok.t === "op" && COMPARE.has(tok.v)) || isKw(tok, "is", "in", "between", "like", "ilike", "not", "similar")) {
      at = i;
      break;
    }
  }

  if (at === -1) {
    // Bare boolean column or NOT column.
    const negated = isKw(t[0], "not");
    const o = operand(negated ? t.slice(1) : t, resolve);
    if (o.kind === "column") return { kind: "pred", col: o.col, op: "bool", text: `${negated ? "NOT " : ""}${colName(o.col)}`, constant: true };
    return { kind: "skip", text, reason: "Not a simple column condition." };
  }

  const left = operand(t.slice(0, at), resolve);
  const opTok = t[at];
  const rest = t.slice(at + 1);
  const pred = (col, op, value, predText, constant = false) => ({ kind: "pred", col, op, value, text: predText, constant });

  if (isKw(opTok, "is")) {
    if (!isColumnish(left)) return { kind: "skip", text, reason: "Not a column condition." };
    const not = isKw(rest[0], "not");
    const what = rest[not ? 1 : 0];
    const name = colName(left.col);
    if (isKw(what, "null")) return pred(left.col, not ? "notnull" : "null", null, `${name} IS ${not ? "NOT " : ""}NULL`, true);
    if (isKw(what, "true", "false")) {
      const truthy = (what.v === "true") !== not;
      return pred(left.col, "bool", null, `${truthy ? "" : "NOT "}${name}`, true);
    }
    return { kind: "skip", text, reason: "IS DISTINCT FROM / IS UNKNOWN are not indexable as written." };
  }
  if (isKw(opTok, "not")) return { kind: "skip", text, reason: "Negated conditions (NOT IN / NOT LIKE / NOT BETWEEN) rarely use a B-tree index." };
  if (!isColumnish(left)) {
    // value <op> column: flip it.
    if (opTok.t === "op" && COMPARE.has(opTok.v) && isValueish(left)) {
      const right = operand(rest, resolve);
      if (isColumnish(right)) {
        const flipped = FLIP[opTok.v] ?? opTok.v;
        return classify([...rest, { t: "op", v: flipped, raw: flipped }, ...t.slice(0, at)], resolve);
      }
    }
    return { kind: "skip", text, reason: "Not a simple column condition." };
  }

  const name = colName(left.col);
  if (isKw(opTok, "in")) {
    const right = operand(rest, resolve);
    if (right.kind === "complex" || right.kind === "column") return { kind: "skip", text, reason: "IN (subquery) is planned as a join; index the subquery's columns instead." };
    return pred(left.col, "eq", right, `${name} IN ${right.text}`);
  }
  if (isKw(opTok, "between")) return pred(left.col, "range", null, `${name} BETWEEN …`);
  if (isKw(opTok, "similar")) return { kind: "skip", text, reason: "SIMILAR TO needs a trigram index." };

  const op = opTok.t === "op" ? opTok.v : opTok.v;
  const right = operand(rest, resolve);
  if (op === "like" || op === "~~" || op === "ilike" || op === "~~*") {
    const lit = right.literal?.t === "string" ? right.literal.v : null;
    if ((op === "like" || op === "~~") && lit !== null && lit.length && !/^[%_]/.test(lit)) {
      return { ...pred(left.col, "prefix", right, `${name} LIKE ${right.text}`), patternOps: true };
    }
    return {
      kind: "skip",
      text,
      reason:
        op === "ilike" || op === "~~*"
          ? "ILIKE needs a trigram index (CREATE EXTENSION pg_trgm; CREATE INDEX ... USING gin (col gin_trgm_ops)) or an index on lower(col)."
          : "A leading wildcard cannot use a B-tree; a pg_trgm GIN index can.",
    };
  }
  if (op === "!~~" || op === "!~~*") return { kind: "skip", text, reason: "NOT LIKE is not indexable." };
  if (op === "<>" || op === "!=") return { kind: "skip", text, reason: "<> matches most rows; a B-tree rarely helps (consider a partial index instead)." };

  if (isColumnish(right)) {
    if (op === "=" && left.col.table !== right.col.table) return { kind: "join", left: left.col, right: right.col, text };
    return { kind: "skip", text, reason: "Compares two columns of the same table." };
  }
  if (right.kind === "complex") return { kind: "skip", text, reason: "Right side depends on other columns of the same row." };

  const constant = right.kind === "const" && (right.literal?.t === "string" || isKw(right.literal, "true", "false"));
  if (op === "=") {
    if (isKw(right.literal, "true", "false")) return pred(left.col, "bool", right, `${right.literal.v === "true" ? "" : "NOT "}${name}`, true);
    return pred(left.col, "eq", right, `${name} = ${right.text}`, constant);
  }
  return pred(left.col, "range", right, `${name} ${op} ${right.text}`);
}

// ---------- query analysis ----------
const CLAUSES = ["select", "from", "where", "group", "having", "order", "limit", "offset", "fetch", "window", "for", "returning", "set", "using", "values"];
const SET_OPS = ["union", "intersect", "except"];
const JOIN_WORDS = ["join", "inner", "left", "right", "full", "cross", "natural", "outer"];

/** Split a statement's depth-0 tokens into clauses keyed by keyword. */
function clauses(tokens) {
  const out = [];
  let depth = 0;
  let current = { kw: "_start", tokens: [] };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (is(tok, "punct", "(")) depth++;
    else if (is(tok, "punct", ")")) depth--;
    if (depth === 0 && tok.t === "ident" && !tok.quoted && CLAUSES.includes(tok.v)) {
      // "for" only starts a locking clause (FOR UPDATE/SHARE), "set" only in UPDATE.
      if (tok.v === "for" && !isKw(tokens[i + 1], "update", "share", "no", "key")) {
        current.tokens.push(tok);
        continue;
      }
      out.push(current);
      current = { kw: tok.v, tokens: [] };
      if ((tok.v === "group" || tok.v === "order") && isKw(tokens[i + 1], "by")) i++;
      continue;
    }
    current.tokens.push(tok);
  }
  out.push(current);
  return out;
}

const ALIAS_STOP = new Set([...JOIN_WORDS, "on", "using", "where", "group", "order", "limit", "lateral", "set", "returning", "tablesample", "window"]);

/** Parse a FROM list: tables with aliases, plus ON conditions. */
function parseFrom(tokens, ctx) {
  const tables = [];
  const ons = [];
  // Split at commas and JOIN keywords (depth 0).
  const items = [];
  let cur = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (is(tok, "punct", "(")) depth++;
    else if (is(tok, "punct", ")")) depth--;
    if (depth === 0 && (is(tok, "punct", ",") || isKw(tok, "join"))) {
      items.push(cur);
      cur = [];
      continue;
    }
    if (depth === 0 && isKw(tok, ...JOIN_WORDS)) continue;
    cur.push(tok);
  }
  items.push(cur);

  for (let item of items) {
    if (!item.length) continue;
    if (isKw(item[0], "lateral")) item = item.slice(1);
    if (isKw(item[0], "only")) item = item.slice(1);
    // Condition after ON / USING.
    let onAt = -1;
    depth = 0;
    item.forEach((tok, i) => {
      if (is(tok, "punct", "(")) depth++;
      else if (is(tok, "punct", ")")) depth--;
      if (depth === 0 && onAt === -1 && isKw(tok, "on", "using")) onAt = i;
    });
    const head = onAt === -1 ? item : item.slice(0, onAt);
    if (onAt !== -1 && isKw(item[onAt], "on")) ons.push(item.slice(onAt + 1));

    let j = 0;
    let table = null;
    if (is(head[0], "punct", "(")) {
      const close = matchParen(head, 0);
      analyseStatement(head.slice(1, close), ctx); // derived table
      j = close + 1;
    } else if (head[0]?.t === "ident") {
      const parts = [head[0].v];
      j = 1;
      while (is(head[j], "punct", ".") && head[j + 1]?.t === "ident") {
        parts.push(head[j + 1].v);
        j += 2;
      }
      if (is(head[j], "punct", "(")) j = matchParen(head, j) + 1; // set-returning function
      else table = { name: parts.at(-1), schema: parts.length > 1 ? parts.at(-2) : undefined };
    }
    if (isKw(head[j], "as")) j++;
    const aliasTok = head[j];
    const alias = aliasTok?.t === "ident" && (aliasTok.quoted || !ALIAS_STOP.has(aliasTok.v)) ? aliasTok.v : null;
    if (table && !ctx.ctes.has(table.name)) tables.push({ ...table, alias: alias ?? table.name });
  }
  return { tables, ons };
}

function makeResolver(tables, parent) {
  const byAlias = new Map();
  for (const t of tables) {
    byAlias.set(t.alias, t);
    byAlias.set(t.name, t);
  }
  const resolver = (parts) => {
    if (parts.length >= 2) {
      const t = byAlias.get(parts.at(-2));
      if (t) return { table: t };
      if (parent && parent(parts).table) return { outer: true };
      return { table: null };
    }
    if (tables.length === 1) return { table: tables[0] };
    return { table: null };
  };
  return resolver;
}

/** Analyse one SELECT/UPDATE/DELETE; push table usages into ctx. */
function analyseStatement(tokens, ctx, parentResolve) {
  let t = tokens;
  // WITH name AS (...), ...
  if (isKw(t[0], "with")) {
    let i = 1;
    if (isKw(t[i], "recursive")) i++;
    while (i < t.length && t[i]?.t === "ident") {
      ctx.ctes.add(t[i].v);
      i++;
      if (is(t[i], "punct", "(")) i = matchParen(t, i) + 1; // column list
      if (isKw(t[i], "as")) i++;
      if (isKw(t[i], "not")) i++;
      if (isKw(t[i], "materialized")) i++;
      if (is(t[i], "punct", "(")) {
        const close = matchParen(t, i);
        analyseStatement(t.slice(i + 1, close), ctx, parentResolve);
        i = close + 1;
      }
      if (is(t[i], "punct", ",")) i++;
      else break;
    }
    t = t.slice(i);
  }
  // UNION / INTERSECT / EXCEPT: analyse each branch.
  const branches = splitTop(t, (tok) => isKw(tok, ...SET_OPS));
  if (branches.length > 1) {
    branches.forEach((b) => analyseStatement(isKw(b[0], "all", "distinct") ? b.slice(1) : b, ctx, parentResolve));
    return;
  }

  const cl = clauses(t);
  const get = (kw) => cl.find((c) => c.kw === kw);
  let tables = [];
  const ons = [];
  const start = cl[0].tokens;
  if (isKw(start[0], "update")) {
    tables = parseFrom(start.slice(1), ctx).tables;
  } else if (isKw(start[0], "delete") && get("from")) {
    tables = parseFrom(get("from").tokens, ctx).tables;
  } else if (isKw(start[0], "insert")) {
    const sel = t.findIndex((tok) => isKw(tok, "select", "with"));
    if (sel !== -1) analyseStatement(t.slice(sel), ctx, parentResolve);
    return;
  }
  if (!isKw(start[0], "delete")) {
    const from = get("from");
    if (from) {
      const parsed = parseFrom(from.tokens, ctx);
      tables = tables.concat(parsed.tables);
      ons.push(...parsed.ons);
    }
  }
  const usingClause = get("using");
  if (usingClause && isKw(start[0], "delete")) tables = tables.concat(parseFrom(usingClause.tokens, ctx).tables);
  if (!tables.length) return;

  const resolve = makeResolver(tables, parentResolve);
  for (const tb of tables) ctx.tables.push(tb);

  const usage = new Map(); // tableKey -> usage
  const use = (table) => {
    const k = tableKey(table);
    if (!usage.has(k)) usage.set(k, newUsage(table, "query"));
    return usage.get(k);
  };
  tables.forEach(use);

  const conds = [...(get("where") ? conjuncts(withoutSubqueries(get("where").tokens)) : []), ...ons.flatMap((o) => conjuncts(withoutSubqueries(o)))];
  for (const c of conds) {
    const p = classify(c, resolve);
    ctx.predicates.push(p);
    if (p.kind === "pred" && p.col.table) addPred(use(p.col.table), p);
    else if (p.kind === "join" && p.left.table && p.right.table) {
      use(p.left.table).joins.push({ col: p.left, other: p.right, text: p.text });
      use(p.right.table).joins.push({ col: p.right, other: p.left, text: p.text });
    }
  }

  // ORDER BY
  const order = get("order");
  const hasLimit = Boolean(get("limit") || get("fetch"));
  if (order) {
    const keys = splitTop(order.tokens, (tok) => is(tok, "punct", ",")).map((item) => {
      let end = item.length;
      let desc = false;
      while (end > 0 && isKw(item[end - 1], "asc", "desc", "first", "last", "nulls")) {
        if (isKw(item[end - 1], "desc")) desc = true;
        end--;
      }
      const o = operand(item.slice(0, end), resolve);
      return isColumnish(o) && o.col.table ? { col: o.col, desc } : null;
    });
    if (keys.length && keys.every(Boolean) && keys.every((k) => k.col.table === keys[0].col.table)) {
      const u = use(keys[0].col.table);
      u.order = keys;
      u.limit = hasLimit;
    } else if (keys.length) ctx.notes.push("ORDER BY uses expressions, output aliases or several tables, so no index can be suggested for the sort.");
  }

  // Referenced columns per table (for INCLUDE): every clause except the table list, plus ON conditions.
  const all = withoutSubqueries([
    ...cl.filter((c) => c.kw !== "from" && c.kw !== "using" && c.kw !== "_start").flatMap((c) => c.tokens),
    ...ons.flat(),
  ]);
  const flat = withoutSubqueries(t);
  const star = flat.some((tok, i) => is(tok, "op", "*") && (isKw(flat[i - 1], "select", "distinct") || is(flat[i - 1], "punct", ",") || is(flat[i - 1], "punct", ".")));
  for (const ref of colrefs(all)) {
    const r = resolve(ref.parts);
    if (r.outer) continue;
    if (!r.table) {
      if (tables.length > 1 && !isLikelyAlias(ref, t)) for (const u of usage.values()) u.refsComplete = false;
      continue;
    }
    use(r.table).refs.add(ref.parts.at(-1));
  }
  if (star || isKw(start[0], "update") || isKw(start[0], "delete")) for (const u of usage.values()) u.refsComplete = false;

  for (const u of usage.values()) ctx.usages.push(u);

  // Subqueries anywhere in this statement (scalar, EXISTS, IN), after this level's own usages.
  for (const c of cl) {
    if (c.kw === "from") continue;
    for (let i = 0; i < c.tokens.length; i++) {
      if (is(c.tokens[i], "punct", "(") && isKw(c.tokens[i + 1], "select", "with")) {
        const close = matchParen(c.tokens, i);
        analyseStatement(c.tokens.slice(i + 1, close), ctx, resolve);
        i = close;
      }
    }
  }
}

/** An unqualified name used as an output alias (SELECT x AS name ... ORDER BY name) is not a column. */
function isLikelyAlias(ref, tokens) {
  return tokens.some((tok, i) => isKw(tok, "as") && tokens[i + 1]?.v === ref.parts[0]);
}

function withoutSubqueries(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (is(tokens[i], "punct", "(") && isKw(tokens[i + 1], "select", "with")) {
      i = matchParen(tokens, i);
      out.push({ t: "param", v: "$sub", raw: "(subquery)" });
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

function newUsage(table, source) {
  return {
    table,
    source,
    eq: [],
    range: [],
    prefix: [],
    partial: [],
    joins: [],
    order: null,
    limit: false,
    refs: new Set(),
    refsComplete: true,
    reasons: [],
    evidence: 0,
  };
}

function addPred(u, p) {
  if (p.constant) u.partial.push(p);
  else if (p.op === "eq") u.eq.push(p);
  else if (p.op === "range") u.range.push(p);
  else if (p.op === "prefix") u.prefix.push(p);
}

/** Parse a query into table usages. */
export function analyseQuery(sql) {
  const ctx = { ctes: new Set(), tables: [], usages: [], predicates: [], notes: [] };
  const tokens = stripCasts(tokenize(sql));
  const statements = splitTop(tokens, (tok) => is(tok, "punct", ";"));
  for (const st of statements) {
    let s = st;
    if (isKw(s[0], "explain")) {
      // EXPLAIN [(options)] [ANALYZE] [VERBOSE] query
      let i = 1;
      if (is(s[i], "punct", "(")) i = matchParen(s, i) + 1;
      while (isKw(s[i], "analyze", "verbose")) i++;
      s = s.slice(i);
    }
    analyseStatement(s, ctx);
  }
  return ctx;
}

// ---------- plan analysis ----------
const SCAN_TYPES = new Set(["Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan"]);
const PASS_THROUGH = new Set(["Materialize", "Memoize", "Hash", "Gather", "Gather Merge", "Result", "Subquery Scan", "Append"]);

function exprPreds(text, resolve) {
  if (typeof text !== "string" || !text.trim()) return [];
  return conjuncts(stripCasts(tokenize(text))).map((c) => classify(c, resolve));
}

/** Is `node` reached from `ancestor` only through outer (first) children and pass-through nodes? */
function onOuterPath(ancestor, node) {
  let n = node;
  while (n && n !== ancestor) {
    const p = n.parent;
    if (!p) return false;
    const isJoin = /Join|Nested Loop/.test(p.raw["Node Type"]);
    if (isJoin && p.children[0] !== n) return false;
    n = p;
  }
  return n === ancestor;
}

/** Usages derived from plan evidence. */
export function analysePlan(plan) {
  const usages = [];
  const notes = [];
  for (const node of plan.nodes) {
    const raw = node.raw;
    const type = raw["Node Type"];
    if (!SCAN_TYPES.has(type) || !raw["Relation Name"]) continue;
    const table = { name: raw["Relation Name"], schema: raw.Schema, alias: raw.Alias ?? raw["Relation Name"] };
    const own = (q) => q === table.alias || q === table.name;
    const resolve = (parts) => (parts.length === 1 || own(parts.at(-2)) ? { table } : { outer: true });
    const u = newUsage(table, "plan");
    u.node = node;
    const label = `#${node.id} ${node.title} on ${table.name}${table.alias !== table.name ? ` ${table.alias}` : ""}`;
    let triggered = false;

    // A) A filter that throws most rows away.
    const filterPreds = exprPreds(raw.Filter, resolve);
    const removed = node.removed.filter;
    const read = removed + (node.rows ?? 0);
    const share = read > 0 ? removed / read : 0;
    if (raw.Filter && ((node.analyzed && removed >= 1000 && share >= 0.5) || (!node.analyzed && type === "Seq Scan"))) {
      triggered = true;
      u.evidence += node.analyzed ? Math.min(3, Math.log10(Math.max(removed, 1)) - 2) : 0.5;
      u.reasons.push(
        node.analyzed
          ? `Plan ${label} discarded ${fmtCount(removed)} of ${fmtCount(read)} rows read (${fmtPct(share)}) with Filter: ${raw.Filter}.`
          : `Plan ${label} (estimates only) applies Filter: ${raw.Filter}. Re-run with ANALYZE to see how many rows it discards.`,
      );
      if (type !== "Seq Scan" && raw["Index Name"]) {
        u.reasons.push(`The existing index ${raw["Index Name"]} only covers the index condition; adding the filter columns lets the index skip those rows.`);
      }
    }

    // B) Inner side of a Nested Loop re-scanned per outer row.
    let p = node.parent;
    let child = node;
    while (p && PASS_THROUGH.has(p.raw["Node Type"]) && p.raw["Node Type"] !== "Materialize" && p.raw["Node Type"] !== "Hash") {
      child = p;
      p = p.parent;
    }
    const isInner = p && p.raw["Node Type"] === "Nested Loop" && p.children[1] === child;
    let joinPreds = [];
    if (isInner) {
      joinPreds = exprPreds(p.raw["Join Filter"], resolve);
      const outerEq = [...filterPreds, ...joinPreds].some((x) => x.kind === "pred" && x.op === "eq" && x.value?.outer);
      if ((type === "Seq Scan" || outerEq) && (node.loops >= 2 || !node.analyzed) && (type === "Seq Scan" || removed + p.removed.joinFilter >= 1000)) {
        if (outerEq || joinPreds.length) {
          triggered = true;
          u.evidence += node.analyzed ? Math.min(3, Math.log10(Math.max(node.loops, 1))) : 0.5;
          u.reasons.push(
            `Plan ${label} is the inner side of Nested Loop #${p.id}` +
              (node.analyzed ? ` and ran ${fmtCount(node.loops)} times` : "") +
              ". An index on the join column turns each repeat into a quick lookup.",
          );
          if (p.removed.joinFilter >= 1000) u.reasons.push(`The Nested Loop's Join Filter discarded ${fmtCount(p.removed.joinFilter)} rows: ${p.raw["Join Filter"]}.`);
        }
      }
    }

    // C) A Sort under a Limit whose keys all belong to this relation (on the driving side).
    for (let a = node.parent; a; a = a.parent) {
      const at = a.raw["Node Type"];
      if ((at === "Sort" || at === "Incremental Sort") && (a.underLimit || a.parent?.raw["Node Type"] === "Limit") && onOuterPath(a, node)) {
        const keys = (a.raw["Sort Key"] ?? []).map((k) => {
          const toks = stripCasts(tokenize(k));
          let end = toks.length;
          let desc = false;
          while (end > 0 && isKw(toks[end - 1], "asc", "desc", "first", "last", "nulls")) {
            if (isKw(toks[end - 1], "desc")) desc = true;
            end--;
          }
          const o = operand(toks.slice(0, end), resolve);
          return isColumnish(o) && o.col.table ? { col: o.col, desc } : null;
        });
        if (keys.length && keys.every(Boolean)) {
          triggered = true;
          u.order = keys;
          u.limit = true;
          u.evidence += 1;
          const sortShare = plan.totals.time > 0 && a.inclusive !== undefined ? ` (${fmtPct(a.inclusive / plan.totals.time)} of the run time including its input)` : "";
          u.reasons.push(`Plan #${a.id} sorts by ${a.raw["Sort Key"].join(", ")} under a Limit${sortShare}. An index in that order lets the scan stop after the first rows instead of sorting everything.`);
        }
        break;
      }
      if (/Join|Nested Loop|Aggregate|Group|WindowAgg/.test(at) && !onOuterPath(a, node)) break;
    }

    if (!triggered) continue;
    const condPreds = exprPreds(raw["Index Cond"] ?? raw["Recheck Cond"], resolve);
    for (const x of [...condPreds, ...filterPreds, ...joinPreds]) if (x.kind === "pred") addPred(u, x);
    if (Array.isArray(raw.Output)) {
      for (const o of raw.Output) {
        const toks = tokenize(o);
        const ref = colrefAt(toks, 0);
        if (ref && ref.end === toks.length && resolve(ref.parts).table) u.refs.add(ref.parts.at(-1));
        else u.refsComplete = false;
      }
      for (const x of [...filterPreds, ...joinPreds]) if (x.kind === "pred") u.refs.add(x.col.column);
    } else u.refsComplete = false;
    usages.push(u);
  }
  if (!usages.length) notes.push("The plan shows no Seq Scan discarding many rows, no Sort under a Limit and no repeated inner scan, so it adds no index evidence.");
  return { usages, notes };
}

// ---------- building suggestions ----------
const sameCol = (a, b) => colName(a) === colName(b);

function keySql(k) {
  const name = k.col.expr ? `(${k.col.expr})` : colName(k.col);
  return `${name}${k.opclass ? ` ${k.opclass}` : ""}${k.desc ? " DESC" : ""}`;
}

function indexName(table, keys, partial) {
  const cols = keys.map((k) => (k.col.expr ?? k.col.column).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  let name = `${table.name}_${cols.join("_")}${partial ? "_part" : ""}_idx`.replace(/_+/g, "_");
  if (name.length > 63) name = `${name.slice(0, 59).replace(/_$/, "")}_idx`;
  return quoteIdent(name);
}

/** Build a suggestion from a usage (or null). `kind` is "filter" or "join". */
function build(u, kind = "filter") {
  const reasons = [...u.reasons];
  const notes = [];
  const keys = [];
  const pushKey = (col, extra = {}) => {
    if (!keys.some((k) => sameCol(k.col, col))) keys.push({ col, ...extra });
  };

  let partial = [...u.partial];
  const eq = [...u.eq];
  if (kind === "join") {
    for (const j of u.joinsUsed) pushKey(j.col);
  }
  for (const p of eq) pushKey(p.col);

  // Only constants and nothing else to index on: promote constant equalities to keys.
  if (!keys.length && !u.range.length && !u.prefix.length && !u.order) {
    const consts = partial.filter((p) => p.op === "eq");
    if (!consts.length) return null;
    consts.forEach((p) => pushKey(p.col));
    partial = partial.filter((p) => p.op !== "eq");
  }
  const eqCount = keys.length;

  const ranges = [...u.range, ...u.prefix];
  const order = u.order?.filter((k) => !keys.some((x) => sameCol(x.col, k.col))) ?? [];
  let orderUsed = false;
  if (order.length && (!ranges.length || sameCol(ranges[0].col, order[0].col))) {
    order.forEach((k) => pushKey(k.col, { desc: k.desc }));
    orderUsed = true;
  } else if (ranges.length) {
    const r = ranges.find((x) => x.op === "range") ?? ranges[0];
    pushKey(r.col, r.patternOps ? { opclass: "text_pattern_ops" } : {});
    if (order.length) notes.push(`ORDER BY ${order.map((k) => colName(k.col)).join(", ")} cannot be served by this index after the range column; if the LIMIT is small and the range wide, an index on (${[...keys.slice(0, eqCount), ...order].map((k) => colName(k.col)).join(", ")}) may be better. Try both.`);
  }
  const unused = ranges.filter((r) => !keys.some((k) => sameCol(k.col, r.col)));
  if (unused.length) notes.push(`Only one range column can bound an index scan; ${unused.map((r) => colName(r.col)).join(", ")} will be checked as a filter.`);
  if (!keys.length) return null;

  // Partial-index predicate (deduplicated, columns not already keys).
  const where = [];
  for (const p of partial) if (!where.includes(p.text) && !keys.some((k) => sameCol(k.col, p.col))) where.push(p.text);

  // Explanations.
  if (kind === "filter") {
    if (eqCount && keys.length > eqCount) reasons.push(`Equality column${eqCount > 1 ? "s" : ""} ${keys.slice(0, eqCount).map((k) => colName(k.col)).join(", ")} first, then ${orderUsed ? "the ORDER BY column" : "the range column"} ${keys.slice(eqCount).map((k) => colName(k.col)).join(", ")}: a B-tree can seek to the equal values and scan one contiguous range.`);
    else if (eqCount > 1) reasons.push("Several equality columns: their order matters little for this query; put the most selective, or the one other queries filter on alone, first.");
    else if (eqCount === 1 && keys.length === 1) reasons.push(`Lets the planner look up ${colName(keys[0].col)} directly instead of filtering every row.`);
    if (orderUsed) reasons.push(`Key order matches ORDER BY ${u.order.map((k) => `${colName(k.col)}${k.desc ? " DESC" : ""}`).join(", ")}, so ${u.limit ? "a LIMIT can stop after the first matching rows with no sort" : "rows come out already sorted"}.`);
    if (keys.some((k) => k.opclass)) reasons.push("text_pattern_ops lets LIKE 'prefix%' use the index under a non-C collation (it then can't serve ORDER BY or < >; drop it if your database uses the C collation).");
    if (keys.some((k) => k.col.expr)) reasons.push("Expression index: the query must use exactly the same expression for the index to apply.");
  }
  if (where.length) reasons.push(`Partial index (WHERE ${where.join(" AND ")}): only matching rows are indexed, so it is smaller, but only queries with the same condition can use it. Drop the WHERE if the constant varies.`);

  // INCLUDE for index-only scans.
  let include = [];
  if (u.refsComplete && u.refs.size) {
    const keyNames = new Set(keys.filter((k) => !k.col.expr).map((k) => k.col.column));
    const partialCols = new Set(partial.map((p) => p.col.column));
    const extra = [...u.refs].filter((c) => !keyNames.has(c) && !partialCols.has(c));
    if (extra.length && extra.length <= 3 && !keys.some((k) => k.col.expr)) {
      include = extra;
      reasons.push(`INCLUDE (${extra.join(", ")}) covers the other columns this query reads from ${u.table.name}, allowing an index-only scan (PostgreSQL 11+; needs a well-vacuumed table). Optional: it makes the index bigger.`);
    } else if (extra.length > 3) notes.push(`The query reads ${extra.length} more columns from ${u.table.name}; covering them all would make the index large, so no INCLUDE is suggested.`);
  }

  const sql =
    `CREATE INDEX CONCURRENTLY ${indexName(u.table, keys, where.length > 0)}\n    ON ${qualified(u.table)} (${keys.map(keySql).join(", ")})` +
    (include.length ? `\n    INCLUDE (${include.map(quoteIdent).join(", ")})` : "") +
    (where.length ? `\n    WHERE ${where.join(" AND ")}` : "") +
    ";";

  const priority = u.source === "plan" ? (u.evidence >= 2 ? "high" : "medium") : kind === "join" ? "low" : "medium";
  return {
    table: tableKey(u.table),
    keys: keys.map((k) => ({ name: k.col.expr ? `(${k.col.expr})` : colName(k.col), desc: Boolean(k.desc) })),
    include,
    where,
    sql,
    reasons,
    notes,
    priority,
    sources: [u.source],
    kind,
  };
}

/** Query usages -> filter suggestion + join-column suggestions. */
function querySuggestions(u) {
  const out = [];
  const main = build(u, "filter");
  if (main) out.push(main);
  const seen = new Set();
  for (const j of u.joins) {
    const name = colName(j.col);
    if (seen.has(name) || name === "id" || main?.keys[0]?.name === name) continue;
    seen.add(name);
    const ju = { ...u, eq: [], range: [], prefix: [], order: null, partial: main ? [] : u.partial, joinsUsed: [j], refsComplete: false, reasons: [] };
    ju.reasons = [
      `Join condition ${j.text}: when ${u.table.name} is the inner side of a Nested Loop, or for foreign-key lookups and ON DELETE checks, an index on ${name} avoids scanning the table.` +
        " Skip it if this column is already the leading column of an index (or the primary key).",
    ];
    const s = build(ju, "join");
    if (s) out.push(s);
  }
  return out;
}

const sig = (s) => `${s.table}|${s.keys.map((k) => k.name).join(",")}|${s.where.join(" AND ")}`;

/** Merge duplicates and suggestions whose key columns are a prefix of another's (same table and WHERE). */
export function mergeSuggestions(list) {
  const out = [];
  const rank = { high: 0, medium: 1, low: 2 };
  for (const s of list) {
    const twin = out.find((o) => o.table === s.table && o.where.join() === s.where.join() && isPrefixOrEqual(o, s));
    if (!twin) {
      out.push({ ...s, reasons: [...s.reasons], notes: [...s.notes], sources: [...s.sources] });
      continue;
    }
    // Keep the longer key list (or the one with sort directions).
    const longer = s.keys.length > twin.keys.length || (s.keys.length === twin.keys.length && s.keys.some((k) => k.desc) && !twin.keys.some((k) => k.desc)) ? s : twin;
    const merged = {
      ...longer,
      include: longer.include.length ? longer.include : (longer === s ? twin : s).include,
      reasons: [...new Set([...twin.reasons, ...s.reasons])],
      notes: [...new Set([...twin.notes, ...s.notes])],
      sources: [...new Set([...twin.sources, ...s.sources])],
      priority: rank[s.priority] < rank[twin.priority] ? s.priority : twin.priority,
      kind: twin.kind === "filter" || s.kind === "filter" ? "filter" : "join",
    };
    if (merged.include !== longer.include) merged.sql = rebuildSql(merged, longer);
    out[out.indexOf(twin)] = merged;
  }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority] || (b.sources.includes("plan") ? 1 : 0) - (a.sources.includes("plan") ? 1 : 0));
}

function isPrefixOrEqual(a, b) {
  const x = a.keys.map((k) => k.name);
  const y = b.keys.map((k) => k.name);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((n, i) => long[i] === n);
}

function rebuildSql(merged, base) {
  const lines = base.sql.replace(/;$/, "").split("\n").filter((l) => !/^\s+INCLUDE \(/.test(l));
  if (merged.include.length) lines.splice(2, 0, `    INCLUDE (${merged.include.map(quoteIdent).join(", ")})`);
  return `${lines.join("\n")};`;
}

/**
 * Main entry. Returns { suggestions, skipped, notes, tables, planError }.
 */
export function advise(query, planText) {
  const notes = [];
  let suggestions = [];
  let tables = [];
  let skipped = [];
  let planError = null;
  let planUsed = false;

  if (planText && planText.trim()) {
    const plan = parsePlan(planText);
    if (plan.error) planError = plan.error;
    else {
      planUsed = true;
      const res = analysePlan(plan);
      notes.push(...res.notes);
      for (const u of res.usages) {
        const s = build(u, "filter");
        if (s) suggestions.push(s);
      }
      if (!plan.analyzed) notes.push("The plan has no ANALYZE data, so evidence is based on estimates only.");
    }
  }

  if (query && query.trim()) {
    const ctx = analyseQuery(query);
    tables = ctx.tables;
    notes.push(...ctx.notes);
    skipped = ctx.predicates.filter((p) => p.kind === "skip" && !p.silent);
    const unresolved = ctx.predicates.filter((p) => (p.kind === "pred" && !p.col.table) || (p.kind === "join" && (!p.left.table || !p.right.table)));
    if (unresolved.length) notes.push(`Couldn't tell which table ${unresolved.map((p) => p.text).join("; ")} belong${unresolved.length > 1 ? "" : "s"} to. Qualify columns with the table alias (o.status) when joining.`);
    for (const u of ctx.usages) suggestions.push(...querySuggestions(u));
    if (!ctx.tables.length) notes.push("No tables found in the query. Paste a SELECT, UPDATE or DELETE statement.");
  }

  suggestions = mergeSuggestions(suggestions);
  return { suggestions, skipped, notes: [...new Set(notes)], tables, planError, planUsed };
}

export { sig as suggestionSignature };
