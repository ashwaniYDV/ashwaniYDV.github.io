import { Link } from "react-router";
import PostMeta from "./PostMeta.jsx";
import { posts } from "../posts";

/** "From the blog" teaser on the home page: the newest few posts. */
export default function LatestPosts({ limit = 2 }) {
  const latest = posts.slice(0, limit);
  if (latest.length === 0) return null;

  return (
    <section className="wrapper style1">
      <div className="inner">
        <section className="features">
          {latest.map((post) => (
            <article key={post.slug} className="reveal">
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
        <ul className="actions">
          <li>
            <Link to="/blog" className="button">
              All posts
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
