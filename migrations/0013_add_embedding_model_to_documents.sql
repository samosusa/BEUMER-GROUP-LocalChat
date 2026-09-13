-- migrate:up
-- Tracks which embedding model produced a document's FAISS vectors, and their dimension, so
-- the retriever (src/retriever.py) can tell a document embedded under a previous model apart
-- from ones matching the currently active model instead of silently mixing incompatible
-- vector spaces in one similarity search. Backfilled to the model this app has always used,
-- since every document indexed before this migration was embedded with it.
ALTER TABLE documents ADD COLUMN embedding_model TEXT;
ALTER TABLE documents ADD COLUMN embedding_dim INTEGER;
UPDATE documents SET embedding_model = 'nomic-ai/nomic-embed-text-v1.5', embedding_dim = 768
WHERE indexed_at IS NOT NULL;

-- migrate:down
ALTER TABLE documents DROP COLUMN embedding_model;
ALTER TABLE documents DROP COLUMN embedding_dim;
