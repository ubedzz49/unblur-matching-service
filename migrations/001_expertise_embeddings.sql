-- Shares the same RDS instance and database as unblur-user-service (pragmatic reuse of
-- existing infra rather than a whole new RDS instance for one small table) -- but this
-- service owns and only touches these tables, never the users/expertise_* ones.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS expertise_embeddings (
  expertise_level_id UUID PRIMARY KEY,
  expertise_type_id UUID NOT NULL,
  label TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ivfflat approximate-nearest-neighbor index for cosine distance; fine at this table
-- size (hundreds of rows) even with a small "lists" count, tune upward as it grows
CREATE INDEX IF NOT EXISTS idx_expertise_embeddings_cosine
  ON expertise_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
