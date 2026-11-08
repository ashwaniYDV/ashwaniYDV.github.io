import { Fragment } from "react";

/**
 * Renders plain text from the JSON data files with two bits of formatting:
 * "\n" becomes a line break and **text** becomes bold. No raw HTML is
 * interpreted, so content can never inject markup.
 */
export default function RichText({ text }) {
  if (typeof text !== "string") return null;
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <b key={j}>{part}</b> : part))}
    </Fragment>
  ));
}
