const BLOG_URL = 'https://poetic-bytes.blogspot.com/';
const ADSENSE_CLIENT = 'ca-pub-6428799122405621';
const ADSENSE_ARTICLE_SLOT = '1982565389';
const BLOGGER_STORE_KEY = 'commonplace-blogger';
const PUBLISH_SETTINGS_KEY = 'commonplace-publish-settings';
const BLOGGER_CLIENT_ID = '790965276439-flja0u6tel45rqbg47p6l8fp6aua1tch.apps.googleusercontent.com';
const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { } }
};

function articleBodyHtml(a) {
  if (a.contentType === 'html') return sanitizeHtml(a.body);
  return a.body.split(/\n\s*\n/)
    .map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function videoEmbedHtml(a) {
  const id = a.video ? parseYouTubeId(a.video) : null;
  if (!id) return '';
  return `<div style="position:relative;width:100%;aspect-ratio:16/9;margin:1.2em 0;border-radius:8px;overflow:hidden;background:#000">` +
    `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Music video" loading="lazy" ` +
    `style="position:absolute;inset:0;width:100%;height:100%;border:0" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

function adBlockHtml() {
  return `<div style="margin:1.6em 0;text-align:center">` +
    `<ins class="adsbygoogle" style="display:block" data-ad-client="${ADSENSE_CLIENT}" ` +
    `data-ad-slot="${ADSENSE_ARTICLE_SLOT}" data-ad-format="auto" data-full-width-responsive="true"></ins>` +
    `<script>(adsbygoogle=window.adsbygoogle||[]).push({});<\/script></div>`;
}

function legalFooterHtml() {
  const links = [
    ['Data Privacy', 'privacy.html'], ['Terms of Service', 'terms.html'], ['Cookies', 'cookies.html'],
    ['About this Page', 'about.html'], ['Accessibility', 'accessibility.html'], ['Sitemap', 'sitemap.html']
  ].map(([t, f]) => `<a href="${SITE_URL}${f}" style="color:#6b5a38;text-decoration:none;margin-right:14px;white-space:nowrap">${t}</a>`).join('');
  return `<footer style="margin-top:2em;padding-top:1em;border-top:1px solid #ddd2b8;font-family:Arial,sans-serif;font-size:13px;text-align:left">` +
    `<div style="line-height:2">${links}</div>` +
    `<p style="margin:.6em 0 0;color:#9c8f73">© ${new Date().getFullYear()} The Commonplace</p></footer>`;
}

function articleThumb(article, cat) {
  const ytId = article.video ? parseYouTubeId(article.video) : null;
  return ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`
    : (cat ? `${SITE_URL}covers/${cat.slug}.jpg` : null);
}

function articleStaticHtml(article, cat, canonicalUrl, imageAbsUrl) {
  const title = escapeHtml(article.title);
  const desc = escapeHtml(shareSnippet(article));
  const img = imageAbsUrl ? escapeHtml(imageAbsUrl) : '';
  const photo = (article.photo && /^https?:\/\//.test(article.photo))
    ? `<img src="${escapeHtml(article.photo)}" alt="${title}" style="max-width:100%;border-radius:8px;margin:1em 0">` : '';
  const tags = (article.tags || []).map(t => `<span style="margin-right:8px;color:#8b6b4a">#${escapeHtml(t)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — The Commonplace</title>
<meta name="description" content="${desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<meta name="theme-color" content="#3c2a1f">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Commonplace">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonicalUrl}">
${img ? `<meta property="og:image" content="${img}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${img}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>
<style>
body{margin:0;background:#f6f0e2;color:#211d18;font-family:'Source Serif 4',Georgia,serif;line-height:1.75}
.wrap{max-width:720px;margin:0 auto;padding:1.5rem 1.25rem 3rem}
h1{font-family:'Libre Caslon Display',Georgia,serif;font-weight:400;color:#21312b;font-size:2.1rem;line-height:1.2;margin:.4em 0}
.meta{font-family:Arial,sans-serif;font-size:13px;color:#9c8f73}
.summary{font-style:italic;color:#4a4136;border-left:3px solid #c9b98f;padding-left:.9em}
.post p{text-align:justify;text-justify:inter-word;hyphens:auto;color:#4a4136;margin:0 0 1em}
.post img{max-width:100%}
a{color:#21312b}
</style>
</head>
<body>
<div class="wrap">
<a href="${SITE_URL}" style="font-family:Arial,sans-serif;font-size:13px;text-decoration:none">← The Commonplace</a>
<h1>${title}</h1>
<div class="meta">${cat ? escapeHtml(cat.name) + ' · ' : ''}${article.date}</div>
<div>${tags}</div>
${article.summary ? `<p class="summary">${escapeHtml(article.summary)}</p>` : ''}
${photo}
${videoEmbedHtml(article)}
<div class="post">
${articleBodyHtml(article)}
</div>
${adBlockHtml()}
${legalFooterHtml()}
</div>
</body>
</html>
`;
}

function bloggerContentHtml(article, pageUrl) {
  const photo = article.photo
    ? `<p style="text-align:center"><img src="${escapeHtml(article.photo)}" alt="${escapeHtml(article.title)}" style="max-width:100%;border-radius:8px"></p>` : '';
  return `<div style="text-align:justify;text-justify:inter-word;hyphens:auto;line-height:1.8">` +
    (article.summary ? `<p><em>${escapeHtml(article.summary)}</em></p>` : '') +
    photo + videoEmbedHtml(article) +
    articleBodyHtml(article) +
    adBlockHtml() +
    (pageUrl ? `<p style="font-size:13px;text-align:left">Also at <a href="${pageUrl}">${pageUrl}</a></p>` : '') +
    legalFooterHtml() +
    `</div>`;
}

async function loadBloggerStore() {
  const raw = ls.get(BLOGGER_STORE_KEY);
  if (raw) {
    try { return { posts: {}, ...JSON.parse(raw) }; } catch (e) { }
  }
  try {
    if (window.storage && window.storage.get) {
      const r = await window.storage.get(BLOGGER_STORE_KEY);
      if (r && r.value) {
        const parsed = { posts: {}, ...JSON.parse(r.value) };
        ls.set(BLOGGER_STORE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch (e) { }
  return { posts: {} };
}
async function saveBloggerStore(s) {
  ls.set(BLOGGER_STORE_KEY, JSON.stringify(s));
}

let bloggerTokenClient = null;

function bloggerToken() {
  const t = ls.get('blogger_access_token');
  const exp = +ls.get('blogger_token_expiry') || 0;
  return t && Date.now() < exp - 60000 ? t : '';
}

function initBloggerTokenClient() {
  if (bloggerTokenClient) return bloggerTokenClient;
  if (!window.google || !google.accounts || !google.accounts.oauth2) return null;
  bloggerTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: BLOGGER_CLIENT_ID,
    scope: BLOGGER_SCOPE,
    callback: () => { }
  });
  return bloggerTokenClient;
}

function requestBloggerToken({ prompt } = {}) {
  return new Promise((resolve, reject) => {
    const client = initBloggerTokenClient();
    if (!client) return reject(new Error('Google Sign-In not loaded — refresh the page'));
    client.callback = r => {
      if (r.error) return reject(new Error(r.error_description || r.error));
      ls.set('blogger_access_token', r.access_token);
      ls.set('blogger_token_expiry', String(Date.now() + r.expires_in * 1000));
      resolve(r.access_token);
    };
    const opts = {};
    if (prompt !== undefined) opts.prompt = prompt;
    client.requestAccessToken(opts);
  });
}

async function ensureBloggerToken() {
  const cached = bloggerToken();
  if (cached) return cached;
  try {
    return await requestBloggerToken({});
  } catch (e) {
    const err = new Error('Blogger sign-in required');
    err.needsSignIn = true;
    err.cause = e;
    throw err;
  }
}

async function connectBlogger() {
  try {
    await requestBloggerToken({ prompt: 'select_account' });
    showToast('✅ Blogger connected', 'success');
    return true;
  } catch (e) {
    showToast('⚠️ Blogger sign-in failed: ' + e.message, 'error', 5000);
    return false;
  }
}

async function publishToBlogger(article, cat, pageUrl) {
  const blogId = publishSettings.blogId || ls.get('pc_blog_id');
  if (!blogId) {
    showToast('⚠️ Add your Blogger blog ID on the Home page', 'error', 5000);
    return null;
  }

  let token;
  try {
    token = await ensureBloggerToken();
  } catch (e) {
    if (e.needsSignIn) {
      showToast('⚠️ Blogger sign-in needed — tap "Connect Blogger" on Home', 'error', 5000);
      return null;
    }
    showToast('⚠️ Blogger: ' + e.message, 'error', 5000);
    return null;
  }

  const store = await loadBloggerStore();
  const existingId = store.posts[article.id];
  const labels = [cat ? cat.name : null, ...(article.tags || [])].filter(Boolean);
  const base = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`;

  const res = await fetch(existingId ? base + existingId : base, {
    method: existingId ? 'PUT' : 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      kind: 'blogger#post',
      title: article.title,
      content: bloggerContentHtml(article, pageUrl),
      labels
    })
  });

  if (res.status === 401) {
    ls.del('blogger_access_token');
    ls.del('blogger_token_expiry');
    throw new Error('Blogger session expired — reconnect on Home');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error && err.error.message ? err.error.message : 'Blogger HTTP ' + res.status);
  }

  const data = await res.json();
  store.posts[article.id] = data.id;
  await saveBloggerStore(store);
  return data.url;
}

async function deployArticleToGitHub(article) {
  if (!githubSettings.autoDeploy) return;
  if (!githubSettings.username || !githubSettings.repo || !githubSettings.token) {
    showToast('⚠️ GitHub auto-deploy is on but settings are incomplete — check the Home page', 'error', 5000);
    return;
  }
  const wasDeployed = !!article.pageUrl;
  const cat = categoryOf(article.category);
  const folder = cat ? cat.slug : 'uncategorized';
  const slug = slugify(article.title) || `article-${article.id}`;
  const mdPath = `${folder}/${article.date}-${slug}.md`;
  const pagePath = `${folder}/${article.date}-${slug}.html`;
  let liveUrl = null;

  try {
    await githubPutFile(mdPath, b64EncodeUnicode(articleMarkdown(article)), `Add/update article: ${article.title}`);

    let imageAbsUrl = null;
    if (article.photo && /^https?:\/\//.test(article.photo)) {
      imageAbsUrl = article.photo;
    } else if (article.photo) {
      const m = article.photo.match(/^data:image\/(\w+);base64,(.*)$/);
      if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const photoPath = `${folder}/${article.date}-${slug}.${ext}`;
        await githubPutFile(photoPath, m[2], `Add photo for: ${article.title}`);
        imageAbsUrl = `${SITE_URL}${photoPath}`;
      }
    }
    if (!imageAbsUrl) imageAbsUrl = articleThumb(article, cat);

    liveUrl = `${SITE_URL}${pagePath}`;
    const html = articleStaticHtml(article, cat, `${CANONICAL_URL}${pagePath}`, imageAbsUrl);
    await githubPutFile(pagePath, b64EncodeUnicode(html), `Add page for: ${article.title}`);

    const githubUrl = `https://github.com/${githubSettings.username}/${githubSettings.repo}/blob/${githubSettings.branch}/${mdPath}`;
    const idx = articles.findIndex(x => x.id === article.id);
    if (idx !== -1) {
      articles[idx].githubUrl = githubUrl;
      articles[idx].pageUrl = liveUrl;
      await saveArticleToDb(articles[idx]);
      if (currentArticleId === article.id) updateShareLinks(articles[idx]);
      if (!wasDeployed) maybeAutoPostFacebook(articles[idx]);
    }
    showToast('🚀 Pushed to GitHub — Cloudflare Pages is building', 'success', 4000);
  } catch (e) {
    console.error('GitHub deploy failed:', e);
    showToast(`⚠️ GitHub deploy failed: ${e.message}`, 'error', 6000);
  }

  try {
    const url = await publishToBlogger(article, cat, liveUrl);
    if (url) showToast('📝 Published to Blogger', 'success', 4000);
  } catch (e) {
    console.error('Blogger publish failed:', e);
    showToast(`⚠️ Blogger: ${e.message}`, 'error', 6000);
  }
}

let publishSettings = {
  pagesUrl: 'https://poetic-codes.pages.dev/',
  blogId: ''
};

function applyPagesUrl() {
  let u = (publishSettings.pagesUrl || '').trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!u.endsWith('/')) u += '/';
  SITE_URL = u;
  CANONICAL_URL = u;
}

function injectPublishPanel() {
  if (document.getElementById('pub-save-btn')) return;
  const anchor = document.getElementById('gh-settings-save-btn');
  const host = anchor && anchor.closest('.card');
  if (!host) return;
  const card = document.createElement('div');
  card.className = 'card ledger-panel';
  card.innerHTML = `
    <h2>Publish Targets</h2>
    <p style="color:var(--text-secondary);font-size:14px;margin-bottom:12px;">
      Every saved article is also published to Cloudflare Pages (through the GitHub repo below) and to Blogger.
      Kept on this device only.
    </p>
    <div class="grid cols-2">
      <div class="field"><label for="pub-pages-url">Cloudflare Pages address</label>
        <input type="text" id="pub-pages-url" placeholder="poetic-codes.pages.dev" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="pub-blog-id">Blogger blog ID</label>
        <input type="text" id="pub-blog-id" placeholder="1234567890123456789" autocomplete="off"></div>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="pub-save-btn">Save publish settings</button>
      <button class="btn-secondary" id="pub-connect-btn" type="button">Connect Blogger</button>
    </div>
    <div id="pub-status" style="margin-top:10px;font-size:13px;color:var(--faint);"></div>`;
  host.parentNode.insertBefore(card, host);
  document.getElementById('pub-save-btn').addEventListener('click', savePublishSettings);
  document.getElementById('pub-connect-btn').addEventListener('click', connectBlogger);
}

function fillPublishPanel() {
  setVal('pub-pages-url', publishSettings.pagesUrl || '');
  setVal('pub-blog-id', publishSettings.blogId || '');
  const t = bloggerToken();
  const statusEl = document.getElementById('pub-status');
  if (statusEl) {
    statusEl.textContent = t
      ? `✅ Blogger token active · Pages: ${SITE_URL}`
      : `Blogger not connected — click "Connect Blogger" to sign in.`;
  }
}

async function loadPublishSettings() {
  const raw = ls.get(PUBLISH_SETTINGS_KEY);
  if (raw) {
    try { publishSettings = { ...publishSettings, ...JSON.parse(raw) }; } catch (e) { }
  } else {
    try {
      if (window.storage && window.storage.get) {
        const r = await window.storage.get(PUBLISH_SETTINGS_KEY);
        if (r && r.value) {
          publishSettings = { ...publishSettings, ...JSON.parse(r.value) };
          ls.set(PUBLISH_SETTINGS_KEY, JSON.stringify(publishSettings));
        }
      }
    } catch (e) { }
  }
  applyPagesUrl();
  fillPublishPanel();
}

async function savePublishSettings() {
  const v = id => document.getElementById(id).value.trim();
  publishSettings = {
    pagesUrl: v('pub-pages-url'),
    blogId: v('pub-blog-id')
  };
  ls.set(PUBLISH_SETTINGS_KEY, JSON.stringify(publishSettings));
  ls.set('pc_blog_id', publishSettings.blogId);
  applyPagesUrl();
  fillPublishPanel();
  showToast('✅ Publish settings saved', 'success');
}

injectPublishPanel();
loadPublishSettings();
