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

## Deploy

Every push to `master` builds and deploys via `.github/workflows/deploy.yml`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
