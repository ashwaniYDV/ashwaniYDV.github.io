/**
 * Parse tabular query output pasted from psql or a GUI client.
 *
 * Accepts:
 *   - psql aligned output (header, `----+----` rule, `|`-separated rows, optional `(N rows)` footer,
 *     wrapped cells ending in `+`)
 *   - psql expanded output (`-[ RECORD 1 ]----` blocks of `column | value`)
 *   - CSV (with quotes), TSV, or `|`-separated text without a rule line
 *
 * Returns `{ columns: string[], rows: Array<Record<string, string>> }` with lower-cased column names,
 * or `{ error }` when nothing table-like is found.
 */
export function parseTable(text) {
  const lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*\(\d+ rows?\)\s*$/.test(l));
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (!nonEmpty.length) return { error: "empty" };

  if (nonEmpty.some((l) => /^\s*-\[\s*RECORD\s+\d+\s*\]/i.test(l))) return parseExpanded(nonEmpty);

  const ruleIdx = nonEmpty.findIndex((l) => /^\s*-{2,}(\+-+)*\s*$/.test(l) || /^\s*[-+]{3,}\s*$/.test(l));
  if (ruleIdx > 0) return parseAligned(nonEmpty, ruleIdx);

  const first = nonEmpty[0];
  const delim = first.includes("\t") ? "\t" : first.includes("|") ? "|" : first.includes(",") ? "," : null;
  if (!delim) {
    // A single column (e.g. a list of values) with a header.
    return build([first.trim()], nonEmpty.slice(1).map((l) => [l.trim()]));
  }
  if (delim === ",") return parseCsv(nonEmpty.join("\n"));
  const split = (l) => trimEdges(l.split(delim).map((c) => c.trim()), delim);
  return build(split(first), nonEmpty.slice(1).map(split));
}

// `| a | b |` style borders leave empty first/last cells.
function trimEdges(cells, delim) {
  if (delim !== "|") return cells;
  let out = cells;
  if (out.length > 1 && out[0] === "") out = out.slice(1);
  if (out.length > 1 && out[out.length - 1] === "") out = out.slice(0, -1);
  return out;
}

function parseAligned(lines, ruleIdx) {
  const header = lines[ruleIdx - 1].split("|").map((c) => c.trim());
  const body = [];
  let continuing = false;
  for (const line of lines.slice(ruleIdx + 1)) {
    const cells = line.split("|").map((c) => c.replace(/\s+$/, "").replace(/^\s/, ""));
    if (continuing && body.length) {
      const prev = body[body.length - 1];
      cells.forEach((c, i) => {
        const v = c.trim();
        if (v && i < prev.length) prev[i] = `${prev[i].replace(/\s*\+$/, "")}\n${v}`;
      });
    } else {
      body.push(cells.map((c) => c.trim()));
    }
    continuing = cells.some((c) => /\s\+$/.test(c) || c === "+");
    if (!continuing && body.length) {
      const last = body[body.length - 1];
      body[body.length - 1] = last.map((c) => c.replace(/\s*\+$/, ""));
    }
  }
  return build(header, body);
}

function parseExpanded(lines) {
  const records = [];
  let cur = null;
  let lastKey = null;
  for (const line of lines) {
    if (/^\s*-\[\s*RECORD\s+\d+\s*\]/i.test(line)) {
      cur = {};
      records.push(cur);
      lastKey = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf("|");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (!key && lastKey) {
      cur[lastKey] = `${cur[lastKey].replace(/\s*\+$/, "")}\n${value}`;
      continue;
    }
    cur[key] = value;
    lastKey = key;
  }
  if (!records.length) return { error: "No records found in expanded output." };
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
  records.forEach((r) => columns.forEach((c) => (r[c] = (r[c] ?? "").replace(/\s*\+$/, ""))));
  return { columns, rows: records };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return build(rows[0], rows.slice(1));
}

function build(header, body) {
  const columns = header.map((h, i) => h.toLowerCase().replace(/^"|"$/g, "") || `col${i + 1}`);
  if (!columns.length) return { error: "No header row found." };
  const rows = body
    .filter((cells) => cells.some((c) => c !== ""))
    .map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])));
  return { columns, rows };
}
