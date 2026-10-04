# Commonplace: videos from YouTube

No API changes needed: the YouTube link is stored in the same `video_url` column. Old Backblaze videos keep playing.

---
## app.js

### 1. Delete these
- `const MAX_VIDEO_BYTES …` (and its comment line)
- the whole "Video handling (uploads to Backblaze B2)" section: `putWithProgress`, `storeVideoFile`, `resolveVideoSrc`, `hydrateVideoElements`, `videoValueToFile`
- `let pendingVideoFile = null;` (top) and every `pendingVideoFile = null;` line (in `resetWriteForm` and `loadEntryForEdit`)

### 2. Paste in place of the deleted video section
```js
// ---------- Video handling (YouTube) ----------
function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
        if (m) id = m[1];
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch (e) { return null; }
}

function youtubeWatchUrl(id) { return `https://www.youtube.com/watch?v=${id}`; }

// YouTube links become an embed; any older direct video URL still plays in a <video>.
function videoHtml(value, cls) {
  const id = parseYouTubeId(value);
  if (id) {
    return `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
  }
  return `<video class="${cls}" controls playsinline preload="metadata" src="${escapeHtml(value)}"></video>`;
}

function updateVideoPreview() {
  const v = document.getElementById('entry-video-url').value.trim();
  const out = document.getElementById('entry-video-preview');
  const cur = editingId ? (articles.find(a => a.id === editingId) || {}).video : null;
  if (!v) { out.innerHTML = ''; return; }
  if (parseYouTubeId(v) || v === cur) out.innerHTML = videoHtml(v, 'media-preview-thumb');
  else out.innerHTML = '<div class="category-hint">⚠️ Not a recognised YouTube link</div>';
}
```

### 3. `resetWriteForm`
Replace `document.getElementById('entry-video').value = '';` with
`document.getElementById('entry-video-url').value = '';`

### 4. `loadEntryForEdit`
Delete `document.getElementById('entry-video').value = '';`, then replace the whole block from `const videoPreview = …` through its closing `else { videoPreview.innerHTML = ''; }` with:
```js
  setVal('entry-video-url', a.video || '');
  updateVideoPreview();
```

### 5. `saveEntry`
Replace the whole `let video = … if (pendingVideoFile) { … }` block with:
```js
  const videoInput = document.getElementById('entry-video-url').value.trim();
  let video = null;
  if (videoInput) {
    const ytId = parseYouTubeId(videoInput);
    if (ytId) video = youtubeWatchUrl(ytId);
    else if (existing && existing.video && videoInput === existing.video) video = existing.video;
    else {
      showToast("⚠️ That doesn't look like a YouTube link", 'error', 5000);
      saveBtn.disabled = false;
      saveBtn.textContent = oldBtnLabel;
      return;
    }
  }
```
(Clearing the field removes the video.)

### 6. `openArticle`
Replace the `if (a.video) { parts.push(<video…>) }` block with:
```js
  if (a.video) parts.push(videoHtml(a.video, 'article-video'));
```
and delete `hydrateVideoElements(mediaOut);`

### 7. `shareCurrentArticle`
- Replace
  `if (a.video) { const videoFile = … } else if (a.photo) {` with `if (a.photo) {`
- Change the `caption` line to:
```js
  const vid = a.video && parseYouTubeId(a.video) ? youtubeWatchUrl(parseYouTubeId(a.video)) : '';
  const caption = `${a.title}${c ? ' · ' + c.name : ''} — ${shareSnippet(a)}${vid ? '\n▶ ' + vid : ''}`;
```
- In the fallback modal, delete the `${a.video ? … share-dl-video … : ''}` line and the whole `document.getElementById('share-dl-video')?.addEventListener(…)` block.

### 8. Event listeners
Replace the entire `document.getElementById('entry-video').addEventListener('change', …)` block with:
```js
document.getElementById('entry-video-url').addEventListener('input', updateVideoPreview);
```

### 9. `downloadBackup`
Change the status text to: `'✅ Backup downloaded. (Videos are YouTube links stored in the article records. The file also contains your saved tokens/API key, so keep it private.)'`

---
## index.html

Replace the Video `<div class="field">` (the one with `id="entry-video"`) with:
```html
<div class="field">
  <label for="entry-video-url">YouTube link (optional)</label>
  <input type="url" id="entry-video-url" placeholder="https://www.youtube.com/watch?v=…">
  <div class="category-hint">Upload the video to YouTube (Unlisted works well), then paste its link here.</div>
  <div id="entry-video-preview" style="margin-top:8px;"></div>
</div>
```
Also delete the `restore-video-input` field ("2. Video files…") in Backup & Restore, and change "articles, photos, videos, GitHub/AI/Facebook settings" to "articles, photos, video links, GitHub/AI/Facebook settings".

---
## styles.css

Add at the end:
```css
.video-embed {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin: 1rem 0;
  border-radius: 0.75rem;
  overflow: hidden;
  background: #000;
}
.video-embed iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
#entry-video-preview .video-embed { max-width: 360px; }
```
