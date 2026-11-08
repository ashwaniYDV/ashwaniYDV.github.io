# ashwaniYDV.github.io

[Let's go to the website](https://ashwaniydv.github.io/)

React (Vite) rewrite of the original static site (still available on the `v1` branch). Same Solid State theme, same content.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run preview  # serve the built dist/ locally
```

## Editing content

All text and links live in JSON files under `src/data/`:

| File | Contents |
|---|---|
| `site.json` | Resume link, Formspree endpoint, menu links |
| `socials.json` | Social profile links (banner + footer) |
| `work.json` | "Worked" section entries |
| `education.json` | "Alma mater" section entries |
| `projects.json` | "Projects" highlights |

Text fields support `\n` for a line break and `**bold**`. For work/education entries, `variant` is `"light"` or `"dark"` (alternate them), and `image` is a file name in `src/assets/images/`. Theme CSS is in `src/assets/css/`.

## Blog

Posts are Markdown files in `src/posts/`. The file name sets the URL
(`2026-11-10-hello-world.md` → `/blog/hello-world`), and each file starts with frontmatter:

```md
---
title: My post title
date: 2026-11-10
tags: [kafka, backend]
summary: One line for the blog index, RSS and link previews.
draft: true   # optional: only visible in `npm run dev`
---
```

- Markdown is compiled to HTML at build time (`scripts/markdown-posts.js`), with syntax highlighting for fenced code blocks.
- `npm run build` pre-renders every page to static HTML (`scripts/prerender.mjs`) with its own title and Open Graph tags, and writes `dist/404.html` and `dist/rss.xml`.
- Post images go in `public/blog/` and are referenced as `/blog/<file>`.

## Utils

`/utils` hosts small in-browser tools (Notepad, Markdown editor, Whiteboard). Data stays in the
visitor's browser via `localStorage`; nothing is sent to a server.

To add a utility:

1. Create `src/utils/<slug>/<Name>.jsx` with a default-exported component.
2. Persist state with `useLocalStorage("<slug>", initialValue)` from `src/utils/useLocalStorage.js`
   (debounced writes, cross-tab sync, returns a save `status` for `<SaveStatus />`).
3. Add an entry to `src/utils/registry.js` (`slug`, `title`, Font Awesome 4.7 `icon`, `summary`,
   and `Component: lazy(() => import(...))`).

Routing, the index card, page title and the pre-rendered page all come from the registry, and each
tool's code is lazy-loaded so it never slows down the rest of the site.

## Deploy

Every push to `master` builds and deploys via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
