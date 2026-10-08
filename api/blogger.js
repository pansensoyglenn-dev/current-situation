module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  const blogId = b.blogId || process.env.BLOGGER_BLOG_ID;
  const clientId = b.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = b.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = b.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;
  const { postId, title, content, labels } = b;

  if (!blogId || !clientId || !clientSecret || !refreshToken) {
    return res.status(400).json({ error: 'Missing Blogger credentials' });
  }
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });

  try {
    const tokRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token'
      })
    });
    const tok = await tokRes.json();
    if (!tokRes.ok || !tok.access_token) {
      return res.status(502).json({ error: 'Google auth failed: ' + (tok.error_description || tok.error || 'unknown') });
    }

    const base = `https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts`;
    const headers = { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ kind: 'blogger#post', title, content, labels: labels || [] });

    let r = null;
    if (postId) r = await fetch(`${base}/${postId}`, { method: 'PUT', headers, body });
    if (!r || r.status === 404) r = await fetch(`${base}?isDraft=false`, { method: 'POST', headers, body });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'Blogger error' });
    return res.status(200).json({ id: data.id, url: data.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
