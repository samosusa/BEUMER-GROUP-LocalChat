-- migrate:up
-- eval_results has always been vestigial (no code ever read or wrote it); repurposed
-- here as the structured store for /benchmark/results rows instead of loose CSV/JSON
-- files, so results are queryable, sortable, and persistent across restarts.
DROP TABLE eval_results;

CREATE TABLE eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_job_id INTEGER NOT NULL REFERENCES benchmark_jobs(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    device TEXT NOT NULL,
    device_name TEXT,
    status TEXT NOT NULL,
    detail TEXT,
    load_s REAL,
    ttft_s REAL,
    gen_tokens INTEGER,
    tok_s REAL,
    total_s REAL,
    peak_mem_mb REAL,
    peak_vram_mb REAL,
    question TEXT,
    run_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE eval_results;

CREATE TABLE eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    top_k JSON NOT NULL,
    run_at TIMESTAMP NOT NULL
);
