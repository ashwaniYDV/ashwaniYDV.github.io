import { useMemo } from "react";
import { download, newId, useLocalStorage } from "../useLocalStorage.js";
import SaveStatus from "../SaveStatus.jsx";

const WELCOME = `Welcome to Notepad

Everything you type here is saved automatically in this browser (localStorage).
Nothing is sent anywhere.

Use "New note" to start another one. The first line becomes the note's title.`;

const makeNote = (text = "") => ({ id: newId(), text, updatedAt: Date.now() });

const titleOf = (text) => text.split("\n").find((line) => line.trim())?.trim().slice(0, 60) || "Untitled";

const relativeTime = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
};

export default function Notepad({ heading }) {
  const [state, setState, status] = useLocalStorage("notepad", () => {
    const first = makeNote(WELCOME);
    return { notes: [first], activeId: first.id };
  });

  const { notes, activeId } = state;
  const active = notes.find((n) => n.id === activeId) ?? notes[0];
  const sorted = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  const update = (text) =>
    setState({
      notes: notes.map((n) => (n.id === active.id ? { ...n, text, updatedAt: Date.now() } : n)),
      activeId: active.id,
    });

  const addNote = () => {
    const note = makeNote();
    setState({ notes: [note, ...notes], activeId: note.id });
  };

  const deleteNote = () => {
    if (!window.confirm(`Delete "${titleOf(active.text)}"? This can't be undone.`)) return;
    const rest = notes.filter((n) => n.id !== active.id);
    const next = rest.length ? rest : [makeNote()];
    setState({ notes: next, activeId: next[0].id });
  };

  const text = active?.text ?? "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="notepad">
      <div className="util-toolbar" role="toolbar" aria-label="Notepad">
        {heading}
        <span className="util-toolbar-spacer" />
        <button type="button" className="button small" onClick={addNote}>
          <i className="fa fa-plus" aria-hidden="true"></i>&nbsp;New note
        </button>
        <button type="button" className="button small" onClick={() => download(`${titleOf(text)}.txt`, text)}>
          <i className="fa fa-download" aria-hidden="true"></i>&nbsp;.txt
        </button>
        <button type="button" className="button small" onClick={deleteNote}>
          <i className="fa fa-trash-o" aria-hidden="true"></i>&nbsp;Delete
        </button>
      </div>

      <div className="notepad-main">
        <aside className="notepad-list" aria-label="Notes">
          <ul>
            {sorted.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={note.id === active.id ? "notepad-item is-active" : "notepad-item"}
                  aria-current={note.id === active.id ? "true" : undefined}
                  onClick={() => setState({ notes, activeId: note.id })}
                >
                  <span className="notepad-item-title">{titleOf(note.text)}</span>
                  <span className="notepad-item-time">{relativeTime(note.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="notepad-editor">
          <label htmlFor="notepad-text" className="visually-hidden">
            Note text
          </label>
          <textarea
            id="notepad-text"
            value={text}
            onChange={(e) => update(e.target.value)}
            placeholder="Start typing…"
            spellCheck
            autoFocus
          />
        </section>
      </div>

      <div className="util-statusbar">
        <span>
          {notes.length} {notes.length === 1 ? "note" : "notes"} · {words} words · {text.length} characters
        </span>
        <SaveStatus status={status} />
      </div>
    </div>
  );
}
