-- migrate:up
CREATE TABLE ingestion_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    offset INTEGER NOT NULL DEFAULT 0,
    total_chunks INTEGER NOT NULL DEFAULT 0,
    last_checkpoint JSON,
    created_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE ingestion_jobs;