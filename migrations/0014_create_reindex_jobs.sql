-- migrate:up
-- Tracks a background job that re-embeds every already-indexed document's stored chunk text
-- with a newly-activated embedding model and rebuilds its FAISS index, mirroring
-- ingestion_jobs/benchmark_jobs (see src/reindex.py, POST /embeddings/active).
CREATE TABLE reindex_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    model TEXT NOT NULL,
    total_documents INTEGER NOT NULL DEFAULT 0,
    completed_documents INTEGER NOT NULL DEFAULT 0,
    current_document TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

-- migrate:down
DROP TABLE reindex_jobs;
