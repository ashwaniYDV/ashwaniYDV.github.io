// Vite plugin: compiles blog posts (src/posts/*.md) to HTML at build time.
// Each .md import becomes `{ slug, title, date, tags, summary, readingMinutes, html }`,
// so no Markdown parser ships to the browser.
import path from "node:path";
import matter from "gray-matter";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

const WORDS_PER_MINUTE = 200;

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

/** "2026-11-10-hello-world.md" -> "hello-world" */
export const slugFromFile = (file) =>
  path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");

export function compilePost(source, file) {
  const { data, content } = matter(source);
  const where = path.relative(process.cwd(), file);

  if (!data.title) throw new Error(`${where}: frontmatter needs a "title"`);
  // YAML parses an unquoted 2026-11-10 into a Date; accept both forms.
  const date = data.date instanceof Date ? data.date : new Date(String(data.date ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${where}: frontmatter needs a "date" like 2026-11-10`);
  }

  const words = content.split(/\s+/).filter(Boolean).length;
  return {
    slug: data.slug || slugFromFile(file),
    title: String(data.title),
    date: date.toISOString().slice(0, 10),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    summary: data.summary ? String(data.summary) : "",
    draft: Boolean(data.draft),
    readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    html: marked.parse(content),
  };
}

export default function markdownPosts() {
  return {
    name: "markdown-posts",
    transform(source, id) {
      if (!id.endsWith(".md")) return null;
      const post = compilePost(source, id);
      return { code: `export default ${JSON.stringify(post)};`, map: null };
    },
  };
}
