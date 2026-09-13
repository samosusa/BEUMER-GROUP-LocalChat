-- migrate:up
-- Lets a document that belongs to a project also be surfaced in the general (project-less)
-- corpus, without duplicating its rows/chunks/embeddings. See src/retriever.py: a document
-- is visible in "general" when project_id IS NULL OR also_general IS TRUE.
ALTER TABLE documents ADD COLUMN also_general BOOLEAN NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE documents DROP COLUMN also_general;
