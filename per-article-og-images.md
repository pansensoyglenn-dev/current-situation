# Per-Article Social Share Images — Implementation Guide

## The idea

Your GitHub auto-deploy already pushes a markdown file *and its photo* per
article. The missing piece is telling GitHub Pages (Jekyll) to turn that
photo into a real `og:image` tag on that article's own page — not the one
fixed image in your SPA's `index.html`.

Three pieces need to change:

1. **Export function** — write the image to a predictable path and record it
   in the markdown frontmatter.
2. **`_config.yml`** — tell Jekyll your site's base URL (needed to build
   absolute image URLs).
3. **A post layout** — a template that reads `page.image` from frontmatter
   and emits the right `<meta>` tags for *that specific page*.

---

## 1. Export function changes (in `app.js`)

Wherever you currently build the markdown + frontmatter for GitHub export
(both the manual "Export All to GitHub" and the auto-deploy path), make two
changes: give the image a stable filename, and add an `image:` field to the
frontmatter.

```javascript
// Slugify the title once, reuse it for both the .md file and the image
function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function buildArticleFiles(article) {
  const slug = slugify(article.title);
  const files = [];

  let imagePath = null;
  if (article.photo) {
    // e.g. assets/images/on-the-weight-of-borrowed-ideas.jpg
    const ext = article.photo.mimeType.split('/')[1] || 'jpg';
    imagePath = `assets/images/${slug}.${ext}`;
    files.push({
      path: imagePath,
      content: article.photo.base64Data, // pushed as base64 via GitHub API
      encoding: 'base64'
    });
  }

  const frontmatter = [
    '---',
    `title: "${article.title.replace(/"/g, '\\"')}"`,
    `date: ${article.date}`,
    `category: ${article.category}`,
    `summary: "${(article.summary || '').replace(/"/g, '\\"')}"`,
    `tags: [${(article.tags || []).map(t => `"${t}"`).join(', ')}]`,
    imagePath ? `image: /${imagePath}` : null,   // <-- the key addition
    'layout: post',
    '---',
    ''
  ].filter(Boolean).join('\n');

  files.push({
    path: `_posts/${article.date}-${slug}.md`,
    content: frontmatter + article.bodyMarkdown,
    encoding: 'utf-8'
  });

  return files;
}
```

Key points:
- `image:` is stored as a **site-relative path** (`/assets/images/…`), not a
  full URL — the layout will turn it into an absolute URL, since Facebook,
  X, etc. require `og:image` to be a fully-qualified URL.
- Reuse the same `slug` for the markdown filename and the image filename so
  they stay paired and predictable.
- `layout: post` tells Jekyll which template (step 3) to render this file
  with.

---

## 2. `_config.yml`

Add (or confirm) your site's base URL — the layout needs this to build
absolute image URLs:

```yaml
url: "https://pansensoyglenn-dev.github.io"
baseurl: "/current-situation"
title: "The Commonplace"
default_image: "/assets/images/default-share.jpg"   # fallback if an article has no photo
```

Add a `default-share.jpg` (reuse your current `IMG-1551.jpeg`, ~1200×630px)
to `assets/images/` so articles without a photo still get a decent preview
instead of nothing.

---

## 3. `_layouts/post.html`

This is what actually fixes the problem: each generated page gets its own
`og:image`, `og:title`, etc., built from that page's own frontmatter.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{{ page.title }} — The Commonplace</title>
  <meta name="description" content="{{ page.summary | strip_html | truncate: 160 }}">
  <link rel="canonical" href="{{ site.url }}{{ site.baseurl }}{{ page.url }}">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="The Commonplace">
  <meta property="og:title" content="{{ page.title }}">
  <meta property="og:description" content="{{ page.summary | strip_html | truncate: 200 }}">
  <meta property="og:url" content="{{ site.url }}{{ site.baseurl }}{{ page.url }}">
  <meta property="og:image" content="{{ site.url }}{{ page.image | default: site.default_image }}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{ page.title }}">
  <meta name="twitter:description" content="{{ page.summary | strip_html | truncate: 200 }}">
  <meta name="twitter:image" content="{{ site.url }}{{ page.image | default: site.default_image }}">
</head>
<body>
  <article>
    <h1>{{ page.title }}</h1>
    <p class="meta">{{ page.date | date: "%B %-d, %Y" }} · {{ page.category }}</p>
    {% if page.image %}
      <img src="{{ page.image | relative_url }}" alt="{{ page.title }}">
    {% endif %}
    {{ content }}
  </article>
</body>
</html>
```

`{{ site.url }}{{ page.image }}` is what makes each shared link show its
*own* photo — no JavaScript or IndexedDB involved, so crawlers see it
immediately from the raw HTML Jekyll builds.

---

## 4. Point sharing at the GitHub Pages URL, not the app

Your share buttons currently need to link to
`https://pansensoyglenn-dev.github.io/current-situation/_posts/...`-derived
permalink for that article (Jekyll will build the actual URL based on your
permalink settings — commonly `/category/slug/`), rather than the SPA's
hash route (`#/article/id`). The SPA link works fine for you browsing on
your own device, but only the GitHub Pages version is visible to outside
crawlers and to people who don't have that article in their own IndexedDB.

A simple approach: store the eventual GitHub Pages permalink on the article
record once it's been deployed, and use that as the share URL whenever it's
available, falling back to the local hash link only if the article hasn't
been pushed yet.

---

## Checklist

- [ ] Update export function to slugify filenames and add `image:` frontmatter
- [ ] Add `default-share.jpg` fallback image to the repo
- [ ] Add `url` / `baseurl` / `default_image` to `_config.yml`
- [ ] Add `_layouts/post.html` with dynamic OG tags
- [ ] Update share buttons to use the GitHub Pages permalink, not the `#/article/id` hash link
- [ ] Re-scrape a test article in Facebook's Sharing Debugger / X's Card Validator to confirm the new image shows
