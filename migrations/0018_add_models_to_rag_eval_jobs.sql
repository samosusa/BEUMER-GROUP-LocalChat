-- migrate:up
-- Records which answer model and embedding model were active when a run started (see
-- src/api/rag_eval.py start_rag_eval), so two historical runs can be told apart by more than
-- just their dataset and timestamp when comparing them side by side. Null for runs from
-- before this migration, since the active model at the time was never captured.
ALTER TABLE rag_eval_jobs ADD COLUMN answer_model TEXT;
ALTER TABLE rag_eval_jobs ADD COLUMN embedding_model TEXT;

-- migrate:down
ALTER TABLE rag_eval_jobs DROP COLUMN answer_model;
ALTER TABLE rag_eval_jobs DROP COLUMN embedding_model;
