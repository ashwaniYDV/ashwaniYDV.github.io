import { formatDate } from "../posts";

export default function PostMeta({ post }) {
  return (
    <p className="post-meta">
      <time dateTime={post.date}>{formatDate(post.date)}</time>
      <span aria-hidden="true"> · </span>
      {post.readingMinutes} min read
      {post.tags.length > 0 && (
        <>
          <span aria-hidden="true"> · </span>
          {post.tags.map((tag) => (
            <span key={tag} className="post-tag">
              #{tag}
            </span>
          ))}
        </>
      )}
    </p>
  );
}
