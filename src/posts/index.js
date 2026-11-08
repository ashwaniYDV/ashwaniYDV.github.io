// Every Markdown file in this folder is a post (compiled by scripts/markdown-posts.js).
// Posts with `draft: true` show up in `npm run dev` only.
const modules = import.meta.glob("./*.md", { eager: true, import: "default" });

export const posts = Object.values(modules)
  .filter((post) => import.meta.env.DEV || !post.draft)
  .sort((a, b) => b.date.localeCompare(a.date));

export const getPost = (slug) => posts.find((post) => post.slug === slug);

/** "2026-11-10" -> "10 Nov 2026" (UTC, so build and browser agree). */
export const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
