const { put } = require('@vercel/blob');
const { applyCors, isAuthorized, readRawBody } = require('./_lib');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
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
