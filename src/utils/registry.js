import { lazy } from "react";

/**
 * Tool sections (/utils, /pgutils, ...). Each section gets an index page of
 * cards and one full-screen page per tool, all derived from this file.
 *
 * To add a tool:
 *   1. Create src/utils/<slug>/<Name>.jsx with a default-exported component.
 *      It receives a `heading` prop (back link + title): render it first in its
 *      `.util-toolbar`. It is the page's only navigation (no site navbar). The page is full-screen, so make the root fill the height
 *      (see `.tool-page` in assets/css/utils.css).
 *      Persist its state with useLocalStorage("<slug>", initial) from ../useLocalStorage.js.
 *   2. Add an entry to a section's `tools`. `icon` is any Font Awesome 4.7 class (https://fontawesome.com/v4/icons/).
 *      Layout: by default the tool is locked to the viewport (the page itself never
 *      scrolls; good for canvases and app-like UIs). Set `scrollable: true` for
 *      document-like tools: the page scrolls, content grows, the toolbar sticks.
 *
 * To add a section: add an entry to `sections` (path, title, icon, subtitle, tools).
 *
 * Components are lazy-loaded, so a tool's code only downloads when it is opened.
 * Routing, index cards, page titles and the pre-rendered pages all come from this list.
 */
export const sections = [
  {
    id: "utils",
    path: "/utils",
    title: "Utils",
    icon: "fa-wrench",
    subtitle: "Small tools that run in your browser. Your data never leaves this device",
    tools: [
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
        scrollable: true,
        Component: lazy(() => import("./markdown/MarkdownEditor.jsx")),
      },
      {
        slug: "diff",
        title: "Text diff checker",
        icon: "fa-exchange",
        summary: "Compare two texts side by side or unified, with word-level highlights and patch export.",
        scrollable: true,
        Component: lazy(() => import("./diff/DiffChecker.jsx")),
      },
      {
        slug: "whiteboard",
        title: "Whiteboard",
        icon: "fa-paint-brush",
        summary: "Freehand sketching with pen, eraser, undo and PNG export.",
        Component: lazy(() => import("./whiteboard/Whiteboard.jsx")),
      },
    ],
  },
  {
    id: "pgutils",
    path: "/pgutils",
    title: "PGUtils",
    icon: "fa-database",
    subtitle: "PostgreSQL tools for query tuning and internals. Everything runs in your browser",
    tools: [
      {
        slug: "explain",
        title: "EXPLAIN visualizer",
        icon: "fa-sitemap",
        summary:
          "Paste EXPLAIN (ANALYZE, BUFFERS) JSON and see the plan as a tree: slow nodes, misestimates, buffers and spills.",
        Component: lazy(() => import("./pg-explain/ExplainVisualizer.jsx")),
      },
    ],
  },
];

export const getSection = (id) => sections.find((section) => section.id === id);

export const getTool = (section, slug) => section?.tools.find((tool) => tool.slug === slug);

/** `{ section, tool }` when `pathname` is a tool page, otherwise null. */
export function matchToolPath(pathname) {
  for (const section of sections) {
    const slug = pathname.startsWith(`${section.path}/`) && pathname.slice(section.path.length + 1).replace(/\/$/, "");
    const tool = slug && !slug.includes("/") && getTool(section, slug);
    if (tool) return { section, tool };
  }
  return null;
}
