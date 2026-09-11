const CATEGORIES = [
  { slug: 'history', name: 'History', color: '#8B6B4A', description: 'A look backward — the events, decisions, and forgotten details that explain how the present came to be.' },
  { slug: 'philosophy', name: 'Philosophy', color: '#6B4F3A', description: 'Essays that sit with hard questions — ethics, meaning, and the different ways of thinking that shape a life.' },
  { slug: 'economy', name: 'Economy', color: '#5A7A8A', description: 'Notes on markets, money, and the incentives that quietly steer how resources move through the world.' },
  { slug: 'programming', name: 'Programming', color: '#7A6B5A', description: 'Thoughts on code, tools, and the craft of building software — the small decisions that add up to working systems.' },
  { slug: 'culture', name: 'Culture', color: '#9A8B7A', description: 'Observations on art, media, and the everyday habits and stories that shape how people live and create.' },
  { slug: 'local-politics', name: 'Local Politics', color: '#6A5A4A', description: 'Commentary on the affairs closer to home — community, local government, and national politics as lived day to day.' },
  { slug: 'global-politics', name: 'Global Politics', color: '#5A6A7A', description: 'Perspectives on international affairs, diplomacy, and the shifting balance of power on the world stage.' },
  { slug: 'weather', name: 'Weather', color: '#7A8A7A', description: 'Musings on climate, seasons, and the sky overhead — the weather as a subject worth paying attention to.' },
  { slug: 'farming', name: 'Farming', color: '#6E8B3D', description: 'Reflections on agriculture, land, and growing things — the rhythms of planting, tending, and harvest.' },
  { slug: 'ai', name: 'AI', color: '#4A6A8A', description: 'Essays on artificial intelligence — the tools reshaping work and thought, and what it means to build and think alongside a machine.' }
];

const DB_NAME = 'CommonplaceDB';
const DB_VERSION = 1;
const STORAGE_KEY = 'commonplace-articles-v1';

let db = null;
let dbReady = false;
let articles = [];
let nextId = 1;
let editingId = null;
let currentArticleId = null;
let pendingPhoto = null;
let pendingVideoFile = null;
let toastTimer = null;
let searchDebounce = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (ev) => {
      const database = ev.target.result;
      if (!database.objectStoreNames.contains('records')) {
        database.createObjectStore('records', { keyPath: 'key' });
      }
    };
    request.onsuccess = (ev) => { db = ev.target.result; dbReady = true; resolve(db); };
    request.onerror = (ev) => reject(ev.target.error);
  });
}

window.storage = {
  get: async (key) => {
    if (!dbReady) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(key);
      req.onsuccess = () => resolve(req.result ? { value: req.result.value } : null);
      req.onerror = (ev) => reject(ev.target.error);
    });
  },
  set: async (key, value) => {
    if (!dbReady) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const req = tx.objectStore('records').put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = (ev) => reject(ev.target.error);
    });
  },
  delete: async (key) => {
    if (!dbReady) await openDB();
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

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const mediaObjectUrlCache = new Map();

function generateMediaKeyId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'm' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

async function storeVideoFile(file) {
  const key = 'commonplace-video-' + generateMediaKeyId();
  await window.storage.set(key, { blob: file, type: file.type || 'video/mp4' });
  return 'blobref:' + key;
}

async function resolveVideoSrc(value) {
  if (!value) return null;
  if (value.startsWith('data:')) return value;
  if (value.startsWith('blobref:')) {
    const key = value.slice('blobref:'.length);
    if (mediaObjectUrlCache.has(key)) return mediaObjectUrlCache.get(key);
    try {
      const res = await window.storage.get(key);
      if (res && res.value) {
        let blob = null;
        if (res.value.blob instanceof Blob) {
          blob = res.value.blob;
        } else if (res.value.buffer) {
          blob = new Blob([res.value.buffer], { type: res.value.type || 'video/mp4' });
        }
        if (blob) {
          const url = URL.createObjectURL(blob);
          mediaObjectUrlCache.set(key, url);
          return url;
        }
      }
    } catch (e) {
      console.warn('Failed to load video blob for', key, e);
    }
  }
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

async function deleteVideoBlobIfAny(value) {
  if (value && value.startsWith('blobref:')) {
    const key = value.slice('blobref:'.length);
    mediaObjectUrlCache.delete(key);
    try { await window.storage.delete(key); } catch (e) { }
  }
}

async function videoValueToFile(value, filename) {
  if (!value) return null;
  if (value.startsWith('data:')) {
    const [header, base64] = value.split(',');
    const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'video/mp4';
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], filename, { type: mime });
  }
  if (value.startsWith('blobref:')) {
    const key = value.slice('blobref:'.length);
    try {
      const res = await window.storage.get(key);
      if (res && res.value) {
        if (res.value.blob instanceof Blob) {
          return new File([res.value.blob], filename, { type: res.value.type || res.value.blob.type || 'video/mp4' });
        } else if (res.value.buffer) {
          return new File([res.value.buffer], filename, { type: res.value.type || 'video/mp4' });
        }
      }
    } catch (e) { console.warn('Failed to load video for sharing:', e); }
  }
  return null;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const HTML_DISALLOWED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'BASE']);

function sanitizeHtml(rawHtml) {
  const template = document.createElement('template');
  template.innerHTML = rawHtml || '';
  const walk = (node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 1) {
        if (HTML_DISALLOWED_TAGS.has(child.tagName)) {
          child.remove();
          continue;
        }
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          const val = attr.value.trim();
          if (name.startsWith('on')) {
            child.removeAttribute(attr.name);
          } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(val)) {
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

// Looks for covers/<slug>.mp4 first, then covers/<slug>.jpg / .png / .webp.
// If none exist, the container is hidden — no code changes needed per section,
// just drop a matching file into the covers/ folder.
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
  t.textContent = msg;
  t.className = 'toast';
  if (type === 'error') t.classList.add('error');
  if (type === 'success') t.classList.add('success');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

async function loadArticles() {
  try {
    const res = await window.storage.get(STORAGE_KEY);
    if (res && res.value) {
      const parsed = JSON.parse(res.value);
      articles = parsed.articles || [];
      nextId = parsed.nextId || (articles.length ? Math.max(...articles.map(a => a.id)) + 1 : 1);
    }
  } catch (e) {
    console.warn('Failed to load articles:', e);
    articles = [];
    nextId = 1;
  }
}

async function saveArticlesToStorage() {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify({ articles, nextId }));
    return true;
  } catch (e) {
    console.error('Save error:', e);
    showToast('⚠️ Failed to save — try a shorter entry or check your device storage.', 'error', 5000);
    return false;
  }
}

function exportToGitHub() {
  if (articles.length === 0) {
    showToast('📭 No articles to export', 'error');
    return;
  }

  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const markdownFiles = [];

  for (const article of sorted) {
    const cat = categoryOf(article.category);
    const fileName = `${article.date}-${article.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`;
    const folder = cat ? cat.slug : 'uncategorized';

    const markdown = articleMarkdown(article);

    markdownFiles.push({
      path: `${folder}/${fileName}`,
      content: markdown,
      title: article.title,
      date: article.date,
      category: article.category
    });
  }

  let readme = `# Commonplace Export\n\n`;
  readme += `Exported on ${new Date().toLocaleString()}\n\n`;
  readme += `## Articles by Category\n\n`;

  for (const cat of CATEGORIES) {
    const count = articles.filter(a => a.category === cat.slug).length;
    if (count > 0) {
      readme += `### ${cat.name} (${count})\n\n`;
      readme += `${cat.description}\n\n`;
      const items = articles.filter(a => a.category === cat.slug).sort((a, b) => b.date.localeCompare(a.date));
      for (const item of items) {
        readme += `- [${item.title}](${cat.slug}/${item.date}-${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md) — ${item.date}\n`;
      }
      readme += `\n`;
    }
  }

  for (const file of markdownFiles) {
    const blob = new Blob([file.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const pathParts = file.path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const folder = pathParts[0];
    a.href = url;
    a.download = `${folder}-${fileName}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const readmeBlob = new Blob([readme], { type: 'text/markdown;charset=utf-8' });
  const readmeUrl = URL.createObjectURL(readmeBlob);
  const readmeA = document.createElement('a');
  readmeA.href = readmeUrl;
  readmeA.download = 'README-export.md';
  document.body.appendChild(readmeA);
  readmeA.click();
  document.body.removeChild(readmeA);
  setTimeout(() => URL.revokeObjectURL(readmeUrl), 1000);

  showToast(`📤 Exported ${articles.length} articles as markdown files`, 'success', 4000);
}

function navigateTo(view, opts = {}) {
  stopListening();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.spine-link, .spine-tab').forEach(el => el.classList.remove('active'));

  const titles = { home: 'The Commonplace', write: 'Write', articles: 'All Articles', article: 'Article' };
  document.getElementById('topbar-title').textContent = titles[view] || 'The Commonplace';

  closeMobileDrawer();

  if (view === 'home') {
    document.querySelectorAll('[data-view="home"]').forEach(el => el.classList.add('active'));
    renderHome();
  }
  if (view === 'write') {
    document.querySelectorAll('[data-view="write"]').forEach(el => el.classList.add('active'));
    if (!opts.keepForm) resetWriteForm();
  }
  if (view === 'articles') {
    document.querySelectorAll('[data-view="articles"]').forEach(el => el.classList.add('active'));
    if (opts.category !== undefined) {
      document.getElementById('articles-category-filter').value = opts.category;
      document.querySelectorAll(`.spine-tab[data-category="${opts.category}"], .mobile-tab[data-category="${opts.category}"]`).forEach(el => el.classList.add('active'));
    }
    renderArticlesList();
  }
  if (view === 'article' && opts.id !== undefined) {
    openArticle(opts.id);
  }
  try {
    if (view === 'article' && opts.id !== undefined) {
      history.replaceState(null, '', `#/article/${opts.id}`);
    } else if (view === 'articles' && opts.category) {
      history.replaceState(null, '', `#/category/${opts.category}`);
    } else {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
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
      <div class="shelf-label">${c.name}</div>
      <div class="shelf-track"><div class="shelf-fill" style="width:${(counts[c.slug] / max * 100).toFixed(1)}%;background:${c.color};"></div></div>
      <div class="shelf-count">${counts[c.slug]}</div>
    </div>
  `).join('');
  shelfOut.querySelectorAll('.shelf-row').forEach(el => {
    el.addEventListener('click', () => navigateTo('articles', { category: el.getAttribute('data-category') }));
  });

  const recentOut = document.getElementById('recent-list');
  const recent = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 8);
  document.getElementById('recent-count-label').textContent = articles.length ? `(${articles.length} total)` : '';
  if (recent.length === 0) {
    recentOut.innerHTML = `<div class="empty-state"><span class="glyph">✒️</span>Nothing written yet. Start with your first entry.</div>`;
    return;
  }
  recentOut.innerHTML = recent.map(a => {
    const cat = categoryOf(a.category);
    return `
      <div class="recent-item" data-id="${a.id}">
        <span class="rt-title">${escapeHtml(a.title)}</span>
        <span class="rt-meta">${cat ? cat.name : ''} · ${a.date}</span>
      </div>`;
  }).join('');
  recentOut.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', () => navigateTo('article', { id: parseInt(el.getAttribute('data-id'), 10) }));
  });

  loadAds();
}

function resetWriteForm() {
  editingId = null;
  pendingPhoto = null;
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
  photoPreview.innerHTML = a.photo ? `<img class="media-preview-thumb" src="${a.photo}" alt="Current photo">` : '';
  const videoPreview = document.getElementById('entry-video-preview');
  if (a.video) {
    videoPreview.innerHTML = `<video class="media-preview-thumb" controls playsinline preload="metadata" data-media-key="${escapeHtml(a.video)}"></video>`;
    hydrateVideoElements(videoPreview);
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
  document.getElementById('gh-username').value = githubSettings.username || '';
  document.getElementById('gh-repo').value = githubSettings.repo || '';
  document.getElementById('gh-branch').value = githubSettings.branch || 'main';
  document.getElementById('gh-token').value = githubSettings.token || '';
  document.getElementById('gh-autodeploy').checked = !!githubSettings.autoDeploy;
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
    document.getElementById('gh-status').textContent = githubSettings.autoDeploy
      ? '✅ Saved. New articles will auto-deploy to GitHub.'
      : '✅ Saved. Auto-deploy is currently off.';
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
  document.getElementById('ai-api-key').value = aiSettings.apiKey || '';
  document.getElementById('ai-model').value = aiSettings.model || AI_DEFAULT_MODEL;
  document.getElementById('ai-autogenerate').checked = !!aiSettings.autoGenerate;
}

async function saveAiSettings() {
  aiSettings = {
    apiKey: document.getElementById('ai-api-key').value.trim(),
    model: document.getElementById('ai-model').value || AI_DEFAULT_MODEL,
    autoGenerate: document.getElementById('ai-autogenerate').checked
  };
  try {
    await window.storage.set(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
    document.getElementById('ai-status').textContent = aiSettings.autoGenerate
      ? '✅ Saved. New articles will auto-generate a summary and tags if left blank.'
      : '✅ Saved. Auto-generate is currently off — use the "Generate with AI" button when writing.';
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

async function maybeAutoGenerateAI(article) {
  if (!aiSettings.autoGenerate || !aiSettings.apiKey) return;
  if (article.summary && article.tags && article.tags.length) return;
  try {
    const { summary, tags } = await generateSummaryAndTags(article.title, article.body);
    const idx = articles.findIndex(x => x.id === article.id);
    if (idx === -1) return;
    if (!articles[idx].summary) articles[idx].summary = summary;
    if (!articles[idx].tags || !articles[idx].tags.length) articles[idx].tags = tags;
    await saveArticlesToStorage();
    if (currentArticleId === article.id) openArticle(article.id);
    renderArticlesList();
    renderHome();
    if (githubSettings.autoDeploy) deployArticleToGitHub(articles[idx]);
  } catch (e) {
    console.warn('Auto AI generation failed:', e);
    showToast(`⚠️ AI auto-generation failed: ${e.message}`, 'error', 5000);
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function articleMarkdown(article) {
  const cat = categoryOf(article.category);
  let md = `---\n`;
  md += `title: ${article.title}\n`;
  md += `date: ${article.date}\n`;
  md += `category: ${article.category}\n`;
  md += `category_name: ${cat ? cat.name : 'Uncategorized'}\n`;
  if (article.contentType === 'html') md += `content_type: html\n`;
  if (article.summary) md += `summary: ${article.summary.replace(/\n/g, ' ')}\n`;
  if (article.tags && article.tags.length) md += `tags: [${article.tags.join(', ')}]\n`;
  if (article.photo) md += `has_photo: true\n`;
  if (article.video) md += `has_video: true\n`;
  md += `---\n\n`;
  md += article.body;
  return md;
}

async function githubGetSha(path) {
  const { username, repo, branch, token } = githubSettings;
  const url = `https://api.github.com/repos/${username}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
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

async function deployArticleToGitHub(article) {
  if (!githubSettings.autoDeploy) return;
  if (!githubSettings.username || !githubSettings.repo || !githubSettings.token) {
    showToast('⚠️ GitHub auto-deploy is on but settings are incomplete — check the Home page', 'error', 5000);
    return;
  }
  const cat = categoryOf(article.category);
  const folder = cat ? cat.slug : 'uncategorized';
  const slug = slugify(article.title) || `article-${article.id}`;
  const mdPath = `${folder}/${article.date}-${slug}.md`;

  try {
    await githubPutFile(mdPath, b64EncodeUnicode(articleMarkdown(article)), `Add/update article: ${article.title}`);

    const githubUrl = `https://github.com/${githubSettings.username}/${githubSettings.repo}/blob/${githubSettings.branch}/${mdPath}`;
    const idx = articles.findIndex(x => x.id === article.id);
    if (idx !== -1) {
      articles[idx].githubUrl = githubUrl;
      await saveArticlesToStorage();
      if (currentArticleId === article.id) updateShareLinks(articles[idx]);
    }

    if (article.photo) {
      const match = article.photo.match(/^data:image\/(\w+);base64,(.*)$/);
      if (match) {
        const [, ext, base64Only] = match;
        const photoPath = `${folder}/${article.date}-${slug}.${ext === 'jpeg' ? 'jpg' : ext}`;
        await githubPutFile(photoPath, base64Only, `Add photo for: ${article.title}`);
      }
    }

    if (article.video) {
      showToast('ℹ️ Article deployed — video skipped (too large for GitHub\'s API, ~100MB limit)', 'info', 6000);
    } else {
      showToast('🚀 Deployed to GitHub — share links now point directly to this article', 'success', 4000);
    }
  } catch (e) {
    console.error('GitHub deploy failed:', e);
    showToast(`⚠️ GitHub deploy failed: ${e.message}`, 'error', 6000);
  }
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

  const existing = editingId ? articles.find(a => a.id === editingId) : null;
  const photo = pendingPhoto !== null ? pendingPhoto : (existing ? existing.photo || null : null);

  let video = existing ? existing.video || null : null;
  if (pendingVideoFile) {
    const oldVideo = video;
    try {
      video = await storeVideoFile(pendingVideoFile);
    } catch (e) {
      console.error('Video store failed:', e);
      const reason = e && e.name === 'QuotaExceededError'
        ? 'this device is out of storage space'
        : (e && e.message) ? e.message : 'unknown error';
      showToast(`⚠️ Failed to save video: ${reason}`, 'error', 6000);
      return;
    }
    if (oldVideo) await deleteVideoBlobIfAny(oldVideo);
  }

  if (editingId) {
    const idx = articles.findIndex(a => a.id === editingId);
    if (idx !== -1) articles[idx] = { ...articles[idx], title, category, date, body, contentType, summary, tags, photo, video };
  } else {
    articles.push({ id: nextId++, title, category, date, body, contentType, summary, tags, photo, video });
  }
  const success = await saveArticlesToStorage();
  if (success) {
    showToast(editingId ? '✅ Entry updated' : '✅ Entry saved', 'success');
    const savedId = editingId || articles[articles.length - 1].id;
    const savedArticle = articles.find(a => a.id === savedId);
    resetWriteForm();
    renderCategoryNav();
    navigateTo('article', { id: savedId });
    deployArticleToGitHub(savedArticle);
    maybeAutoGenerateAI(savedArticle);
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
        ${c ? `<span class="category-tag" style="color:${c.color};border-color:${c.color};background:rgba(139,107,74,0.08);">${c.name}</span>` : ''}
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
  document.getElementById('article-category-tag').style.cssText = c ? `color:${c.color};border-color:${c.color};background:rgba(139,107,74,0.08);` : '';
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
  if (a.photo) parts.push(`<img class="article-photo" src="${a.photo}" alt="${escapeHtml(a.title)}">`);
  if (a.video) {
    parts.push(`<video class="article-video" controls playsinline preload="metadata" data-media-key="${escapeHtml(a.video)}"></video>`);
    parts.push(`<div class="offline-badge">📴 Plays offline — saved on this device</div>`);
  }
  mediaOut.innerHTML = parts.join('');
  hydrateVideoElements(mediaOut);

  updateShareLinks(a);
  loadAds();
}

const SITE_URL = 'https://current-situation.vercel.app/';

function articleShareUrl(a) {
  if (a.githubUrl) return a.githubUrl;
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

  document.getElementById('share-fb').href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
  document.getElementById('share-x').href = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
  document.getElementById('share-linkedin').href = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
  document.getElementById('share-whatsapp').href = `https://api.whatsapp.com/send?text=${text}%20${url}`;
  document.getElementById('share-telegram').href = `https://t.me/share/url?url=${url}&text=${text}`;
  document.getElementById('share-reddit').href = `https://www.reddit.com/submit?url=${url}&title=${title}`;
  document.getElementById('share-email').href = `mailto:?subject=${title}&body=${text}%0A%0A${url}`;

  const noteEl = document.getElementById('share-link-note');
  if (noteEl) {
    noteEl.textContent = a.githubUrl
      ? ''
      : '⚠️ This link only opens the article on this device — turn on GitHub auto-deploy so links work for anyone.';
  }
}

async function deleteCurrentArticle() {
  if (!currentArticleId) return;
  if (!confirm('Delete this entry? This can\'t be undone.')) return;
  stopListening();
  const entry = articles.find(a => a.id === currentArticleId);
  articles = articles.filter(a => a.id !== currentArticleId);
  await saveArticlesToStorage();
  if (entry) await deleteVideoBlobIfAny(entry.video);
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

let cachedVoices = [];
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
  if (!candidate) candidate = voices.find(v => /en/i.test(v.lang) && !femaleHints.test(v.name));
  return candidate || voices[0];
}

function stopListening() {
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  const btn = document.getElementById('article-listen-btn');
  if (btn) btn.textContent = '🔊 Listen';
}

function toggleListen() {
  if (!('speechSynthesis' in window)) {
    showToast('⚠️ Text-to-speech isn\'t supported in this browser', 'error');
    return;
  }
  const btn = document.getElementById('article-listen-btn');
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    stopListening();
    return;
  }
  const a = articles.find(x => x.id === currentArticleId);
  if (!a) return;

  const spokenBody = a.contentType === 'html'
    ? (document.getElementById('article-body').textContent || '')
    : a.body;
  const utterance = new SpeechSynthesisUtterance(`${a.title}. ${spokenBody}`);
  const maleVoice = pickMaleVoice();
  if (maleVoice) {
    utterance.voice = maleVoice;
  } else {
    utterance.pitch = 0.75;
  }
  utterance.onend = () => { btn.textContent = '🔊 Listen'; };
  utterance.onerror = () => { btn.textContent = '🔊 Listen'; };
  window.speechSynthesis.speak(utterance);
  btn.textContent = '⏹ Stop';
}

async function shareCurrentArticle() {
  const a = articles.find(x => x.id === currentArticleId);
  if (!a) return;
  const c = categoryOf(a.category);
  const caption = `${a.title}${c ? ' · ' + c.name : ''} — ${shareSnippet(a)}`;

  try {
    if (navigator.share) {
      const files = [];
      if (a.video) {
        const videoFile = await videoValueToFile(a.video, `${a.title}.mp4`);
        if (videoFile) files.push(videoFile);
      } else if (a.photo) {
        files.push(dataUrlToFile(a.photo, `${a.title}.jpg`));
      }
      const shareData = { title: a.title, text: caption };
      if (files.length && navigator.canShare && navigator.canShare({ files })) shareData.files = files;
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
    if (file) downloadBlob(file, `${a.title}.mp4`);
    showToast('⬇ Video downloaded', 'success');
  });
  document.getElementById('share-dl-photo')?.addEventListener('click', () => {
    downloadBlob(dataUrlToFile(a.photo, `${a.title}.jpg`), `${a.title}.jpg`);
    showToast('⬇ Photo downloaded', 'success');
  });
  document.getElementById('share-copy-text')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(caption); showToast('📋 Caption copied', 'success'); }
    catch (e) { showToast('⚠️ Could not copy — select the text manually', 'error'); }
  });
  document.getElementById('share-open-fb')?.addEventListener('click', () => {
    window.open('https://www.facebook.com/', '_blank', 'noopener');
  });
  document.getElementById('share-fallback-modal').classList.add('open');
}

document.getElementById('share-fallback-close').addEventListener('click', () => {
  document.getElementById('share-fallback-modal').classList.remove('open');
});
document.getElementById('share-fallback-modal').addEventListener('click', (e) => {
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
    return `<div class="search-result-item" data-id="${a.id}"><strong>${escapeHtml(a.title)}</strong><br><span style="color:var(--faint);">${c ? c.name : ''} · ${a.date}</span></div>`;
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

function loadAds() {
  if (typeof window.adsbygoogle !== 'undefined') {
    try {
      document.querySelectorAll('ins.adsbygoogle:not([data-ad-status])').forEach(() => {
        (adsbygoogle = window.adsbygoogle || []).push({});
      });
    } catch (e) {
      console.log('Ad loading:', e);
    }
  }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-view]');
  if (link && !link.classList.contains('spine-tab') && !link.classList.contains('mobile-tab')) {
    e.preventDefault();
    navigateTo(link.getAttribute('data-view'));
  }
  if (!e.target.closest('.topbar-search-wrap')) {
    document.getElementById('search-results')?.classList.remove('open');
  }
});

document.getElementById('menuBtn').addEventListener('click', toggleMobileDrawer);
document.getElementById('entry-save-btn').addEventListener('click', saveEntry);
document.getElementById('entry-category').addEventListener('change', updateEntryCategoryHint);
document.getElementById('entry-format').addEventListener('change', updateEntryFormatUI);

document.getElementById('entry-photo').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  const preview = document.getElementById('entry-photo-preview');
  if (!file) { pendingPhoto = null; preview.innerHTML = ''; return; }
  if (!file.type.startsWith('image/')) { showToast('⚠️ Please choose an image file', 'error'); e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingPhoto = ev.target.result;
    preview.innerHTML = `<img class="media-preview-thumb" src="${pendingPhoto}" alt="Photo preview">`;
  };
  reader.readAsDataURL(file);
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
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const available = quota - usage;
      if (available < file.size * 1.15) {
        const availableMB = Math.max(0, Math.round(available / 1024 / 1024));
        const neededMB = Math.round(file.size / 1024 / 1024);
        showToast(`⚠️ Not enough free storage on this device — ~${availableMB}MB free, this video needs ~${neededMB}MB`, 'error', 7000);
        e.target.value = '';
        return;
      }
    } catch (err) { }
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
document.getElementById('gh-settings-save-btn')?.addEventListener('click', saveGithubSettings);
document.getElementById('ai-settings-save-btn')?.addEventListener('click', saveAiSettings);
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
  const dataStr = JSON.stringify(articles, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commonplace-export-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const bodyHtml = article.contentType === 'html' ? sanitizeHtml(article.body) : article.body.replace(/\n/g, '<br>');
    const summaryHtml = article.summary ? `\n    <div class="summary">${escapeHtml(article.summary)}</div>` : '';
    const tagsHtml = (article.tags && article.tags.length) ? `\n    <div class="tags">${article.tags.map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>` : '';
    html += `\n  <div class="article">\n    <h2>${escapeHtml(article.title)}</h2>\n    <div class="meta">${article.date}${cat ? ' · <span class="category">' + cat.name + '</span>' : ''}</div>${summaryHtml}${tagsHtml}\n    <div class="body">${bodyHtml}</div>\n  </div>`;
  }

  html += `\n</body>\n</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commonplace-export-${todayISO()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`🌐 Exported ${articles.length} articles as HTML`, 'success');
});

openDB().then(async () => {
  await loadArticles();
  await loadGithubSettings();
  await loadAiSettings();
  primeVoices();
  populateCategorySelects();
  renderCategoryNav();
  resetWriteForm();
  const articleMatch = location.hash.match(/^#\/article\/(\d+)$/);
  const categoryMatch = location.hash.match(/^#\/category\/([a-z-]+)$/);
  if (articleMatch) {
    navigateTo('article', { id: parseInt(articleMatch[1], 10) });
  } else if (categoryMatch) {
    navigateTo('articles', { category: categoryMatch[1] });
  } else {
    navigateTo('home');
  }
  const fy = document.getElementById('footer-year');
  if (fy) fy.textContent = new Date().getFullYear();
  document.getElementById('loading-overlay').classList.add('hide');

  setTimeout(loadAds, 1000);
}).catch(err => {
  console.error('Failed to open database:', err);
  document.getElementById('loading-overlay').classList.add('hide');
  showToast('⚠️ This browser doesn\'t support offline storage — your entries won\'t be saved.', 'error', 6000);
  populateCategorySelects();
  renderCategoryNav();
  resetWriteForm();
  navigateTo('home');
  const fy2 = document.getElementById('footer-year');
  if (fy2) fy2.textContent = new Date().getFullYear();
});
