import { Link } from "react-router";
import PageShell from "./PageShell.jsx";
import PostMeta from "../components/PostMeta.jsx";
import { posts } from "../posts";
import { usePageTitle } from "../hooks.js";

export const BLOG_SUBTITLE = "Notes on backend engineering, systems and things I learn along the way";

export default function BlogIndex() {
  usePageTitle("Blog | Ashwani Yadav");

  return (
    <PageShell title="Blog" subtitle={BLOG_SUBTITLE}>
      {posts.length === 0 ? (
        <p>No posts yet. Check back soon.</p>
      ) : (
        <section className="features">
          {posts.map((post) => (
            <article key={post.slug}>
              <h3 className="major">
                <Link to={`/blog/${post.slug}`}>{post.title}</Link>
              </h3>
              <PostMeta post={post} />
              {post.summary && <p>{post.summary}</p>}
              <Link to={`/blog/${post.slug}`} className="special">
                Read post
              </Link>
            </article>
          ))}
        </section>
      )}
      <p className="blog-rss">
        <a href="/rss.xml">
          <i className="fa fa-rss" aria-hidden="true"></i>&nbsp;RSS feed
        </a>
      </p>
    </PageShell>
  );
}
