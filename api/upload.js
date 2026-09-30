const { put } = require('@vercel/blob');
const { applyCors, readRawBody } = require('./_lib');

// POST /api/upload?filename=photo.jpg&contentType=image/jpeg
// Body: the raw file bytes (the client sends the File/Blob object directly
// as the fetch body — no multipart form parsing needed).
// Returns { url } — a public, permanent URL to store on the article.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const url = new URL(req.url, 'http://x');
    const filename = url.searchParams.get('filename') || `upload-${Date.now()}`;
    const contentType = url.searchParams.get('contentType') || 'application/octet-stream';

    const bytes = await readRawBody(req);
    if (!bytes.length) {
      res.status(400).json({ error: 'empty request body' });
      return;
    }

    // Explicitly pass the token so the SDK never falls back to OIDC or
    // silently fails when the env var is present but not auto-detected.
    const token = process.env.BLOB_READ_WRITE_TOKEN;

    const pathname = `${Date.now()}-${filename}`;
    const blob = await put(pathname, bytes, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      ...(token ? { token } : {})
    });

    res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('upload API error:', e);

    let detail = e.message || 'upload failed';
    if (/no token found/i.test(detail)) {
      detail = 'BLOB_READ_WRITE_TOKEN is not set in this deployment\'s environment. '
             + 'Add it in Vercel → Settings → Environment Variables, then redeploy.';
    }

    res.status(500).json({ error: detail });
  }
};
