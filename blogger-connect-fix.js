let publishSettings = {
  pagesUrl: 'https://poetic-codes.pages.dev/',
  blogUrl: 'https://poetic-bytes.blogspot.com/',
  blogId: ''
};

let gisPromise = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google Sign-In (check your connection or ad-blocker)')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

async function requestBloggerToken({ prompt } = {}) {
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: BLOGGER_CLIENT_ID,
      scope: BLOGGER_SCOPE,
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        ls.set('blogger_access_token', r.access_token);
        ls.set('blogger_token_expiry', String(Date.now() + r.expires_in * 1000));
        resolve(r.access_token);
      },
      error_callback: e => {
        const msg = e.type === 'popup_failed_to_open' ? 'Popup was blocked — allow popups for this site and tap again'
          : e.type === 'popup_closed' ? 'Sign-in window was closed'
          : (e.message || e.type || 'Sign-in failed');
        reject(new Error(msg));
      }
    });
    const opts = {};
    if (prompt !== undefined) opts.prompt = prompt;
    client.requestAccessToken(opts);
  });
}

async function resolveBlogId(token, blogUrl) {
  const res = await fetch(
    'https://www.googleapis.com/blogger/v3/blogs/byurl?url=' + encodeURIComponent(blogUrl),
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Blogger HTTP ' + res.status);
  return data.id;
}

async function connectBlogger() {
  const btn = document.getElementById('pub-connect-btn');
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  try {
    const token = await requestBloggerToken({ prompt: 'select_account' });
    if (!publishSettings.blogId) {
      const url = publishSettings.blogUrl || 'https://poetic-bytes.blogspot.com/';
      publishSettings.blogId = await resolveBlogId(token, url);
      ls.set(PUBLISH_SETTINGS_KEY, JSON.stringify(publishSettings));
      ls.set('pc_blog_id', publishSettings.blogId);
    }
    showToast('✅ Blogger connected', 'success');
    fillPublishPanel();
    return true;
  } catch (e) {
    showToast('⚠️ Blogger sign-in failed: ' + e.message, 'error', 6000);
    fillPublishPanel(e.message);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
  }
}

function injectPublishStyles() {
  if (document.getElementById('pub-styles')) return;
  const st = document.createElement('style');
  st.id = 'pub-styles';
  st.textContent = `
  .g-btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:44px;padding:0 18px;
    background:#fff;color:#3c4043;border:1px solid #dadce0;border-radius:999px;
    font:500 14px/1 Arial,sans-serif;letter-spacing:.2px;cursor:pointer;
    box-shadow:0 1px 2px rgba(60,64,67,.15);transition:box-shadow .15s,background .15s}
  .g-btn:hover{background:#f8f9fa;box-shadow:0 1px 3px rgba(60,64,67,.3)}
  .g-btn:active{background:#eef0f2}
  .g-btn svg{width:18px;height:18px;flex:none}
  .g-btn.is-busy{opacity:.6;pointer-events:none}
  .g-btn:disabled{opacity:.6}
  .pub-pill{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:6px 12px;border-radius:999px;
    font:13px/1.3 Arial,sans-serif;background:#f1ece0;color:#6b5a38}
  .pub-pill.ok{background:#e3f1e6;color:#1e6b34}
  .pub-pill.err{background:#fbe9e7;color:#a3281d}
  `;
  document.head.appendChild(st);
}

const G_LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;

function injectPublishPanel() {
  if (document.getElementById('pub-save-btn')) return;
  const anchor = document.getElementById('gh-settings-save-btn');
  const host = anchor && anchor.closest('.card');
  if (!host) return;
  injectPublishStyles();
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
      <div class="field"><label for="pub-blog-url">Blogger address</label>
        <input type="text" id="pub-blog-url" placeholder="poetic-bytes.blogspot.com" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="pub-blog-id">Blogger blog ID (filled in automatically)</label>
        <input type="text" id="pub-blog-id" placeholder="found when you connect" autocomplete="off"></div>
    </div>
    <div class="btn-row" style="align-items:center">
      <button class="btn-primary" id="pub-save-btn" type="button">Save publish settings</button>
      <button class="g-btn" id="pub-connect-btn" type="button">${G_LOGO}<span>Connect Blogger</span></button>
    </div>
    <div id="pub-status" class="pub-pill"></div>`;
  host.parentNode.insertBefore(card, host);
  document.getElementById('pub-save-btn').addEventListener('click', savePublishSettings);
  document.getElementById('pub-connect-btn').addEventListener('click', connectBlogger);
}

function fillPublishPanel(errorMsg) {
  setVal('pub-pages-url', publishSettings.pagesUrl || '');
  setVal('pub-blog-url', publishSettings.blogUrl || '');
  setVal('pub-blog-id', publishSettings.blogId || '');
  const el = document.getElementById('pub-status');
  if (!el) return;
  const connected = !!bloggerToken();
  el.className = 'pub-pill ' + (errorMsg ? 'err' : connected ? 'ok' : '');
  el.textContent = errorMsg ? '⚠️ ' + errorMsg
    : connected ? '✅ Blogger connected · Pages: ' + SITE_URL
    : 'Blogger not connected — tap "Connect Blogger"';
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
  loadGis().catch(() => { });
}

async function savePublishSettings() {
  const v = id => document.getElementById(id).value.trim();
  let blogUrl = v('pub-blog-url');
  if (blogUrl && !/^https?:\/\//i.test(blogUrl)) blogUrl = 'https://' + blogUrl;
  publishSettings = { pagesUrl: v('pub-pages-url'), blogUrl, blogId: v('pub-blog-id') };
  ls.set(PUBLISH_SETTINGS_KEY, JSON.stringify(publishSettings));
  ls.set('pc_blog_id', publishSettings.blogId);
  applyPagesUrl();
  fillPublishPanel();
  showToast('✅ Publish settings saved', 'success');
}
