-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Table: documents
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES users(id),
  name         TEXT NOT NULL,
  file_key     TEXT,
  mime_type    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  hash         VARCHAR(64) NOT NULL,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, hash)
);

-- Table: document_chunks
CREATE TABLE document_chunks (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  embedding    VECTOR(768),
  tsv          TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  chunk_index  INTEGER NOT NULL,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table: embedding_cache
CREATE TABLE embedding_cache (
  hash         VARCHAR(64) NOT NULL,
  provider     VARCHAR(50) NOT NULL,
  model        VARCHAR(200) NOT NULL,
  embedding    VECTOR(768) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hash, provider, model)
);

-- Indexes
CREATE INDEX idx_chunks_hnsw   ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_tsv    ON document_chunks USING GIN(tsv);
CREATE INDEX idx_chunks_tenant ON document_chunks(tenant_id);
CREATE INDEX idx_chunks_doc    ON document_chunks(document_id);
CREATE UNIQUE INDEX idx_docs_tenant_hash ON documents(tenant_id, hash);
