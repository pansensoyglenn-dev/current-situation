const { sql, applyCors, readJsonBody } = require('./_lib');

// GET    /api/articles          -> list every article, newest first
// POST   /api/articles          -> create one article, returns it with its new id
// PUT    /api/articles?id=5     -> update one article
// DELETE /api/articles?id=5     -> delete one article
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, title, category, date, content_type, body, summary, tags,
               photo_url, video_url, github_url, page_url
        FROM articles
        ORDER BY date DESC, id DESC
      `;
      res.status(200).json(rows);
      return;
    }

    if (req.method === 'POST') {
      const a = await readJsonBody(req);
      if (!a.title || !a.body || !a.category || !a.date) {
        res.status(400).json({ error: 'title, category, date, and body are required' });
        return;
      }
      const rows = await sql`
        INSERT INTO articles (title, category, date, content_type, body, summary, tags, photo_url, video_url, github_url, page_url)
        VALUES (${a.title}, ${a.category}, ${a.date}, ${a.contentType || 'text'}, ${a.body},
                ${a.summary || null}, ${a.tags || []}, ${a.photoUrl || null}, ${a.videoUrl || null},
                ${a.githubUrl || null}, ${a.pageUrl || null})
        RETURNING id, title, category, date, content_type, body, summary, tags,
                  photo_url, video_url, github_url, page_url
      `;
      res.status(201).json(rows[0]);
      return;
    }

    if (req.method === 'PUT') {
      const id = parseInt(new URL(req.url, 'http://x').searchParams.get('id'), 10);
      if (!id) { res.status(400).json({ error: 'id query param required' }); return; }
      const a = await readJsonBody(req);
      const rows = await sql`
        UPDATE articles SET
          title = COALESCE(${a.title}, title),
          category = COALESCE(${a.category}, category),
          date = COALESCE(${a.date}, date),
          content_type = COALESCE(${a.contentType}, content_type),
          body = COALESCE(${a.body}, body),
          summary = COALESCE(${a.summary}, summary),
          tags = COALESCE(${a.tags}, tags),
          photo_url = COALESCE(${a.photoUrl}, photo_url),
          video_url = COALESCE(${a.videoUrl}, video_url),
          github_url = COALESCE(${a.githubUrl}, github_url),
          page_url = COALESCE(${a.pageUrl}, page_url),
          updated_at = now()
        WHERE id = ${id}
        RETURNING id, title, category, date, content_type, body, summary, tags,
                  photo_url, video_url, github_url, page_url
      `;
      if (!rows.length) { res.status(404).json({ error: 'not found' }); return; }
      res.status(200).json(rows[0]);
      return;
    }

    if (req.method === 'DELETE') {
      const id = parseInt(new URL(req.url, 'http://x').searchParams.get('id'), 10);
      if (!id) { res.status(400).json({ error: 'id query param required' }); return; }
      await sql`DELETE FROM articles WHERE id = ${id}`;
      res.status(204).end();
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('articles API error:', e);
    res.status(e.statusCode || 500).json({ error: e.message || 'internal error' });
  }
};
