const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { applyCors } = require('./_lib');

// POST /api/video-upload?filename=clip.mp4&contentType=video/mp4&size=123456
// Returns { uploadUrl, publicUrl }.
// The browser then PUTs the video straight to uploadUrl (Backblaze B2, S3-compatible),
// so the video never passes through Vercel: no 4.5 MB body limit, no Blob quota.

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per video
const REGION = process.env.B2_REGION || 'us-east-005';

let s3 = null;
function client() {
  if (!s3) {
    s3 = new S3Client({
      region: REGION,
      endpoint: `https://s3.${REGION}.backblazeb2.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY
      },
      // Newer AWS SDK versions add checksum parameters B2 may reject; only add them when required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
  }
  return s3;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const missing = ['B2_KEY_ID', 'B2_APP_KEY', 'B2_BUCKET'].filter(k => !process.env[k]);
    if (missing.length) {
      res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
      return;
    }

    const url = new URL(req.url, 'http://x');
    const filename = url.searchParams.get('filename') || 'video.mp4';
    const contentType = url.searchParams.get('contentType') || 'video/mp4';
    const size = Number(url.searchParams.get('size') || 0);

    if (!contentType.startsWith('video/')) {
      res.status(400).json({ error: 'only video files can be uploaded here' });
      return;
    }
    if (size > MAX_BYTES) {
      res.status(400).json({ error: 'video is too large (limit 2 GB)' });
      return;
    }

    const safeName = filename.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'video.mp4';
    const key = `videos/${Date.now()}-${safeName}`;
    const bucket = process.env.B2_BUCKET;

    const uploadUrl = await getSignedUrl(
      client(),
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 3600 }
    );

    // Public "friendly URL" for a public bucket, e.g. https://f005.backblazeb2.com/file/<bucket>/<key>
    const cluster = 'f005'; // Explicitly use the correct cluster for us-east-005
    const publicUrl = `https://${cluster}.backblazeb2.com/file/${bucket}/${key}`;

    res.status(200).json({ uploadUrl, publicUrl });
  } catch (e) {
    console.error('video-upload API error:', e);
    res.status(500).json({ error: e.message || 'could not create upload URL' });
  }
};
