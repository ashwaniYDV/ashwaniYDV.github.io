import { Link, useParams } from "react-router";
import PageShell from "./PageShell.jsx";
import NotFound from "./NotFound.jsx";
import PostMeta from "../components/PostMeta.jsx";
import { getPost, posts } from "../posts";
import { usePageTitle } from "../hooks.js";

export default function BlogPost() {
  const { slug } = useParams();
  const post = getPost(slug);
  usePageTitle(post ? `${post.title} | Ashwani Yadav` : "Not found | Ashwani Yadav");

  if (!post) return <NotFound />;

  // Posts are sorted newest first.
  const index = posts.indexOf(post);
  const newer = posts[index - 1];
  const older = posts[index + 1];

  return (
    <PageShell title={post.title}>
      <PostMeta post={post} />
      {/* HTML is compiled at build time from the author's own Markdown in src/posts. */}
      <article className="post-body" dangerouslySetInnerHTML={{ __html: post.html }} />

      <nav className="post-nav" aria-label="More posts">
        {older ? (
          <Link to={`/blog/${older.slug}`} className="special">
            Older: {older.title}
          </Link>
        ) : (
          <span />
        )}
        <Link to="/blog" className="button">
          All posts
        </Link>
        {newer ? (
          <Link to={`/blog/${newer.slug}`} className="special">
            Newer: {newer.title}
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </PageShell>
  );
}
