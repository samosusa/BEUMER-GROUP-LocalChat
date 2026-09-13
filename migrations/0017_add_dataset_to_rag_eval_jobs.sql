-- migrate:up
-- Multiple question sets can now live under data/eval/ (see src/rag_eval.py); this records
-- which one a given run actually used, backfilled to the one this app originally shipped
-- with since every run before this migration used it exclusively.
ALTER TABLE rag_eval_jobs ADD COLUMN dataset TEXT NOT NULL DEFAULT 'rag_qa_pairs';

-- migrate:down
ALTER TABLE rag_eval_jobs DROP COLUMN dataset;
