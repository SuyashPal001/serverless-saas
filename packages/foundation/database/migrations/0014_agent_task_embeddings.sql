-- Add vector embedding column to agent_tasks for RAG-injected planning
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Index for cosine similarity search on completed tasks.
-- NOTE: ivfflat requires at least a few rows to build efficiently.
-- If migration fails here, skip the index and add it manually once you have data:
--   CREATE INDEX agent_tasks_embedding_done_idx ON agent_tasks
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)
--     WHERE status = 'done' AND embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_embedding_done_idx
  ON agent_tasks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10)
  WHERE status = 'done' AND embedding IS NOT NULL;
