-- migrate:up
-- Embedding-side counterpart to benchmark_jobs/eval_results (see src/embedding_benchmark.py,
-- POST /embeddings/benchmark): one job row per run, one result row per model/text-tier
-- combination timed within it. A separate pair of tables rather than reusing
-- benchmark_jobs/eval_results because those are shaped around GGUF model + device + token
-- generation metrics that don't apply here.
CREATE TABLE embedding_benchmark_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    models JSON,
    total_runs INTEGER NOT NULL DEFAULT 0,
    completed_runs INTEGER NOT NULL DEFAULT 0,
    current_model TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

CREATE TABLE embedding_eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    embedding_benchmark_job_id INTEGER NOT NULL REFERENCES embedding_benchmark_jobs(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    dimension INTEGER,
    status TEXT NOT NULL,
    detail TEXT,
    load_s REAL,
    text_label TEXT,
    text_count INTEGER,
    embed_s REAL,
    texts_per_s REAL,
    peak_mem_mb REAL,
    run_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE embedding_eval_results;
DROP TABLE embedding_benchmark_jobs;
