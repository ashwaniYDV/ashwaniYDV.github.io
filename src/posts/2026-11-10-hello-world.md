---
title: Hello, world. Again.
date: 2026-11-10
tags: [meta, react]
summary: Why this site moved from hand-written HTML to React, and how this blog works.
---

This site started life as a single hand-written HTML page built on the
[Solid State](https://html5up.net/solid-state) theme. It has now been rebuilt in
**React** with [Vite](https://vite.dev), and it finally has a blog.

## How posts work

Every post is a Markdown file in `src/posts/`. The file name sets the URL:
`2026-11-10-hello-world.md` becomes `/blog/hello-world`.

At the top of each file sits a small block of frontmatter:

```yaml
---
title: Hello, world. Again.
date: 2026-11-10
tags: [meta, react]
summary: One line shown on the blog index and in link previews.
---
```

Add `draft: true` to keep a post visible in `npm run dev` only.

## Code blocks are highlighted

Fence a block with a language name and it gets syntax highlighting at build time:

```java
public final class Greeter {
    public String greet(String name) {
        return "Hello, " + name + "!";
    }
}
```

```go
func greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}
```

## Everything else Markdown does

> Two roads diverged in a wood, and I —\
> I took the one less traveled by.
>
> — Robert Frost

- Lists, **bold**, _italics_ and `inline code`
- [Links](https://github.com/ashwaniYDV)
- Tables:

| Stack     | Used at          |
|-----------|------------------|
| Kafka     | Zomato, Flipkart |
| Spark     | Twilio           |
| AWS       | Amazon           |

Images go in `public/blog/` and are referenced as `![alt text](/blog/image.png)`.

That's it. Write Markdown, push to `master`, and the post is live a minute later.
