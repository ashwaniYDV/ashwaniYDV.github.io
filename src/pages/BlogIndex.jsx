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
            <article key={post.slug} className="post-card">
              <h3 className="major">
                <Link to={`/blog/${post.slug}`} className="post-card-link">
                  {post.title}
                </Link>
              </h3>
              <PostMeta post={post} />
              {post.summary && <p>{post.summary}</p>}
              {/* Duplicate of the stretched title link: keep it out of the tab order. */}
              <Link to={`/blog/${post.slug}`} className="special" tabIndex={-1} aria-hidden="true">
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
