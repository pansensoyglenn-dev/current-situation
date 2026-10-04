const CATEGORIES = [
  { slug: 'history', name: 'History', color: '#8B5E34', description: 'A look backward — the events, decisions, and forgotten details that explain how the present came to be.' },
  { slug: 'philosophy', name: 'Philosophy', color: '#5C4B7A', description: 'Essays that sit with hard questions — ethics, meaning, and the different ways of thinking that shape a life.' },
  { slug: 'economy', name: 'Economy', color: '#3E6E6B', description: 'Notes on markets, money, and the incentives that quietly steer how resources move through the world.' },
  { slug: 'programming', name: 'Programming', color: '#45586B', description: 'Thoughts on code, tools, and the craft of building software — the small decisions that add up to working systems.' },
  { slug: 'culture', name: 'Culture', color: '#B0793F', description: 'Observations on art, media, and the everyday habits and stories that shape how people live and create.' },
  { slug: 'culinary', name: 'Culinary', color: '#9C5A3C', description: 'Notes on food and cooking — recipes worth keeping, kitchen technique, and meals worth remembering.' },
  { slug: 'local-politics', name: 'Local Politics', color: '#7A3B3B', description: 'Commentary on the affairs closer to home — community, local government, and national politics as lived day to day.' },
  { slug: 'global-politics', name: 'Global Politics', color: '#35506B', description: 'Perspectives on international affairs, diplomacy, and the shifting balance of power on the world stage.' },
  { slug: 'weather', name: 'Weather', color: '#5A7F97', description: 'Musings on climate, seasons, and the sky overhead — the weather as a subject worth paying attention to.' },
  { slug: 'farming', name: 'Farming', color: '#5E7A3D', description: 'Reflections on agriculture, land, and growing things — the rhythms of planting, tending, and harvest.' },
  { slug: 'ai', name: 'AI', color: '#4A5FA8', description: 'Essays on artificial intelligence — the tools reshaping work and thought, and what it means to build and think alongside a machine.' }
];

const SITE_URL = 'https://current-situation.vercel.app/';
const CANONICAL_URL = 'https://current-situation.vercel.app/';

const DB_NAME = 'CommonplaceDB';
const DB_VERSION = 1;
const STORAGE_KEY = 'commonplace-articles-v1';

let db = null;
let dbPromise = null;
let articles = [];
let nextId = 1;
let editingId = null;
let currentArticleId = null;
let pendingPhoto = null;
let pendingPhotoFile = null;
let pendingVideoFile = null;
let toastTimer = null;
let searchDebounce = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (ev) => {
      const database = ev.target.result;
      if (!database.objectStoreNames.contains('records')) {
        database.createObjectStore('records', { keyPath: 'key' });
      }
    };
    request.onsuccess = (ev) => { db = ev.target.result; resolve(db); };
    request.onerror = (ev) => reject(ev.target.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

window.storage = {
  get: async (key) => {
    await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(key);
      req.onsuccess = () => resolve(req.result ? { value: req.result.value } : null);
      req.onerror = (ev) => reject(ev.target.error);
    });
  },
  set: async (key, value) => {
    await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const req = tx.objectStore('records').put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = (ev) => reject(ev.target.error);
    });
  },
  delete: async (key) => {
    await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const req = tx.objectStore('records').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = (ev) => reject(ev.target.error);
    });
  }
};

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
function setChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Backblaze B2's S3-compatible API caps a single PUT at 5 GB.
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

// ---------- Photo downscaling ----------
const PHOTO_MAX_DIM = 1600;
const PHOTO_JPEG_QUALITY = 0.85;
const PHOTO_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

async function downscaleImageFile(file, maxDim = PHOTO_MAX_DIM, quality = PHOTO_JPEG_QUALITY) {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;

  let bitmap;
  let tempUrl = null;
  try {
    if (window.createImageBitmap) {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        tempUrl = URL.createObjectURL(file);
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read image'));
        img.src = tempUrl;
      });
    }
  } catch (e) {
    if (tempUrl) URL.revokeObjectURL(tempUrl);
    console.warn('Could not decode image for downscaling, uploading original:', e);
    return file;
  }

  const srcW = bitmap.width || bitmap.naturalWidth;
  const srcH = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));

  // Already small enough and already a JPEG — don't re-encode (avoids quality loss).
  if (scale === 1 && file.type === 'image/jpeg' && file.size <= 1.5 * 1024 * 1024) {
    if (bitmap.close) bitmap.close();
    if (tempUrl) URL.revokeObjectURL(tempUrl);
    return file;
  }

  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha — paint white first so transparent PNGs don't turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dstW, dstH);
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  if (bitmap.close) bitmap.close();
  if (tempUrl) URL.revokeObjectURL(tempUrl);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return file;

  const newName = (file.name || 'photo.jpg').replace(/\.(png|webp|heic|heif|avif|bmp|tiff?)$/i, '.jpg');
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

// ---------- Video handling (uploads to Backblaze B2) ----------
function putWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload to Backblaze failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload to Backblaze failed (network or CORS error)'));
    xhr.send(file);
  });
}

async function storeVideoFile(file, onProgress) {
  const qs = new URLSearchParams({
    filename: file.name,
    contentType: file.type,
    size: file.size
  });
  const res = await fetch(apiUrl(`video-upload?${qs}`), { method: 'POST' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not get upload URL'));
  const { uploadUrl, publicUrl } = await res.json();

  await putWithProgress(uploadUrl, file, onProgress);
  return publicUrl;
}

async function resolveVideoSrc(value) {
  if (!value) return null;
  if (value.startsWith('http')) return value;
  if (value.startsWith('data:')) return value;
  return null;
}

async function hydrateVideoElements(root) {
  const scope = root || document;
  const els = scope.querySelectorAll('video[data-media-key]');
  for (const el of els) {
    const src = await resolveVideoSrc(el.getAttribute('data-media-key'));
    if (src) el.src = src;
  }
}

async function videoValueToFile(value, filename) {
  if (!value) return null;
  if (value.startsWith('http')) {
    try {
      const r = await fetch(value);
      return new File([await r.blob()], filename, { type: r.headers.get('content-type') || 'video/mp4' });
    } catch (e) { console.warn('Could not fetch remote video for sharing:', e); return null; }
  }
  if (value.startsWith('data:')) {
    const [header, base64] = value.split(',');
    const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'video/mp4';
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], filename, { type: mime });
  }
  return null;
}

// Escapes text for both element content AND quoted attribute values.
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HTML_DISALLOWED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'BASE', 'FRAME', 'FRAMESET', 'APPLET', 'NOSCRIPT']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'data']);

function sanitizeHtml(rawHtml) {
  const template = document.createElement('template');
  template.innerHTML = rawHtml || '';
  const walk = (node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 1) {
        if (HTML_DISALLOWED_TAGS.has(child.tagName.toUpperCase())) { child.remove(); continue; }
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          // Strip whitespace/control chars so "java\tscript:" tricks don't slip through.
          const val = attr.value.replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').toLowerCase();
          if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
            child.removeAttribute(attr.name);
          } else if (URL_ATTRS.has(name)) {
            const badScheme = /^(javascript|vbscript):/.test(val);
            const badData = /^data:/.test(val) && !(name === 'src' && /^data:image\/(png|jpe?g|gif|webp|avif);/.test(val));
            if (badScheme || badData) child.removeAttribute(attr.name);
          } else if (name === 'style' && /expression|javascript:|url\(/.test(val)) {
            child.removeAttribute(attr.name);
          }
        }
        walk(child);
      }
    }
  };
  walk(template.content);
  return template.innerHTML;
}

function categoryOf(slug) {
  return CATEGORIES.find(c => c.slug === slug) || null;
}

function attachSectionCover(container, slug) {
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'none';

  const imageExts = ['jpg', 'jpeg', 'png', 'webp'];
  const tryImage = (idx) => {
    if (idx >= imageExts.length) { container.style.display = 'none'; return; }
    const img = document.createElement('img');
    img.className = 'section-cover';
    img.alt = '';
    img.loading = 'lazy';
    img.onload = () => { container.style.display = ''; };
    img.onerror = () => tryImage(idx + 1);
    img.src = `covers/${slug}.${imageExts[idx]}`;
    container.innerHTML = '';
    container.appendChild(img);
  };

  const video = document.createElement('video');
  video.className = 'section-cover';
  video.autoplay = true;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  video.onloadeddata = () => { container.style.display = ''; };
  video.onerror = () => tryImage(0);
  video.src = `covers/${slug}.mp4`;
  container.appendChild(video);
}

function showToast(msg, type = 'info', duration = 3000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast';
  if (type === 'error') t.classList.add('error');
  if (type === 'success') t.classList.add('success');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

// ---------- Shared article database ----------
function apiUrl(path) { return `${CANONICAL_URL}api/${path}`; }

async function apiErrorMessage(res, fallback) {
  try {
    const data = await res.json();
    if (data && data.error) return `${data.error} (${res.status})`;
  } catch (e) { }
  return `${fallback} (${res.status})`;
}

async function apiListArticles() {
  const res = await fetch(apiUrl('articles'), { cache: 'no-store' });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not load articles'));
  return res.json();
}
async function apiCreateArticle(payload) {
  const res = await fetch(apiUrl('articles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not save article'));
  return res.json();
}
async function apiUpdateArticle(id, payload) {
  const res = await fetch(apiUrl(`articles?id=${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'Could not update article'));
  return res.json();
}
async function apiDeleteArticle(id) {
  const res = await fetch(apiUrl(`articles?id=${id}`), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(await apiErrorMessage(res, 'Could not delete article'));
}

async function apiUploadPhoto(file) {
  let toSend = file;
  if (toSend.size > PHOTO_FALLBACK_MAX_BYTES) {
    try { toSend = await downscaleImageFile(file, 1280, 0.78); }
    catch (e) { console.warn('Second-pass downscale failed, trying original:', e); }
  }
  const qs = new URLSearchParams({
    filename: toSend.name || 'photo.jpg',
    contentType: toSend.type || 'image/jpeg'
  });
  const res = await fetch(apiUrl(`upload?${qs}`), { method: 'POST', body: toSend });
  if (!res.ok) throw new Error(await apiErrorMessage(res, 'Photo upload failed'));
  const data = await res.json();
  return data.url;
}

function mapDbArticleToLocal(row) {
  return {
    id: Number(row.id),
    title: row.title,
    category: row.category,
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : row.date,
    contentType: row.content_type,
    body: row.body,
    summary: row.summary || '',
    tags: row.tags || [],
    photo: row.photo_url || null,
    video: row.video_url || null,
    githubUrl: row.github_url || null,
    pageUrl: row.page_url || null
  };
}

function articleToApiPayload(a) {
  return {
    title: a.title,
    category: a.category,
    date: a.date,
    contentType: a.contentType,
    body: a.body,
    summary: a.summary || '',
    tags: a.tags || [],
    photoUrl: a.photo || null,
    videoUrl: a.video || null,
    githubUrl: a.githubUrl || null,
    pageUrl: a.pageUrl || null
  };
}

async function loadArticles() {
  try {
    const rows = await apiListArticles();
    articles = rows.map(row => mapDbArticleToLocal(row));
  } catch (e) {
    console.warn('Failed to load articles from the database:', e);
    articles = [];
    showToast('⚠️ Could not reach the article database — check your connection', 'error', 6000);
  }
}

// Saves ONE article (previously this re-PUT every article in the database on each call).
async function saveArticleToDb(article) {
  try {
    await apiUpdateArticle(article.id, articleToApiPayload(article));
    return true;
  } catch (e) {
    console.error('Save error:', e);
    showToast('⚠️ Failed to save — check your connection to the database.', 'error', 5000);
    return false;
  }
}

// ---------- One-time migration: old local articles -> database ----------
async function checkForLocalMigration() {
  try {
    const res = await window.storage.get(STORAGE_KEY);
    const count = (res && res.value) ? (JSON.parse(res.value).articles || []).length : 0;
    if (!count) return;
    setText('migrate-banner-text',
      `Found ${count} article(s) saved locally on this device from before the database was connected. They haven't been moved yet — nothing has been lost.`);
    const banner = document.getElementById('migrate-banner');
    if (banner) banner.style.display = '';
  } catch (e) { }
}

async function migrateLocalArticles() {
  const btn = document.getElementById('migrate-local-btn');
  const statusEl = document.getElementById('migrate-status');
  btn.disabled = true;
  const oldLabel = btn.textContent;
  try {
    const res = await window.storage.get(STORAGE_KEY);
    if (!res || !res.value) {
      document.getElementById('migrate-banner').style.display = 'none';
      return;
    }
    const parsed = JSON.parse(res.value);
    let remaining = parsed.articles || [];
    const total = remaining.length;
    let migrated = 0;

    while (remaining.length) {
      const orig = remaining[0];
      btn.textContent = `Migrating ${migrated + 1}/${total}…`;

      let photoUrl = orig.photo || null;
      if (photoUrl && photoUrl.startsWith('data:')) {
        try {
          const file = await photoToFile(photoUrl, `${slugify(orig.title) || 'photo'}.jpg`);
          if (file) photoUrl = await apiUploadPhoto(file);
        } catch (e) {
          console.warn('Could not move photo to Blob for', orig.title, '— keeping it as-is:', e);
        }
      }

      await apiCreateArticle({
        title: orig.title,
        category: orig.category,
        date: orig.date,
        contentType: orig.contentType || 'text',
        body: orig.body,
        summary: orig.summary || '',
        tags: orig.tags || [],
        photoUrl,
        videoUrl: null,
        githubUrl: orig.githubUrl || null,
        pageUrl: orig.pageUrl || null
      });

      remaining = remaining.slice(1);
      await window.storage.set(STORAGE_KEY, JSON.stringify({ ...parsed, articles: remaining }));
      migrated++;
    }

    await window.storage.delete(STORAGE_KEY);
    await loadArticles();
    renderCategoryNav();
    renderHome();
    document.getElementById('migrate-banner').style.display = 'none';
    showToast(`✅ Migrated ${migrated} article(s) to the database`, 'success', 5000);
  } catch (e) {
    console.error('Migration failed:', e);
    if (statusEl) statusEl.textContent = `⚠️ Stopped partway (${e.message}). Nothing was lost — the remaining local articles are still saved. Try again to continue.`;
    showToast(`⚠️ Migration paused: ${e.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

async function exportToGitHub() {
  if (articles.length === 0) {
    showToast('📭 No articles to export', 'error');
    return;
  }

  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const markdownFiles = [];

  for (const article of sorted) {
    const cat = categoryOf(article.category);
    const fileName = `${article.date}-${slugify(article.title) || 'article-' + article.id}.md`;
    const folder = cat ? cat.slug : 'uncategorized';
    markdownFiles.push({
      path: `${folder}/${fileName}`,
      content: articleMarkdown(article)
    });
  }

  let readme = `# Commonplace Export\n\n`;
  readme += `Exported on ${new Date().toLocaleString()}\n\n`;
  readme += `## Articles by Category\n\n`;

  for (const cat of CATEGORIES) {
    const items = articles.filter(a => a.category === cat.slug).sort((a, b) => b.date.localeCompare(a.date));
    if (items.length > 0) {
      readme += `### ${cat.name} (${items.length})\n\n`;
      readme += `${cat.description}\n\n`;
      for (const item of items) {
        readme += `- [${item.title}](${cat.slug}/${item.date}-${slugify(item.title) || 'article-' + item.id}.md) — ${item.date}\n`;
      }
      readme += `\n`;
    }
  }

  // Browsers throttle rapid-fire downloads, so space them out slightly.
  for (const file of markdownFiles) {
    const pathParts = file.path.split('/');
    downloadBlob(new Blob([file.content], { type: 'text/markdown;charset=utf-8' }), `${pathParts[0]}-${pathParts[pathParts.length - 1]}`);
    await sleep(250);
  }
  downloadBlob(new Blob([readme], { type: 'text/markdown;charset=utf-8' }), 'README-export.md');

  showToast(`📤 Exported ${articles.length} articles as markdown files`, 'success', 4000);
}

// ---------- Navigation ----------
function markViewActive(view) {
  document.querySelectorAll(`[data-view="${view}"]:not(.spine-tab):not(.mobile-tab)`).forEach(el => el.classList.add('active'));
}

function navigateTo(view, opts = {}) {
  stopListening();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.spine-link, .spine-tab, .mobile-tab').forEach(el => el.classList.remove('active'));

  const titles = { home: 'The Commonplace', write: 'Write', articles: 'All Articles', article: 'Article' };
  document.getElementById('topbar-title').textContent = titles[view] || 'The Commonplace';

  closeMobileDrawer();

  if (view === 'home') {
    markViewActive('home');
    renderHome();
  }
  if (view === 'write') {
    markViewActive('write');
    if (!opts.keepForm) resetWriteForm();
  }
  if (view === 'articles') {
    markViewActive('articles');
    if (opts.category !== undefined) {
      document.getElementById('articles-category-filter').value = opts.category;
    }
    const activeCat = document.getElementById('articles-category-filter').value;
    if (activeCat) {
      document.querySelectorAll(`.spine-tab[data-category="${activeCat}"], .mobile-tab[data-category="${activeCat}"]`).forEach(el => el.classList.add('active'));
    }
    renderArticlesList();
  }
  if (view === 'article' && opts.id !== undefined) {
    openArticle(opts.id);
  }
  try {
    if (view === 'article' && opts.id !== undefined) {
      history.replaceState(null, '', `#/article/${opts.id}`);
    } else if (view === 'articles' && document.getElementById('articles-category-filter').value) {
      history.replaceState(null, '', `#/category/${document.getElementById('articles-category-filter').value}`);
    } else {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function routeFromHash() {
  const articleMatch = location.hash.match(/^#\/article\/(\d+)$/);
  const categoryMatch = location.hash.match(/^#\/category\/([a-z-]+)$/);
  if (articleMatch) {
    navigateTo('article', { id: parseInt(articleMatch[1], 10) });
  } else if (categoryMatch) {
    navigateTo('articles', { category: categoryMatch[1] });
  } else {
    navigateTo('home');
  }
}

function toggleMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const isOpen = drawer.classList.toggle('open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', isOpen);
  let backdrop = document.querySelector('.drawer-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.addEventListener('click', closeMobileDrawer);
    document.body.appendChild(backdrop);
  }
  backdrop.classList.toggle('open', isOpen);
}

function closeMobileDrawer() {
  document.getElementById('mobile-drawer').classList.remove('open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
  document.querySelector('.drawer-backdrop')?.classList.remove('open');
}

function renderCategoryNav() {
  const counts = {};
  CATEGORIES.forEach(c => counts[c.slug] = 0);
  articles.forEach(a => { if (counts[a.category] !== undefined) counts[a.category]++; });

  const spineOut = document.getElementById('spine-tabs');
  spineOut.innerHTML = CATEGORIES.map(c => `
    <a class="spine-tab" href="${c.slug}.html" data-view="articles" data-category="${c.slug}" title="${escapeHtml(c.description)}">
      <span class="dot" style="background:${c.color}"></span>
      <span class="name">${c.name}</span>
      <span class="count">${counts[c.slug]}</span>
    </a>
  `).join('');

  const mobileOut = document.getElementById('mobile-tabs');
  mobileOut.innerHTML = CATEGORIES.map(c => `
    <a class="mobile-tab" href="${c.slug}.html" data-view="articles" data-category="${c.slug}">
      <span class="dot" style="background:${c.color}"></span>
      <span class="name">${c.name}</span>
      <span style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--faint);">${counts[c.slug]}</span>
    </a>
  `).join('');

  document.querySelectorAll('.spine-tab, .mobile-tab').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('articles', { category: el.getAttribute('data-category') });
    });
  });
}

function populateCategorySelects() {
  const writeSelect = document.getElementById('entry-category');
  writeSelect.innerHTML = CATEGORIES.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
  const filterSelect = document.getElementById('articles-category-filter');
  filterSelect.innerHTML = `<option value="">All sections</option>` + CATEGORIES.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');
  updateEntryCategoryHint();
}

function updateEntryCategoryHint() {
  const hint = document.getElementById('entry-category-hint');
  if (!hint) return;
  const cat = categoryOf(document.getElementById('entry-category').value);
  hint.textContent = cat ? cat.description : '';
}

function renderHome() {
  const counts = {};
  CATEGORIES.forEach(c => counts[c.slug] = 0);
  articles.forEach(a => { if (counts[a.category] !== undefined) counts[a.category]++; });
  const max = Math.max(1, ...Object.values(counts));

  const shelfOut = document.getElementById('shelf-rows');
  shelfOut.innerHTML = CATEGORIES.map(c => `
    <div class="shelf-row" data-category="${c.slug}" title="${escapeHtml(c.description)}">
      <div class="shelf-label"><span class="shelf-dot" style="background:${c.color}"></span>${c.name}</div>
      <div class="shelf-track"><div class="shelf-fill" style="width:${(counts[c.slug] / max * 100).toFixed(1)}%;background:${c.color};"></div></div>
      <div class="shelf-count">${counts[c.slug]}</div>
    </div>
  `).join('');
  shelfOut.querySelectorAll('.shelf-row').forEach(el => {
    el.addEventListener('click', () => navigateTo('articles', { category: el.getAttribute('data-category') }));
  });

  renderLatestEntry();

  const recentOut = document.getElementById('recent-list');
  const recent = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 8);
  document.getElementById('recent-count-label').textContent = articles.length ? `(${articles.length} total)` : '';
  if (recent.length === 0) {
    recentOut.innerHTML = `<div class="empty-state"><span class="glyph">✒️</span>Nothing written yet. Start with your first entry.</div>`;
  } else {
    recentOut.innerHTML = recent.map(a => {
      const cat = categoryOf(a.category);
      return `
        <div class="recent-item" data-id="${a.id}">
          <span class="rt-title">${escapeHtml(a.title)}</span>
          <span class="rt-meta">
            ${cat ? `<span class="rt-cat" style="color:${cat.color};">${cat.name}</span>` : ''}
            <span class="rt-date">${a.date}</span>
          </span>
        </div>`;
    }).join('');
    recentOut.querySelectorAll('.recent-item').forEach(el => {
      el.addEventListener('click', () => navigateTo('article', { id: parseInt(el.getAttribute('data-id'), 10) }));
    });
  }

  loadAds();
}

function renderLatestEntry() {
  const container = document.getElementById('latest-entry-content');
  if (!container) return;
  if (!articles.length) {
    container.innerHTML = `<p class="latest-entry-empty">Nothing published yet — the first entry is still being written.</p>`;
    return;
  }
  const latest = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
  const cat = categoryOf(latest.category);
  const snippet = latest.summary || shareSnippet(latest);
  container.innerHTML = `
    <div class="latest-entry-meta">
      ${cat ? `<span class="category-tag" style="color:${cat.color};border-color:${cat.color};background:rgba(33,49,43,0.06);">${cat.name}</span>` : ''}
      <span class="rt-date">${latest.date}</span>
    </div>
    <h3 class="latest-entry-title" data-id="${latest.id}">${escapeHtml(latest.title)}</h3>
    <p class="latest-entry-snippet">${escapeHtml(snippet)}</p>
    <button class="btn-primary btn-sm" id="latest-entry-read-btn">Continue reading</button>
  `;
  const openLatest = () => navigateTo('article', { id: latest.id });
  container.querySelector('.latest-entry-title').addEventListener('click', openLatest);
  document.getElementById('latest-entry-read-btn').addEventListener('click', openLatest);
}

function resetWriteForm() {
  editingId = null;
  pendingPhoto = null;
  pendingPhotoFile = null;
  pendingVideoFile = null;
  document.getElementById('write-title').textContent = 'Write a new entry';
  document.getElementById('entry-title').value = '';
  document.getElementById('entry-category').value = CATEGORIES[0].slug;
  document.getElementById('entry-date').value = todayISO();
  document.getElementById('entry-format').value = 'text';
  document.getElementById('entry-body').value = '';
  document.getElementById('entry-summary').value = '';
  document.getElementById('entry-tags').value = '';
  document.getElementById('ai-generate-status').textContent = '';
  document.getElementById('entry-photo').value = '';
  document.getElementById('entry-video').value = '';
  document.getElementById('entry-photo-preview').innerHTML = '';
  document.getElementById('entry-video-preview').innerHTML = '';
  document.getElementById('entry-save-btn').textContent = 'Save entry';
  document.getElementById('entry-cancel-btn').style.display = 'none';
  updateEntryCategoryHint();
  updateEntryFormatUI();
}

function updateEntryFormatUI() {
  const isHtml = document.getElementById('entry-format').value === 'html';
  const label = document.getElementById('entry-body-label');
  const body = document.getElementById('entry-body');
  if (isHtml) {
    label.textContent = 'Entry (raw HTML)';
    body.placeholder = 'Paste your HTML here — e.g. <p>, <h2>, <blockquote>, <ul> tags will render as written. Scripts and event handlers are stripped for safety.';
  } else {
    label.textContent = 'Entry';
    body.placeholder = 'Write freely. Paragraphs break on blank lines.';
  }
}

function loadEntryForEdit(id) {
  const a = articles.find(x => x.id === id);
  if (!a) return;
  editingId = id;
  pendingPhoto = null;
  pendingPhotoFile = null;
  pendingVideoFile = null;
  document.getElementById('write-title').textContent = 'Editing entry';
  document.getElementById('entry-title').value = a.title;
  document.getElementById('entry-category').value = a.category;
  document.getElementById('entry-date').value = a.date;
  document.getElementById('entry-format').value = a.contentType === 'html' ? 'html' : 'text';
  document.getElementById('entry-body').value = a.body;
  document.getElementById('entry-summary').value = a.summary || '';
  document.getElementById('entry-tags').value = (a.tags && a.tags.length) ? a.tags.join(', ') : '';
  document.getElementById('ai-generate-status').textContent = '';
  document.getElementById('entry-photo').value = '';
  document.getElementById('entry-video').value = '';
  const photoPreview = document.getElementById('entry-photo-preview');
  photoPreview.innerHTML = a.photo ? `<img class="media-preview-thumb" src="${escapeHtml(a.photo)}" alt="Current photo">` : '';
  const videoPreview = document.getElementById('entry-video-preview');
  if (a.video) {
    videoPreview.innerHTML = `<video class="media-preview-thumb" controls playsinline preload="metadata" src="${escapeHtml(a.video)}"></video>`;
  } else {
    videoPreview.innerHTML = '';
  }
  document.getElementById('entry-save-btn').textContent = 'Update entry';
  document.getElementById('entry-cancel-btn').style.display = '';
  updateEntryCategoryHint();
  updateEntryFormatUI();
  navigateTo('write', { keepForm: true });
}

const GITHUB_SETTINGS_KEY = 'commonplace-github-settings';
let githubSettings = { username: 'pansensoyglenn-dev', repo: 'current-situation', branch: 'main', token: '', autoDeploy: true };

async function loadGithubSettings() {
  try {
    const res = await window.storage.get(GITHUB_SETTINGS_KEY);
    if (res && res.value) githubSettings = { ...githubSettings, ...JSON.parse(res.value) };
  } catch (e) { }
  setVal('gh-username', githubSettings.username || '');
  setVal('gh-repo', githubSettings.repo || '');
  setVal('gh-branch', githubSettings.branch || 'main');
  setVal('gh-token', githubSettings.token || '');
  setChecked('gh-autodeploy', githubSettings.autoDeploy);
}

async function saveGithubSettings() {
  githubSettings = {
    username: document.getElementById('gh-username').value.trim(),
    repo: document.getElementById('gh-repo').value.trim(),
    branch: document.getElementById('gh-branch').value.trim() || 'main',
    token: document.getElementById('gh-token').value.trim(),
    autoDeploy: document.getElementById('gh-autodeploy').checked
  };
  try {
    await window.storage.set(GITHUB_SETTINGS_KEY, JSON.stringify(githubSettings));
    setText('gh-status', githubSettings.autoDeploy
      ? '✅ Saved. New articles will auto-deploy to GitHub.'
      : '✅ Saved. Auto-deploy is currently off.');
    showToast('✅ GitHub settings saved', 'success');
  } catch (e) {
    showToast('⚠️ Could not save GitHub settings', 'error');
  }
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const AI_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const AI_SETTINGS_KEY = 'commonplace-ai-settings';
let aiSettings = { apiKey: '', model: AI_DEFAULT_MODEL, autoGenerate: false };

async function loadAiSettings() {
  try {
    const res = await window.storage.get(AI_SETTINGS_KEY);
    if (res && res.value) aiSettings = { ...aiSettings, ...JSON.parse(res.value) };
  } catch (e) { }
  setVal('ai-api-key', aiSettings.apiKey || '');
  setVal('ai-model', aiSettings.model || AI_DEFAULT_MODEL);
  setChecked('ai-autogenerate', aiSettings.autoGenerate);
}

async function saveAiSettings() {
  aiSettings = {
    apiKey: document.getElementById('ai-api-key').value.trim(),
    model: document.getElementById('ai-model').value || AI_DEFAULT_MODEL,
    autoGenerate: document.getElementById('ai-autogenerate').checked
  };
  try {
    await window.storage.set(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
    setText('ai-status', aiSettings.autoGenerate
      ? '✅ Saved. New articles will auto-generate a summary and tags if left blank.'
      : '✅ Saved. Auto-generate is currently off — use the "Generate with AI" button when writing.');
    showToast('✅ AI settings saved', 'success');
  } catch (e) {
    showToast('⚠️ Could not save AI settings', 'error');
  }
}

function extractJsonBlock(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch (e) { return null; }
}

function normalizeTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (let t of raw) {
    t = String(t).trim().toLowerCase().replace(/^#/, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

async function generateSummaryAndTags(title, body) {
  if (!aiSettings.apiKey) throw new Error('Add an Anthropic API key in the AI Summary & Tags card on Home first');
  const plainBody = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': aiSettings.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: aiSettings.model || AI_DEFAULT_MODEL,
      max_tokens: 300,
      system: 'You summarize personal essays. Reply with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape: {"summary": "one or two plain sentences", "tags": ["short-tag", "short-tag"]}. Use 3 to 6 short lowercase tags, no hashtags, no punctuation.',
      messages: [{ role: 'user', content: `Title: ${title}\n\nEssay:\n${plainBody}` }]
    })
  });
  if (!res.ok) {
    let msg = `AI request failed (${res.status})`;
    try { const errBody = await res.json(); if (errBody.error && errBody.error.message) msg = errBody.error.message; } catch (e) { }
    throw new Error(msg);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  const parsed = extractJsonBlock(textBlock ? textBlock.text : '');
  if (!parsed || !parsed.summary) throw new Error('Could not parse a summary from the AI response');
  return { summary: String(parsed.summary).trim(), tags: normalizeTags(parsed.tags) };
}

// Fills in a missing summary/tags and returns the up-to-date article.
// It no longer triggers its own GitHub deploy — saveEntry runs AI first, then deploys once,
// so articles aren't deployed (and posted to Facebook) twice.
async function maybeAutoGenerateAI(article) {
  if (!aiSettings.autoGenerate || !aiSettings.apiKey) return article;
  const needSummary = !article.summary;
  const needTags = !(article.tags && article.tags.length);
  if (!needSummary && !needTags) return article;
  try {
    const { summary, tags } = await generateSummaryAndTags(article.title, article.body);
    const idx = articles.findIndex(x => x.id === article.id);
    if (idx === -1) return article;
    if (needSummary) articles[idx].summary = summary;
    if (needTags) articles[idx].tags = tags;
    await saveArticleToDb(articles[idx]);
    if (currentArticleId === article.id) openArticle(article.id);
    renderArticlesList();
    renderHome();
    return articles[idx];
  } catch (e) {
    console.warn('Auto AI generation failed:', e);
    showToast(`⚠️ AI auto-generation failed: ${e.message}`, 'error', 5000);
    return article;
  }
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function b64EncodeUnicode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// String values are JSON-quoted (valid YAML) so titles containing ":" or quotes don't break Jekyll.
function articleMarkdown(article) {
  const cat = categoryOf(article.category);
  let md = `---\n`;
  md += `title: ${JSON.stringify(article.title)}\n`;
  md += `date: ${article.date}\n`;
  md += `category: ${article.category}\n`;
  md += `category_name: ${JSON.stringify(cat ? cat.name : 'Uncategorized')}\n`;
  if (article.contentType === 'html') md += `content_type: html\n`;
  if (article.summary) md += `summary: ${JSON.stringify(article.summary.replace(/\s*\n\s*/g, ' '))}\n`;
  if (article.tags && article.tags.length) md += `tags: [${article.tags.map(t => JSON.stringify(t)).join(', ')}]\n`;
  if (article.photo) md += `has_photo: true\n`;
  if (article.video) md += `has_video: true\n`;
  if (article.video) md += `video_url: ${JSON.stringify(article.video)}\n`;
  md += `---\n\n`;
  md += article.body;
  return md;
}

async function githubGetSha(path) {
  const { username, repo, branch, token } = githubSettings;
  const url = `https://api.github.com/repos/${username}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (res.status === 200) {
    const data = await res.json();
    return data.sha;
  }
  return null;
}

async function githubPutFile(path, base64Content, message) {
  const { username, repo, branch, token } = githubSettings;
  const sha = await githubGetSha(path);
  const url = `https://api.github.com/repos/${username}/${repo}/contents/${path}`;
  const body = { message, content: base64Content, branch };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let msg = `GitHub API error ${res.status}`;
    try { const errBody = await res.json(); if (errBody.message) msg = errBody.message; } catch (e) { }
    throw new Error(msg);
  }
  return res.json();
}

function articleStaticHtml(article, cat, canonicalUrl, imageAbsUrl) {
  const title = escapeHtml(article.title);
  const desc = escapeHtml(shareSnippet(article));
  const spaUrl = `${SITE_URL}index.html#/article/${article.id}`;
  const imageTag = imageAbsUrl ? `
  <meta property="og:image" content="${escapeHtml(imageAbsUrl)}">
  <meta property="og:image:width" content="1200">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${escapeHtml(imageAbsUrl)}">` : `
  <meta name="twitter:card" content="summary">`;

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
  <meta property="og:url" content="${canonicalUrl}">${imageTag}
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">

  <link rel="stylesheet" href="${SITE_URL}styles.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Display&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>location.replace(${JSON.stringify(spaUrl)});</script>
</head>
<body>
  <div class="legal-page">
    <a class="back-link" href="${SITE_URL}index.html">← The Commonplace</a>
    <h1>${title}</h1>
    <p class="updated">${cat ? cat.name : ''}${cat ? ' · ' : ''}${article.date}</p>
    <p>${desc}</p>
    <p>Redirecting you to the full article… if nothing happens,
      <a class="inline-link" href="${spaUrl}">click here</a>.
    </p>
  </div>
</body>
</html>
`;
}

async function deployArticleToGitHub(article) {
  if (!githubSettings.autoDeploy) return;
  if (!githubSettings.username || !githubSettings.repo || !githubSettings.token) {
    showToast('⚠️ GitHub auto-deploy is on but settings are incomplete — check the Home page', 'error', 5000);
    return;
  }
  const wasDeployed = !!article.pageUrl; // only auto-post to Facebook the FIRST time
  const cat = categoryOf(article.category);
  const folder = cat ? cat.slug : 'uncategorized';
  const slug = slugify(article.title) || `article-${article.id}`;
  const mdPath = `${folder}/${article.date}-${slug}.md`;
  const pagePath = `${folder}/${article.date}-${slug}.html`;

  try {
    await githubPutFile(mdPath, b64EncodeUnicode(articleMarkdown(article)), `Add/update article: ${article.title}`);

    let photoPath = null;
    let imageAbsUrl = null;
    if (article.photo && /^https?:\/\//.test(article.photo)) {
      imageAbsUrl = article.photo;
    } else if (article.photo) {
      const match = article.photo.match(/^data:image\/(\w+);base64,(.*)$/);
      if (match) {
        const [, ext, base64Only] = match;
        const extClean = ext === 'jpeg' ? 'jpg' : ext;
        photoPath = `${folder}/${article.date}-${slug}.${extClean}`;
        await githubPutFile(photoPath, base64Only, `Add photo for: ${article.title}`);
        imageAbsUrl = `${SITE_URL}${photoPath}`;
      }
    }
    if (!imageAbsUrl) imageAbsUrl = cat ? `${SITE_URL}covers/${cat.slug}.jpg` : null;

    const liveUrl = `${SITE_URL}${pagePath}`;
    const canonicalUrl = `${CANONICAL_URL}${pagePath}`;
    const pageHtml = articleStaticHtml(article, cat, canonicalUrl, imageAbsUrl);
    await githubPutFile(pagePath, b64EncodeUnicode(pageHtml), `Add share page for: ${article.title}`);

    const githubUrl = `https://github.com/${githubSettings.username}/${githubSettings.repo}/blob/${githubSettings.branch}/${mdPath}`;
    const idx = articles.findIndex(x => x.id === article.id);
    if (idx !== -1) {
      articles[idx].githubUrl = githubUrl;
      articles[idx].pageUrl = liveUrl;
      await saveArticleToDb(articles[idx]);
      if (currentArticleId === article.id) updateShareLinks(articles[idx]);
      if (!wasDeployed) maybeAutoPostFacebook(articles[idx]);
    }

    showToast('🚀 Deployed — share links now carry a preview image', 'success', 4000);
  } catch (e) {
    console.error('GitHub deploy failed:', e);
    showToast(`⚠️ GitHub deploy failed: ${e.message}`, 'error', 6000);
  }
}

const FB_SETTINGS_KEY = 'commonplace-fb-settings';
let fbSettings = { pageId: '', accessToken: '', autoPost: false };

async function loadFbSettings() {
  try {
    const res = await window.storage.get(FB_SETTINGS_KEY);
    if (res && res.value) fbSettings = { ...fbSettings, ...JSON.parse(res.value) };
  } catch (e) { }
  setVal('fb-page-id', fbSettings.pageId || '');
  setVal('fb-access-token', fbSettings.accessToken || '');
  setChecked('fb-autopost', fbSettings.autoPost);
}

async function saveFbSettings() {
  fbSettings = {
    pageId: document.getElementById('fb-page-id').value.trim(),
    accessToken: document.getElementById('fb-access-token').value.trim(),
    autoPost: document.getElementById('fb-autopost').checked
  };
  try {
    await window.storage.set(FB_SETTINGS_KEY, JSON.stringify(fbSettings));
    setText('fb-status', fbSettings.autoPost
      ? '✅ Saved. Every newly deployed article will auto-post to your Page.'
      : '✅ Saved. Auto-post is currently off — use "Post to Facebook" on an article to post manually.');
    showToast('✅ Facebook settings saved', 'success');
  } catch (e) {
    showToast('⚠️ Could not save Facebook settings', 'error');
  }
}

async function postToFacebook(article) {
  if (!fbSettings.pageId || !fbSettings.accessToken) {
    showToast('⚠️ Add your Facebook Page ID and access token on the Home page first', 'error', 5000);
    return false;
  }
  if (!article.pageUrl) {
    showToast('⚠️ Deploy this article to GitHub first so it has a real public link to post', 'error', 5000);
    return false;
  }
  const link = article.pageUrl;
  const cat = categoryOf(article.category);
  const message = `${article.title}${cat ? ' — ' + cat.name : ''}\n\n${shareSnippet(article)}`;
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${fbSettings.pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, link, access_token: fbSettings.accessToken })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error((data.error && data.error.message) || `Facebook API error (${res.status})`);
    }
    showToast('📘 Posted to Facebook', 'success', 4000);
    return true;
  } catch (e) {
    console.error('Facebook post failed:', e);
    showToast(`⚠️ Facebook post failed: ${e.message}`, 'error', 6000);
    return false;
  }
}

// After a GitHub commit, the host (Vercel) needs a minute to rebuild. Posting before the page is
// live makes Facebook cache a 404 with no preview, so wait for the URL to respond first.
async function waitForUrlLive(url, timeoutMs = 240000, intervalMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return true;
    } catch (e) {
      // Cross-origin / blocked — can't read the status, so just wait a fixed time.
      await sleep(45000);
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

async function maybeAutoPostFacebook(article) {
  if (!fbSettings.autoPost) return;
  showToast('⏳ Waiting for the page to go live before posting to Facebook…', 'info', 4000);
  const live = await waitForUrlLive(article.pageUrl);
  if (!live) {
    showToast('⚠️ Page still not live — use "Post to Facebook" on the article once it is', 'error', 6000);
    return;
  }
  await postToFacebook(article);
}

async function saveEntry() {
  const title = document.getElementById('entry-title').value.trim();
  const category = document.getElementById('entry-category').value;
  const date = document.getElementById('entry-date').value || todayISO();
  const contentType = document.getElementById('entry-format').value === 'html' ? 'html' : 'text';
  const body = document.getElementById('entry-body').value.trim();
  const summary = document.getElementById('entry-summary').value.trim();
  const tags = normalizeTags(document.getElementById('entry-tags').value);

  if (!title) { showToast('⚠️ Give it a title', 'error'); return; }
  if (!body) { showToast('⚠️ Write something first', 'error'); return; }

  const saveBtn = document.getElementById('entry-save-btn');
  const oldBtnLabel = saveBtn.textContent;
  saveBtn.disabled = true;

  const existing = editingId ? articles.find(a => a.id === editingId) : null;

  let photo = existing ? existing.photo || null : null;
  if (pendingPhotoFile) {
    // pendingPhotoFile was already downscaled when it was chosen — don't re-encode it again.
    saveBtn.textContent = 'Uploading photo…';
    try {
      photo = await apiUploadPhoto(pendingPhotoFile);
    } catch (e) {
      console.error('Photo upload failed:', e);
      showToast(`⚠️ Photo upload failed: ${e.message}`, 'error', 6000);
      saveBtn.disabled = false;
      saveBtn.textContent = oldBtnLabel;
      return;
    }
  }

  let video = existing ? existing.video || null : null;
  if (pendingVideoFile) {
    saveBtn.textContent = 'Uploading video… 0%';
    try {
      video = await storeVideoFile(pendingVideoFile, (p) => {
        saveBtn.textContent = `Uploading video… ${Math.round(p * 100)}%`;
      });
    } catch (e) {
      console.error('Video upload failed:', e);
      showToast(`⚠️ Failed to upload video: ${e.message}`, 'error', 6000);
      saveBtn.disabled = false;
      saveBtn.textContent = oldBtnLabel;
      return;
    }
  }

  saveBtn.textContent = editingId ? 'Updating…' : 'Saving…';
  const draft = { title, category, date, contentType, body, summary, tags, photo, video };

  try {
    let savedArticle;
    if (editingId) {
      const idx = articles.findIndex(a => a.id === editingId);
      const row = await apiUpdateArticle(editingId, articleToApiPayload({ ...articles[idx], ...draft }));
      savedArticle = mapDbArticleToLocal(row);
      if (idx !== -1) articles[idx] = savedArticle;
      else articles.push(savedArticle);
    } else {
      const row = await apiCreateArticle(articleToApiPayload(draft));
      savedArticle = mapDbArticleToLocal(row);
      articles.push(savedArticle);
    }

    showToast(editingId ? '✅ Entry updated' : '✅ Entry saved', 'success');
    resetWriteForm();
    renderCategoryNav();
    navigateTo('article', { id: savedArticle.id });

    // Run in order: AI summary/tags first, then a single deploy.
    (async () => {
      const latest = await maybeAutoGenerateAI(savedArticle);
      await deployArticleToGitHub(latest);
    })();
  } catch (e) {
    console.error('Save failed:', e);
    showToast(`⚠️ Save failed: ${e.message}`, 'error', 6000);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = editingId ? 'Update entry' : 'Save entry';
  }
}

function renderArticlesList() {
  const categoryFilter = document.getElementById('articles-category-filter').value;
  const searchText = document.getElementById('articles-search').value.trim().toLowerCase();
  const cat = categoryOf(categoryFilter);
  document.getElementById('articles-title').textContent = cat ? cat.name : 'All Articles';

  const introEl = document.getElementById('articles-category-intro');
  const coverEl = document.getElementById('articles-category-cover');
  if (cat) {
    introEl.textContent = cat.description;
    introEl.style.borderLeftColor = cat.color;
    introEl.style.display = '';
    attachSectionCover(coverEl, cat.slug);
  } else {
    introEl.style.display = 'none';
    if (coverEl) { coverEl.style.display = 'none'; coverEl.innerHTML = ''; }
  }

  let list = [...articles];
  if (categoryFilter) list = list.filter(a => a.category === categoryFilter);
  if (searchText) {
    list = list.filter(a =>
      a.title.toLowerCase().includes(searchText) ||
      (a.tags || []).some(t => t.includes(searchText))
    );
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const out = document.getElementById('articles-list');
  if (list.length === 0) {
    out.innerHTML = `<div class="empty-state"><span class="glyph">📭</span>No entries here yet.</div>`;
    return;
  }
  out.innerHTML = list.map(a => {
    const c = categoryOf(a.category);
    const tagsHtml = (a.tags && a.tags.length)
      ? `<div class="tag-row tag-row-sm">${a.tags.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    return `
      <div class="article-row" data-id="${a.id}">
        <div>
          <div class="ar-title">${escapeHtml(a.title)}</div>
          <div class="ar-meta">${a.date}</div>
          ${tagsHtml}
        </div>
        ${c ? `<span class="category-tag" style="color:${c.color};border-color:${c.color};background:rgba(33,49,43,0.06);">${c.name}</span>` : ''}
      </div>`;
  }).join('');
  out.querySelectorAll('.tag-chip').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('articles-search').value = el.getAttribute('data-tag');
      renderArticlesList();
    });
  });
  out.querySelectorAll('.article-row').forEach(el => {
    el.addEventListener('click', () => navigateTo('article', { id: parseInt(el.getAttribute('data-id'), 10) }));
  });
}

function openArticle(id) {
  stopListening();
  const a = articles.find(x => x.id === id);
  if (!a) { navigateTo('articles'); return; }
  currentArticleId = id;
  const c = categoryOf(a.category);

  document.getElementById('article-category-tag').textContent = c ? c.name : '';
  document.getElementById('article-category-tag').style.cssText = c ? `color:${c.color};border-color:${c.color};background:rgba(33,49,43,0.06);` : '';
  document.getElementById('article-date').textContent = a.date;
  document.getElementById('article-title').textContent = a.title;

  const tagsEl = document.getElementById('article-tags');
  tagsEl.innerHTML = (a.tags && a.tags.length)
    ? a.tags.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join('')
    : '';
  tagsEl.querySelectorAll('.tag-chip').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo('articles', { category: '' });
      document.getElementById('articles-category-filter').value = '';
      document.getElementById('articles-search').value = el.getAttribute('data-tag');
      renderArticlesList();
    });
  });

  const summaryEl = document.getElementById('article-summary');
  if (a.summary) {
    summaryEl.textContent = a.summary;
    summaryEl.style.display = '';
  } else {
    summaryEl.textContent = '';
    summaryEl.style.display = 'none';
  }

  const bodyEl = document.getElementById('article-body');
  if (a.contentType === 'html') {
    bodyEl.innerHTML = sanitizeHtml(a.body);
  } else {
    bodyEl.innerHTML = a.body.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
  }

  const mediaOut = document.getElementById('article-media');
  const parts = [];
  if (a.photo) parts.push(`<img class="article-photo" src="${escapeHtml(a.photo)}" alt="${escapeHtml(a.title)}">`);
  if (a.video) {
    parts.push(`<video class="article-video" controls playsinline preload="metadata" src="${escapeHtml(a.video)}"></video>`);
  }
  mediaOut.innerHTML = parts.join('');
  hydrateVideoElements(mediaOut);

  updateShareLinks(a);
  loadAds();
}

function articleShareUrl(a) {
  if (a.pageUrl) return a.pageUrl;
  return `${SITE_URL}#/article/${a.id}`;
}

function shareSnippet(a) {
  if (a.summary) return a.summary;
  const plain = a.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 180) + (plain.length > 180 ? '…' : '');
}

function updateShareLinks(a) {
  const c = categoryOf(a.category);
  const snippet = shareSnippet(a);
  const shareText = `${a.title}${c ? ' · ' + c.name : ''} — ${snippet}`;
  const shareUrl = articleShareUrl(a);
  const url = encodeURIComponent(shareUrl);
  const text = encodeURIComponent(shareText);
  const title = encodeURIComponent(a.title);

  const setHref = (id, href) => { const el = document.getElementById(id); if (el) el.href = href; };
  setHref('share-fb', `https://www.facebook.com/sharer/sharer.php?u=${url}`);
  setHref('share-x', `https://twitter.com/intent/tweet?text=${text}&url=${url}`);
  setHref('share-linkedin', `https://www.linkedin.com/sharing/share-offsite/?url=${url}`);
  setHref('share-whatsapp', `https://api.whatsapp.com/send?text=${text}%20${url}`);
  setHref('share-telegram', `https://t.me/share/url?url=${url}&text=${text}`);
  setHref('share-reddit', `https://www.reddit.com/submit?url=${url}&title=${title}`);
  setHref('share-email', `mailto:?subject=${title}&body=${text}%0A%0A${url}`);

  const noteEl = document.getElementById('share-link-note');
  if (noteEl) {
    if (!a.pageUrl) {
      noteEl.textContent = '⚠️ This link only opens the article on this device — turn on GitHub auto-deploy so links work for anyone and carry a preview image.';
    } else if (!a.photo && !categoryOf(a.category)) {
      noteEl.textContent = '';
    } else if (!a.photo) {
      noteEl.textContent = 'ℹ️ No photo on this article — the Facebook/social preview will fall back to the section cover, if one exists.';
    } else {
      noteEl.textContent = '';
    }
  }
}

async function deleteCurrentArticle() {
  if (!currentArticleId) return;
  if (!confirm('Delete this entry? This can\'t be undone.')) return;
  stopListening();
  try {
    await apiDeleteArticle(currentArticleId);
  } catch (e) {
    console.error('Delete failed:', e);
    showToast(`⚠️ Delete failed: ${e.message}`, 'error', 6000);
    return;
  }
  articles = articles.filter(a => a.id !== currentArticleId);
  currentArticleId = null;
  showToast('🗑️ Entry deleted', 'success');
  renderCategoryNav();
  navigateTo('articles');
}

function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

async function photoToFile(photoValue, filename) {
  if (!photoValue) return null;
  if (photoValue.startsWith('data:')) return dataUrlToFile(photoValue, filename);
  const res = await fetch(photoValue);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadBackup() {
  const statusEl = document.getElementById('backup-download-status');
  const btn = document.getElementById('backup-download-btn');
  if (!articles.length && !confirm('There are no articles loaded (the database may be unreachable). Download an empty backup anyway?')) return;
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = '💾 Preparing…';
  statusEl.textContent = '';
  try {
    const backup = {
      backupVersion: 2,
      exportedAt: new Date().toISOString(),
      articles,
      nextId,
      githubSettings,
      aiSettings,
      fbSettings
    };

    downloadBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      `commonplace-backup-${todayISO()}.json`
    );

    statusEl.textContent = '✅ Backup downloaded. (Videos live on Backblaze — URLs are stored in the article records. The file also contains your saved tokens/API key, so keep it private.)';
    showToast('💾 Backup downloaded', 'success');
  } catch (e) {
    console.error('Backup failed:', e);
    showToast(`⚠️ Backup failed: ${e.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

async function restoreFromBackup() {
  const jsonInput = document.getElementById('restore-json-input');
  const statusEl = document.getElementById('backup-restore-status');
  const btn = document.getElementById('backup-restore-btn');
  const jsonFile = jsonInput.files && jsonInput.files[0];
  if (!jsonFile) { showToast('⚠️ Choose a backup .json file first', 'error'); return; }
  if (!confirm('Restoring will replace all articles currently in the database with the ones in this file. Continue?')) return;

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = '📥 Restoring…';
  statusEl.textContent = '';

  try {
    const text = await jsonFile.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.articles)) {
      throw new Error("That file doesn't look like a Commonplace backup");
    }

    // Snapshot what's there now. Old rows are removed only AFTER every backup article was
    // created successfully, so a failed restore never loses data (and a good one never duplicates).
    const oldIds = articles.map(a => a.id);
    let created = 0;
    let failed = 0;

    for (const orig of data.articles) {
      try {
        let videoUrl = orig.video || null;
        if (videoUrl && videoUrl.startsWith('blobref:')) videoUrl = null;

        await apiCreateArticle({
          title: orig.title,
          category: orig.category,
          date: orig.date,
          contentType: orig.contentType || 'text',
          body: orig.body,
          summary: orig.summary || '',
          tags: orig.tags || [],
          photoUrl: orig.photo || null,
          videoUrl,
          githubUrl: orig.githubUrl || null,
          pageUrl: orig.pageUrl || null
        });
        created++;
      } catch (e) {
        console.warn('Failed to restore article', orig.title, e);
        failed++;
      }
    }

    let removeFailed = 0;
    if (failed === 0) {
      for (const id of oldIds) {
        try { await apiDeleteArticle(id); } catch (e) { removeFailed++; }
      }
    }

    await loadArticles();

    if (data.githubSettings) {
      githubSettings = { ...githubSettings, ...data.githubSettings };
      await window.storage.set(GITHUB_SETTINGS_KEY, JSON.stringify(githubSettings));
      await loadGithubSettings();
    }
    if (data.aiSettings) {
      aiSettings = { ...aiSettings, ...data.aiSettings };
      await window.storage.set(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
      await loadAiSettings();
    }
    if (data.fbSettings) {
      fbSettings = { ...fbSettings, ...data.fbSettings };
      await window.storage.set(FB_SETTINGS_KEY, JSON.stringify(fbSettings));
      await loadFbSettings();
    }

    renderCategoryNav();
    navigateTo('home');
    jsonInput.value = '';

    statusEl.textContent = `✅ Restored ${created} article(s).` +
      (failed ? ` ${failed} failed, so your existing articles were kept — check the console and retry.` : '') +
      (removeFailed ? ` ${removeFailed} old article(s) couldn't be removed.` : '') +
      ' Note: restored articles get new IDs, so previously shared #/article/… links may point elsewhere.';
    showToast('📥 Backup restored', 'success', 4000);
  } catch (e) {
    console.error('Restore failed:', e);
    showToast(`⚠️ Restore failed: ${e.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

// ---------- Listen (text-to-speech) ----------
let cachedVoices = [];
let listenActive = false;
let listenToken = 0;

function primeVoices() {
  if (!('speechSynthesis' in window)) return;
  cachedVoices = window.speechSynthesis.getVoices();
  if (!cachedVoices.length) {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices();
    };
  }
}

function pickMaleVoice() {
  const voices = (cachedVoices && cachedVoices.length) ? cachedVoices : window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const femaleHints = /female|zira|samantha|victoria|karen|susan|linda|moira|tessa|fiona|siri female|serena|joanna|salli|kimberly|ivy|kendra/i;
  const maleHints = /male|david|mark|daniel|alex|fred|guy|ryan|tom|james|george|thomas|matthew|justin|joey|brian|eric|arthur|oliver|siri male/i;
  let candidate = voices.find(v => maleHints.test(v.name) && !femaleHints.test(v.name));
  if (!candidate) candidate = voices.find(v => /^en/i.test(v.lang) && !femaleHints.test(v.name));
  return candidate || voices[0];
}

function stopListening() {
  listenToken++;
  listenActive = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  const btn = document.getElementById('article-listen-btn');
  if (btn) btn.textContent = '🔊 Listen';
}

// Long utterances get cut off silently in Chrome, so read the article in sentence-sized chunks.
function chunkText(text, max = 220) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
      continue;
    }
    if (cur && (cur + s).length > max) { chunks.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function toggleListen() {
  if (!('speechSynthesis' in window)) {
    showToast('⚠️ Text-to-speech isn\'t supported in this browser', 'error');
    return;
  }
  const btn = document.getElementById('article-listen-btn');
  if (listenActive || window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    stopListening();
    return;
  }
  const a = articles.find(x => x.id === currentArticleId);
  if (!a) return;

  const spokenBody = a.contentType === 'html'
    ? (document.getElementById('article-body').textContent || '')
    : a.body;
  const chunks = chunkText(`${a.title}. ${spokenBody}`);
  const voice = pickMaleVoice();
  const token = ++listenToken;
  let i = 0;

  const finish = () => { listenActive = false; btn.textContent = '🔊 Listen'; };
  const speakNext = () => {
    if (token !== listenToken) return;
    if (i >= chunks.length) { finish(); return; }
    const utterance = new SpeechSynthesisUtterance(chunks[i++]);
    if (voice) utterance.voice = voice; else utterance.pitch = 0.75;
    utterance.onend = speakNext;
    utterance.onerror = (ev) => {
      if (token !== listenToken) return;
      if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
      finish();
    };
    window.speechSynthesis.speak(utterance);
  };

  listenActive = true;
  btn.textContent = '⏹ Stop';
  speakNext();
}

async function shareCurrentArticle() {
  const a = articles.find(x => x.id === currentArticleId);
  if (!a) return;
  const c = categoryOf(a.category);
  const shareUrl = articleShareUrl(a);
  const caption = `${a.title}${c ? ' · ' + c.name : ''} — ${shareSnippet(a)}`;

  try {
    if (navigator.share) {
      const files = [];
      if (a.video) {
        const videoFile = await videoValueToFile(a.video, `${a.title}.mp4`);
        if (videoFile) files.push(videoFile);
      } else if (a.photo) {
        const photoFile = await photoToFile(a.photo, `${a.title}.jpg`);
        if (photoFile) files.push(photoFile);
      }
      const shareData = { title: a.title, text: caption, url: shareUrl };
      if (files.length && navigator.canShare && navigator.canShare({ files })) {
        // Many apps drop the url field when files are attached, so put the link in the text too.
        shareData.files = files;
        shareData.text = `${caption}\n${shareUrl}`;
        delete shareData.url;
      }
      await navigator.share(shareData);
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    console.warn('Web Share failed, falling back:', e);
  }

  const actions = document.getElementById('share-fallback-actions');
  actions.innerHTML = `
    ${a.video ? `<button class="btn-primary btn-sm" id="share-dl-video">⬇ Download video</button>` : ''}
    ${a.photo ? `<button class="btn-primary btn-sm" id="share-dl-photo">⬇ Download photo</button>` : ''}
    <button class="btn-ghost btn-sm" id="share-copy-text">📋 Copy caption</button>
    <button class="btn-ghost btn-sm" id="share-open-fb">📘 Open Facebook</button>
  `;
  document.getElementById('share-dl-video')?.addEventListener('click', async () => {
    const file = await videoValueToFile(a.video, `${a.title}.mp4`);
    if (file) { downloadBlob(file, `${a.title}.mp4`); showToast('⬇ Video downloaded', 'success'); }
    else showToast('⚠️ Could not fetch the video', 'error');
  });
  document.getElementById('share-dl-photo')?.addEventListener('click', async () => {
    try {
      const file = await photoToFile(a.photo, `${a.title}.jpg`);
      if (file) { downloadBlob(file, `${a.title}.jpg`); showToast('⬇ Photo downloaded', 'success'); }
    } catch (e) { showToast('⚠️ Could not fetch the photo', 'error'); }
  });
  document.getElementById('share-copy-text')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${caption}\n${shareUrl}`); showToast('📋 Caption copied', 'success'); }
    catch (e) { showToast('⚠️ Could not copy — select the text manually', 'error'); }
  });
  document.getElementById('share-open-fb')?.addEventListener('click', () => {
    window.open('https://www.facebook.com/', '_blank', 'noopener');
  });
  document.getElementById('share-fallback-modal').classList.add('open');
}

document.getElementById('share-fallback-close')?.addEventListener('click', () => {
  document.getElementById('share-fallback-modal').classList.remove('open');
});
document.getElementById('share-fallback-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'share-fallback-modal') e.target.classList.remove('open');
});

function renderSearchResults(query) {
  const box = document.getElementById('search-results');
  const q = query.trim().toLowerCase();
  if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }
  const matches = articles.filter(a =>
    a.title.toLowerCase().includes(q) ||
    a.body.toLowerCase().includes(q) ||
    (a.tags || []).some(t => t.includes(q))
  ).slice(0, 15);
  if (matches.length === 0) {
    box.innerHTML = `<div class="search-result-item" style="cursor:default;">No matches for "${escapeHtml(query)}"</div>`;
    box.classList.add('open');
    return;
  }
  box.innerHTML = matches.map(a => {
    const c = categoryOf(a.category);
    return `<div class="search-result-item" data-id="${a.id}"><strong>${escapeHtml(a.title)}</strong><br><span style="display:flex;gap:0.5rem;margin-top:2px;">${c ? `<span style="color:${c.color};font-weight:600;">${c.name}</span>` : ''}<span style="color:var(--faint);font-family:'JetBrains Mono',monospace;">${a.date}</span></span></div>`;
  }).join('');
  box.querySelectorAll('.search-result-item[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      navigateTo('article', { id: parseInt(el.getAttribute('data-id'), 10) });
      document.getElementById('search-input').value = '';
      box.classList.remove('open');
    });
  });
  box.classList.add('open');
}

// Only push ad slots that are visible (AdSense errors on zero-width slots in hidden views)
// and only once each.
function loadAds() {
  try {
    document.querySelectorAll('ins.adsbygoogle:not([data-ad-status]):not([data-ads-pushed])').forEach((el) => {
      if (!el.offsetWidth) return;
      el.setAttribute('data-ads-pushed', '1');
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  } catch (e) {
    console.log('Ad loading:', e);
  }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-view]');
  if (link && !link.classList.contains('spine-tab') && !link.classList.contains('mobile-tab')) {
    e.preventDefault();
    const view = link.getAttribute('data-view');
    // Clicking "All Articles" in the nav should clear any previous category filter.
    navigateTo(view, view === 'articles' ? { category: '' } : {});
  }
  if (!e.target.closest('.topbar-search-wrap')) {
    document.getElementById('search-results')?.classList.remove('open');
  }
});

window.addEventListener('hashchange', routeFromHash);

document.getElementById('menuBtn').addEventListener('click', toggleMobileDrawer);
document.getElementById('entry-save-btn').addEventListener('click', saveEntry);
document.getElementById('entry-category').addEventListener('change', updateEntryCategoryHint);
document.getElementById('entry-format').addEventListener('change', updateEntryFormatUI);

document.getElementById('entry-photo').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const preview = document.getElementById('entry-photo-preview');
  if (!file) { pendingPhoto = null; pendingPhotoFile = null; preview.innerHTML = ''; return; }
  if (!file.type.startsWith('image/')) { showToast('⚠️ Please choose an image file', 'error'); e.target.value = ''; return; }

  let processed = file;
  try {
    processed = await downscaleImageFile(file);
  } catch (err) {
    console.warn('Downscale failed, using original:', err);
  }
  pendingPhotoFile = processed;

  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingPhoto = ev.target.result;
    preview.innerHTML = `<img class="media-preview-thumb" src="${pendingPhoto}" alt="Photo preview">`;
  };
  reader.readAsDataURL(processed);
});

document.getElementById('entry-video').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const preview = document.getElementById('entry-video-preview');
  if (!file) { pendingVideoFile = null; preview.innerHTML = ''; return; }
  if (!file.type.startsWith('video/')) { showToast('⚠️ Please choose a video file', 'error'); e.target.value = ''; return; }
  if (file.size > MAX_VIDEO_BYTES) {
    const limitGB = (MAX_VIDEO_BYTES / 1024 / 1024 / 1024).toFixed(1).replace(/\.0$/, '');
    showToast(`⚠️ That video is too large (limit ~${limitGB}GB)`, 'error', 5000);
    e.target.value = '';
    return;
  }

  pendingVideoFile = file;
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<video class="media-preview-thumb" src="${url}" controls playsinline preload="metadata"></video>`;
});
document.getElementById('entry-cancel-btn').addEventListener('click', () => navigateTo('home'));
document.getElementById('articles-category-filter').addEventListener('change', renderArticlesList);
document.getElementById('articles-search').addEventListener('input', renderArticlesList);
document.getElementById('articles-clear-btn').addEventListener('click', () => {
  document.getElementById('articles-category-filter').value = '';
  document.getElementById('articles-search').value = '';
  renderArticlesList();
});
document.getElementById('article-back-btn').addEventListener('click', () => navigateTo('articles'));
document.getElementById('article-edit-btn').addEventListener('click', () => loadEntryForEdit(currentArticleId));
document.getElementById('article-delete-btn').addEventListener('click', deleteCurrentArticle);
document.getElementById('article-share-btn').addEventListener('click', shareCurrentArticle);
document.getElementById('article-listen-btn').addEventListener('click', toggleListen);
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => renderSearchResults(e.target.value), 120);
});

document.getElementById('export-github-btn')?.addEventListener('click', exportToGitHub);
document.getElementById('backup-download-btn')?.addEventListener('click', downloadBackup);
document.getElementById('backup-restore-btn')?.addEventListener('click', restoreFromBackup);
document.getElementById('migrate-local-btn')?.addEventListener('click', migrateLocalArticles);
document.getElementById('gh-settings-save-btn')?.addEventListener('click', saveGithubSettings);
document.getElementById('ai-settings-save-btn')?.addEventListener('click', saveAiSettings);
document.getElementById('fb-settings-save-btn')?.addEventListener('click', saveFbSettings);
document.getElementById('article-fb-post-btn')?.addEventListener('click', () => {
  const a = articles.find(x => x.id === currentArticleId);
  if (a) postToFacebook(a);
});
document.getElementById('ai-generate-btn')?.addEventListener('click', async () => {
  const title = document.getElementById('entry-title').value.trim();
  const body = document.getElementById('entry-body').value.trim();
  const statusEl = document.getElementById('ai-generate-status');
  const btn = document.getElementById('ai-generate-btn');
  if (!title || !body) { showToast('⚠️ Write a title and entry first', 'error'); return; }
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = '✨ Generating…';
  statusEl.textContent = '';
  try {
    const { summary, tags } = await generateSummaryAndTags(title, body);
    document.getElementById('entry-summary').value = summary;
    document.getElementById('entry-tags').value = tags.join(', ');
    statusEl.textContent = '✅ Generated — review and edit before saving.';
  } catch (e) {
    console.error('AI generate failed:', e);
    showToast(`⚠️ ${e.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
});
document.getElementById('export-json-btn')?.addEventListener('click', () => {
  if (articles.length === 0) {
    showToast('📭 No articles to export', 'error');
    return;
  }
  downloadBlob(
    new Blob([JSON.stringify(articles, null, 2)], { type: 'application/json' }),
    `commonplace-export-${todayISO()}.json`
  );
  showToast(`💾 Exported ${articles.length} articles as JSON`, 'success');
});
document.getElementById('export-html-btn')?.addEventListener('click', () => {
  if (articles.length === 0) {
    showToast('📭 No articles to export', 'error');
    return;
  }

  let html = `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>The Commonplace — Export</title>\n  <style>\n    body { font-family: 'Source Serif 4', serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #2A1A0F; background: #F5F0EA; }\n    h1 { font-size: 2.5rem; border-bottom: 2px solid #C8BDB0; padding-bottom: 0.5rem; color: #3C2A1F; }\n    .article { margin: 2rem 0; padding-bottom: 2rem; border-bottom: 1px solid #C8BDB0; }\n    .article h2 { margin-bottom: 0.25rem; color: #3C2A1F; }\n    .meta { color: #5A4A3A; font-size: 0.9rem; }\n    .category { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 3px; font-size: 0.8rem; background: #EDE8E0; color: #3C2A1F; border: 1px solid #C8BDB0; }\n    .body { margin-top: 1rem; color: #5A4A3A; }\n    .summary { margin-top: 0.5rem; font-style: italic; color: #5A4A3A; }\n    .tags { margin-top: 0.5rem; }\n    .tags span { display: inline-block; margin-right: 0.4rem; font-size: 0.8rem; color: #8B6B4A; }\n  </style>\n</head>\n<body>\n  <h1>The Commonplace — Export</h1>\n  <p style="color:#5A4A3A;">Exported on ${new Date().toLocaleString()} · ${articles.length} articles</p>\n`;

  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  for (const article of sorted) {
    const cat = categoryOf(article.category);
    // Plain-text entries must be escaped, otherwise any "<" in an essay is injected as markup.
    const bodyHtml = article.contentType === 'html'
      ? sanitizeHtml(article.body)
      : escapeHtml(article.body).replace(/\n/g, '<br>');
    const summaryHtml = article.summary ? `\n    <div class="summary">${escapeHtml(article.summary)}</div>` : '';
    const tagsHtml = (article.tags && article.tags.length) ? `\n    <div class="tags">${article.tags.map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>` : '';
    html += `\n  <div class="article">\n    <h2>${escapeHtml(article.title)}</h2>\n    <div class="meta">${article.date}${cat ? ' · <span class="category">' + cat.name + '</span>' : ''}</div>${summaryHtml}${tagsHtml}\n    <div class="body">${bodyHtml}</div>\n  </div>`;
  }

  html += `\n</body>\n</html>`;

  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `commonplace-export-${todayISO()}.html`);
  showToast(`🌐 Exported ${articles.length} articles as HTML`, 'success');
});

// ---------- Startup ----------
function finishStartupUi() {
  const fy = document.getElementById('footer-year');
  if (fy) fy.textContent = new Date().getFullYear();
  document.getElementById('loading-overlay')?.classList.add('hide');
}

async function init() {
  // Local IndexedDB is only needed for settings/migration. If it's unavailable (e.g. private
  // mode) the articles still load from the database, so don't abort startup.
  try {
    await openDB();
  } catch (err) {
    console.error('Failed to open local database:', err);
    showToast('⚠️ Local storage is unavailable — saved settings won\'t persist on this device.', 'error', 6000);
  }

  await loadArticles();
  await checkForLocalMigration();
  await loadGithubSettings();
  await loadAiSettings();
  await loadFbSettings();
  primeVoices();
  populateCategorySelects();
  renderCategoryNav();
  resetWriteForm();
  routeFromHash();
  finishStartupUi();
  setTimeout(loadAds, 1000);
}

init().catch((err) => {
  console.error('Startup failed:', err);
  showToast(`⚠️ Something went wrong while starting up: ${err.message}`, 'error', 6000);
  try {
    populateCategorySelects();
    renderCategoryNav();
    resetWriteForm();
    navigateTo('home');
  } catch (e) { console.error(e); }
  finishStartupUi();
});
