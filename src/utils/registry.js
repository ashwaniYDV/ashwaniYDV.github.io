import { lazy } from "react";

/**
 * Every utility on /utils is one entry here.
 *
 * To add a new one:
 *   1. Create src/utils/<slug>/<Name>.jsx with a default-exported component.
 *      Persist its state with useLocalStorage("<slug>", initial) from ../useLocalStorage.js.
 *   2. Add an entry below. `icon` is any Font Awesome 4.7 class (https://fontawesome.com/v4/icons/).
 *
 * Components are lazy-loaded, so a utility's code only downloads when it is opened.
 * Routing, the index card, page title and the pre-rendered page are all derived from this list.
 */
export const utils = [
  {
    slug: "notepad",
    title: "Notepad",
    icon: "fa-sticky-note-o",
    summary: "Quick multi-note scratchpad. Notes autosave in your browser.",
    Component: lazy(() => import("./notepad/Notepad.jsx")),
  },
  {
    slug: "markdown",
    title: "Markdown editor",
    icon: "fa-file-text-o",
    summary: "Write Markdown with a live, syntax-highlighted preview. Export as .md.",
    Component: lazy(() => import("./markdown/MarkdownEditor.jsx")),
  },
  {
    slug: "whiteboard",
    title: "Whiteboard",
    icon: "fa-paint-brush",
    summary: "Freehand sketching with pen, eraser, undo and PNG export.",
    Component: lazy(() => import("./whiteboard/Whiteboard.jsx")),
  },
];

export const getUtil = (slug) => utils.find((util) => util.slug === slug);
