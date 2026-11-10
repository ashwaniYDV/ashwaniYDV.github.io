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
          "Paste EXPLAIN (ANALYZE, BUFFERS) output, text or JSON, and see the plan as a tree: slow nodes, misestimates, buffers and spills.",
        Component: lazy(() => import("./pg-explain/ExplainVisualizer.jsx")),
      },
      {
        slug: "explain-diff",
        title: "EXPLAIN plan diff",
        icon: "fa-code-fork",
        summary: "Compare two EXPLAIN plans (text or JSON): matched nodes, time, rows and buffer deltas, and what changed.",
        Component: lazy(() => import("./pg-explain-diff/ExplainDiff.jsx")),
      },
      {
        slug: "statements",
        title: "pg_stat_statements analyzer",
        icon: "fa-bar-chart",
        summary: "Paste a pg_stat_statements export and rank queries by time, calls, I/O and temp spill, with N+1 and cache-miss flags.",
        Component: lazy(() => import("./pg-statements/StatementsAnalyzer.jsx")),
      },
      {
        slug: "index-advisor",
        title: "Index advisor",
        icon: "fa-magic",
        summary: "Paste a query (and optionally its EXPLAIN plan) to get heuristic CREATE INDEX CONCURRENTLY suggestions with reasons.",
        Component: lazy(() => import("./pg-index-advisor/IndexAdvisor.jsx")),
      },
      {
        slug: "sql-format",
        title: "SQL formatter",
        icon: "fa-align-left",
        summary: "Format or minify PostgreSQL SQL: keyword case, indent, dense operators, with live highlighting and copy.",
        Component: lazy(() => import("./pg-format/SqlFormatter.jsx")),
      },
      {
        slug: "fingerprint",
        title: "Query fingerprinter",
        icon: "fa-hashtag",
        summary: "Normalise queries the way pg_stat_statements does ($1, $2, squashed IN lists) and group a pasted log by fingerprint.",
        scrollable: true,
        Component: lazy(() => import("./pg-fingerprint/QueryFingerprinter.jsx")),
      },
      {
        slug: "page-inspector",
        title: "Page & tuple inspector",
        icon: "fa-th",
        summary: "Paste pageinspect output (heap_page_items, page_header, bt_page_items) to see the page layout, decoded infomask flags and HOT chains.",
        Component: lazy(() => import("./pg-page-inspector/PageInspector.jsx")),
      },
      {
        slug: "mvcc",
        title: "MVCC visibility simulator",
        icon: "fa-eye",
        summary: "Is this tuple visible to my snapshot? Step through HeapTupleSatisfiesMVCC with xmin/xmax, hint bits, command ids and a pg_current_snapshot().",
        Component: lazy(() => import("./pg-mvcc/MvccSimulator.jsx")),
      },
      {
        slug: "locks",
        title: "Lock conflict matrix",
        icon: "fa-lock",
        summary: "Which statements block each other (table and row locks), and a wait-for graph from pg_locks or pg_blocking_pids().",
        scrollable: true,
        Component: lazy(() => import("./pg-locks/LockMatrix.jsx")),
      },
      {
        slug: "lsn",
        title: "LSN & WAL calculator",
        icon: "fa-calculator",
        summary: "Diff and add to LSNs, map LSNs to WAL segment files and back, and read replication lag per standby.",
        scrollable: true,
        Component: lazy(() => import("./pg-lsn/LsnCalculator.jsx")),
      },
      {
        slug: "xid",
        title: "XID wraparound calculator",
        icon: "fa-hourglass-half",
        summary: "Paste datfrozenxid / relfrozenxid ages to see how close each is to forced vacuum, failsafe and wraparound. MultiXacts too.",
        scrollable: true,
        Component: lazy(() => import("./pg-xid/XidWraparound.jsx")),
      },
      {
        slug: "autovacuum",
        title: "Autovacuum threshold calculator",
        icon: "fa-recycle",
        summary: "See when vacuum, insert-vacuum and analyze trigger for a table (or many from pg_stat_user_tables) and generate per-table ALTER TABLE settings.",
        scrollable: true,
        Component: lazy(() => import("./pg-autovacuum/AutovacuumCalc.jsx")),
      },
      {
        slug: "rowsize",
        title: "Row & table size estimator",
        icon: "fa-table",
        summary: "Estimate tuple size, alignment padding, rows per page, heap, TOAST and btree index size, and get a column order that wastes less space.",
        scrollable: true,
        Component: lazy(() => import("./pg-rowsize/RowSize.jsx")),
      },
      {
        slug: "tuner",
        title: "postgresql.conf tuner",
        icon: "fa-sliders",
        summary: "Starting-point memory, WAL, planner and parallelism settings for your RAM, CPUs, storage and workload. Copy as postgresql.conf or ALTER SYSTEM.",
        scrollable: true,
        Component: lazy(() => import("./pg-tuner/PgTuner.jsx")),
      },
      {
        slug: "settings-diff",
        title: "Settings diff",
        icon: "fa-cogs",
        summary: "Compare SHOW ALL or pg_settings from two servers, with units normalised (128MB = 16384 × 8kB). Copy as Markdown.",
        scrollable: true,
        Component: lazy(() => import("./pg-settings-diff/SettingsDiff.jsx")),
      },
      {
        slug: "cron",
        title: "pg_cron schedule helper",
        icon: "fa-clock-o",
        summary: "Explain a pg_cron schedule in plain English, list the next runs in any time zone, and generate cron.schedule() SQL.",
        scrollable: true,
        Component: lazy(() => import("./pg-cron/CronHelper.jsx")),
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
