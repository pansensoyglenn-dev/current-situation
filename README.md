# Deploying The Commonplace to GitHub Pages

Target URL: `https://pansensoyglenn-dev.github.io/current-situation/`

## What's in this folder
- `index.html` — the app shell (now loads `styles.css` and `app.js` instead of inlining them)
- `styles.css` — the live theme (Mahogany/Gray/White)
- `app.js` — all app logic, unchanged from the working version
- `privacy.html`, `terms.html`, `cookies.html`, `about.html`, `accessibility.html`, `sitemap.html` — the six footer pages that were linked but didn't exist yet
- `robots.txt`, `sitemap.xml` — for search engine indexing

## Steps (using the GitHub mobile web interface)
1. In your `pansensoyglenn-dev.github.io` account, create (or open) a repo named **current-situation**.
2. Repo → Settings → Pages → set source to "Deploy from a branch," branch `main`, folder `/ (root)`.
3. Upload every file in this folder to the repo root, replacing what's there (Add file → Upload files works fine from mobile web).
4. Wait a minute or two for the Pages build, then visit `pansensoyglenn-dev.github.io/current-situation/`.

## Before you upload — fill these in
- Every `[DATE]`, `[YOUR CONTACT EMAIL]`, and bracketed placeholder in the six new pages
- `og-image.png`, `favicon.svg`, `favicon-32x32.png`, `apple-touch-icon.png` are referenced in `index.html`'s `<head>` but don't exist yet — either add real ones or remove those `<link>`/`<meta>` tags so they don't 404

## Two different "exports" — don't mix these up
- **This README's steps** deploy the *app itself* (the tool people use to write in) to your GitHub Pages URL.
- The **"Export All to GitHub" button inside the app** (on its Home screen) does something different: it downloads your own *written entries* as markdown files, meant for a separate Jekyll/GitHub Pages blog repo. It doesn't touch this repo automatically — you'd still upload those files by hand.
