-- The Commonplace — articles table
-- Run this once against your Vercel Postgres (Neon) database before deploying,
-- e.g. via the Neon dashboard's SQL editor or `psql "$DATABASE_URL" -f schema.sql`.

CREATE TABLE IF NOT EXISTS articles (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  date        DATE NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  body        TEXT NOT NULL,
  summary     TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  photo_url   TEXT,
  video_url   TEXT,
  github_url  TEXT,
  page_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS articles_date_idx ON articles (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS articles_category_idx ON articles (category);
