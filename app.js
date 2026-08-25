const CATEGORIES = [
  { slug: 'history', name: 'History', color: '#8B6B4A' },
  { slug: 'philosophy', name: 'Philosophy', color: '#6B4F3A' },
  { slug: 'economy', name: 'Economy', color: '#5A7A8A' },
  { slug: 'programming', name: 'Programming', color: '#7A6B5A' },
  { slug: 'culture', name: 'Culture', color: '#9A8B7A' },
  { slug: 'local-politics', name: 'Local Politics', color: '#6A5A4A' },
  { slug: 'global-politics', name: 'Global Politics', color: '#5A6A7A' },
  { slug: 'weather', name: 'Weather', color: '#7A8A7A' }
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
  const buffer = await file.arrayBuffer();
  const key = 'commonplace-video-' + generateMediaKeyId();
  await window.storage.set(key, { buffer, type: file.type || 'video/mp4' });
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
      if (res && res.value && res.value.buffer) {
        const blob = new Blob([res.value.buffer], { type: res.value.type || 'video/mp4' });
        const url = URL.createObjectURL(blob);
        mediaObjectUrlCache.set(key, url);
        return url;
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
      if (res && res.value && res.value.buffer) {
        return new File([res.value.buffer], filename, { type: res.value.type || 'video/mp4' });
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

function categoryOf(slug) {
  return CATEGORIES.find(c => c.slug === slug) || null;
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

    let markdown = `---\n`;
    markdown += `title: ${article.title}\n`;
    markdown += `date: ${article.date}\n`;
    markdown += `category: ${article.category}\n`;
    markdown += `category_name: ${cat ? cat.name : 'Uncategorized'}\n`;
    if (article.photo) markdown += `has_photo: true\n`;
    if (article.video) markdown += `has_video: true\n`;
    markdown += `---\n\n`;
    markdown += article.body;

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
    <a class="spine-tab" data-view="articles" data-category="${c.slug}">
      <span class="dot" style="background:${c.color}"></span>
      <span class="name">${c.name}</span>
      <span class="count">${counts[c.slug]}</span>
    </a>
  `).join('');

  const mobileOut = document.getElementById('mobile-tabs');
  mobileOut.innerHTML = CATEGORIES.map(c => `
    <a class="mobile-tab" data-view="articles" data-category="${c.slug}">
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
}

function renderHome() {
  const counts = {};
  CATEGORIES.forEach(c => counts[c.slug] = 0);
  articles.forEach(a => { if (counts[a.category] !== undefined) counts[a.category]++; });
  const max = Math.max(1, ...Object.values(counts));

  const shelfOut = document.getElementById('shelf-rows');
  shelfOut.innerHTML = CATEGORIES.map(c => `
    <div class="shelf-row" data-category="${c.slug}">
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
  document.getElementById('entry-body').value = '';
  document.getElementById('entry-photo').value = '';
  document.getElementById('entry-video').value = '';
  document.getElementById('entry-photo-preview').innerHTML = '';
  document.getElementById('entry-video-preview').innerHTML = '';
  document.getElementById('entry-save-btn').textContent = 'Save entry';
  document.getElementById('entry-cancel-btn').style.display = 'none';
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
  document.getElementById('entry-body').value = a.body;
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
  navigateTo('write', { keepForm: true });
}

async function saveEntry() {
  const title = document.getElementById('entry-title').value.trim();
  const category = document.getElementById('entry-category').value;
  const date = document.getElementById('entry-date').value || todayISO();
  const body = document.getElementById('entry-body').value.trim();

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
      showToast('⚠️ Failed to save video — it may be too large for this device\'s storage.', 'error', 5000);
      return;
    }
    if (oldVideo) await deleteVideoBlobIfAny(oldVideo);
  }

  if (editingId) {
    const idx = articles.findIndex(a => a.id === editingId);
    if (idx !== -1) articles[idx] = { ...articles[idx], title, category, date, body, photo, video };
  } else {
    articles.push({ id: nextId++, title, category, date, body, photo, video });
  }
  const success = await saveArticlesToStorage();
  if (success) {
    showToast(editingId ? '✅ Entry updated' : '✅ Entry saved', 'success');
    const savedId = editingId || articles[articles.length - 1].id;
    resetWriteForm();
    renderCategoryNav();
    navigateTo('article', { id: savedId });
  }
}

function renderArticlesList() {
  const categoryFilter = document.getElementById('articles-category-filter').value;
  const searchText = document.getElementById('articles-search').value.trim().toLowerCase();
  const cat = categoryOf(categoryFilter);
  document.getElementById('articles-title').textContent = cat ? cat.name : 'All Articles';

  let list = [...articles];
  if (categoryFilter) list = list.filter(a => a.category === categoryFilter);
  if (searchText) list = list.filter(a => a.title.toLowerCase().includes(searchText));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const out = document.getElementById('articles-list');
  if (list.length === 0) {
    out.innerHTML = `<div class="empty-state"><span class="glyph">📭</span>No entries here yet.</div>`;
    return;
  }
  out.innerHTML = list.map(a => {
    const c = categoryOf(a.category);
    return `
      <div class="article-row" data-id="${a.id}">
        <div>
          <div class="ar-title">${escapeHtml(a.title)}</div>
          <div class="ar-meta">${a.date}</div>
        </div>
        ${c ? `<span class="category-tag" style="color:${c.color};border-color:${c.color};background:rgba(139,107,74,0.08);">${c.name}</span>` : ''}
      </div>`;
  }).join('');
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
  document.getElementById('article-body').innerHTML = a.body.split(/\n\s*\n/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');

  const mediaOut = document.getElementById('article-media');
  const parts = [];
  if (a.photo) parts.push(`<img class="article-photo" src="${a.photo}" alt="${escapeHtml(a.title)}">`);
  if (a.video) {
    parts.push(`<video class="article-video" controls playsinline preload="metadata" data-media-key="${escapeHtml(a.video)}"></video>`);
    parts.push(`<div class="offline-badge">📴 Plays offline — saved on this device</div>`);
  }
  mediaOut.innerHTML = parts.join('');
  hydrateVideoElements(mediaOut);

  loadAds();
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

  const utterance = new SpeechSynthesisUtterance(`${a.title}. ${a.body}`);
  utterance.onend = () => { btn.textContent = '🔊 Listen'; };
  utterance.onerror = () => { btn.textContent = '🔊 Listen'; };
  window.speechSynthesis.speak(utterance);
  btn.textContent = '⏹ Stop';
}

async function shareCurrentArticle() {
  const a = articles.find(x => x.id === currentArticleId);
  if (!a) return;
  const c = categoryOf(a.category);
  const snippet = a.body.replace(/\s+/g, ' ').trim().slice(0, 180);
  const caption = `${a.title}${c ? ' · ' + c.name : ''} — ${snippet}${a.body.length > 180 ? '…' : ''}`;

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
  const matches = articles.filter(a => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)).slice(0, 15);
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

document.getElementById('entry-video').addEventListener('change', (e) => {
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

  let html = `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>The Commonplace — Export</title>\n  <style>\n    body { font-family: 'Source Serif 4', serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #2A1A0F; background: #F5F0EA; }\n    h1 { font-size: 2.5rem; border-bottom: 2px solid #C8BDB0; padding-bottom: 0.5rem; color: #3C2A1F; }\n    .article { margin: 2rem 0; padding-bottom: 2rem; border-bottom: 1px solid #C8BDB0; }\n    .article h2 { margin-bottom: 0.25rem; color: #3C2A1F; }\n    .meta { color: #5A4A3A; font-size: 0.9rem; }\n    .category { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 3px; font-size: 0.8rem; background: #EDE8E0; color: #3C2A1F; border: 1px solid #C8BDB0; }\n    .body { margin-top: 1rem; color: #5A4A3A; }\n  </style>\n</head>\n<body>\n  <h1>The Commonplace — Export</h1>\n  <p style="color:#5A4A3A;">Exported on ${new Date().toLocaleString()} · ${articles.length} articles</p>\n`;

  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  for (const article of sorted) {
    const cat = categoryOf(article.category);
    html += `\n  <div class="article">\n    <h2>${escapeHtml(article.title)}</h2>\n    <div class="meta">${article.date}${cat ? ' · <span class="category">' + cat.name + '</span>' : ''}</div>\n    <div class="body">${article.body.replace(/\n/g, '<br>')}</div>\n  </div>`;
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
  populateCategorySelects();
  renderCategoryNav();
  resetWriteForm();
  navigateTo('home');
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
