// Post-build step: renders every route to static HTML so each page has real
// content and its own <title>/description/Open Graph tags (link previews, SEO,
// and direct URLs on GitHub Pages). Also writes 404.html and rss.xml.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SITE = "https://ashwaniydv.github.io";
const AUTHOR = "Ashwani Yadav";
const DIST = path.resolve("dist");
const SSR_DIR = path.resolve("dist-ssr");

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const { render, posts, BLOG_SUBTITLE } = await import(pathToFileURL(path.join(SSR_DIR, "entry-server.js")).href);
const template = await fs.readFile(path.join(DIST, "index.html"), "utf8");

if (!template.includes('<div id="root"></div>')) {
  throw new Error('dist/index.html is missing <div id="root"></div>');
}

/** Swap the page-specific head tags and inject the rendered markup. */
function buildPage({ url, title, description, type = "website" }) {
  const canonical = `${SITE}${url}`;
  const meta = (attr, key, value) => {
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
    return (html) => {
      const re = new RegExp(`<meta ${attr}="${key}"[^>]*>`);
      return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
    };
  };

  const steps = [
    (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`),
    meta("name", "description", description),
    meta("property", "og:title", title),
    meta("property", "og:description", description),
    meta("property", "og:url", canonical),
    meta("property", "og:type", type),
    (html) => html.replace("</head>", `    <link rel="canonical" href="${canonical}" />\n  </head>`),
    (html) => html.replace('<div id="root"></div>', `<div id="root">${render(url)}</div>`),
  ];
  return steps.reduce((html, step) => step(html), template);
}

async function write(relativePath, contents) {
  const file = path.join(DIST, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  console.log(`  prerendered ${relativePath}`);
}

const homeDescription =
  template.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? AUTHOR;

const pages = [
  { url: "/", file: "index.html", title: AUTHOR, description: homeDescription },
  { url: "/blog", file: "blog/index.html", title: `Blog | ${AUTHOR}`, description: BLOG_SUBTITLE },
  ...posts.map((post) => ({
    url: `/blog/${post.slug}`,
    file: `blog/${post.slug}/index.html`,
    title: `${post.title} | ${AUTHOR}`,
    description: post.summary || post.title,
    type: "article",
  })),
  // GitHub Pages serves this for any unknown path.
  { url: "/404", file: "404.html", title: `Not found | ${AUTHOR}`, description: "Page not found" },
];

for (const page of pages) await write(page.file, buildPage(page));

const rssItems = posts
  .map(
    (post) => `    <item>
      <title>${escapeHtml(post.title)}</title>
      <link>${SITE}/blog/${post.slug}</link>
      <guid isPermaLink="true">${SITE}/blog/${post.slug}</guid>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeHtml(post.summary || post.title)}</description>
${post.tags.map((tag) => `      <category>${escapeHtml(tag)}</category>`).join("\n")}
    </item>`,
  )
  .join("\n");

await write(
  "rss.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${AUTHOR} | Blog</title>
    <link>${SITE}/blog</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${escapeHtml(BLOG_SUBTITLE)}</description>
    <language>en</language>
${rssItems}
  </channel>
</rss>
`,
);

await fs.rm(SSR_DIR, { recursive: true, force: true });
