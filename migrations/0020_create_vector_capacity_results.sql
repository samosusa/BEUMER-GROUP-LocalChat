-- migrate:up
-- Vector-DB capacity sweep: same job-row/results-row shape as benchmark_jobs/eval_results and
-- embedding_benchmark_jobs/embedding_eval_results (see src/vector_capacity_benchmark.py, POST
-- /vector-capacity/benchmark), but one result row per document-count checkpoint instead of per
-- model/device - this benchmark has a single fixed subject (the FAISS vector store itself) and
-- sweeps document count rather than model choice. The documents inserted to produce each row are
-- synthetic and throwaway (see the module docstring); only these measurement rows persist.
CREATE TABLE vector_capacity_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    steps JSON NOT NULL,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    current_doc_count INTEGER,
    error TEXT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

CREATE TABLE vector_capacity_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vector_capacity_job_id INTEGER NOT NULL REFERENCES vector_capacity_jobs(id) ON DELETE CASCADE,
    doc_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    step_docs INTEGER NOT NULL,
    step_s REAL NOT NULL,
    docs_per_s REAL,
    vector_dir_mb REAL NOT NULL,
    vector_file_count INTEGER NOT NULL,
    db_size_mb REAL NOT NULL,
    rss_mb REAL NOT NULL,
    query_count INTEGER NOT NULL,
    query_latency_ms_mean REAL,
    query_latency_ms_min REAL,
    query_latency_ms_max REAL,
    query_hits_mean REAL,
    run_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE vector_capacity_results;
DROP TABLE vector_capacity_jobs;
