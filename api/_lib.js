// Shared helpers for /api functions. Files prefixed with "_" are not treated
// as routes by Vercel, so this file itself is never publicly reachable.
const { neon } = require('@neondatabase/serverless');

// Reusable Neon SQL client — uses the DATABASE_URL Vercel injects automatically
// once you add a Postgres database to this project (Storage tab in the dashboard).
const sql = neon(process.env.DATABASE_URL);

// Open CORS: the Cloudflare-hosted mirror of this app calls these endpoints
// cross-origin, and there's no login here by design (see the app's README/notes),
// so every origin is allowed rather than maintaining an allow-list.
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // caller should stop processing
  }
  return false;
}

// Vercel's plain Node runtime (no framework) doesn't auto-parse bodies, so this
// reads the raw request body as a Buffer regardless of content type. Callers
// decide whether to JSON.parse() it or hand it to Blob as-is.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = { sql, applyCors, readRawBody, readJsonBody };
