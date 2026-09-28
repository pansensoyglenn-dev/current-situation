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

    // Prefix with a timestamp so re-uploading a file with the same name
    // never collides with or overwrites an earlier one.
    const pathname = `${Date.now()}-${filename}`;
    const blob = await put(pathname, bytes, {
      access: 'public',
      contentType,
      addRandomSuffix: false
    });

    res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('upload API error:', e);
    res.status(500).json({ error: e.message || 'upload failed' });
  }
};
