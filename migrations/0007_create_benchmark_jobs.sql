-- migrate:up
CREATE TABLE benchmark_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    devices JSON NOT NULL,
    models JSON,
    total_runs INTEGER NOT NULL DEFAULT 0,
    completed_runs INTEGER NOT NULL DEFAULT 0,
    current_model TEXT,
    current_device TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

-- migrate:down
DROP TABLE benchmark_jobs;
