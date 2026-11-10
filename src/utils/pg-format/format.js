/** Formatting options + a thin wrapper over sql-formatter's PostgreSQL dialect (no React). */
import { formatDialect, postgresql } from "sql-formatter";
import { minifySql } from "./minify.js";

export const DEFAULT_OPTIONS = {
  keywordCase: "upper", // "preserve" | "upper" | "lower"
  indent: "2", // "2" | "4" | "tab"
  linesBetweenQueries: 1,
  denseOperators: false,
};

/** Map UI options to sql-formatter options. */
export function toFormatterOptions(opts) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  return {
    keywordCase: o.keywordCase,
    dataTypeCase: o.keywordCase,
    functionCase: "preserve",
    identifierCase: "preserve",
    useTabs: o.indent === "tab",
    tabWidth: o.indent === "4" ? 4 : 2,
    linesBetweenQueries: Math.max(0, Math.min(5, Number(o.linesBetweenQueries) || 0)),
    denseOperators: Boolean(o.denseOperators),
  };
}

/** Returns { output } or { error } (with line/column when sql-formatter reports one). */
export function runFormatter(sql, mode, opts) {
  if (!sql.trim()) return { output: "" };
  if (mode === "minify") return { output: minifySql(sql) };
  try {
    return { output: formatDialect(sql, { dialect: postgresql, ...toFormatterOptions(opts) }) };
  } catch (e) {
    return { error: String(e?.message ?? e).split("\n")[0] };
  }
}
