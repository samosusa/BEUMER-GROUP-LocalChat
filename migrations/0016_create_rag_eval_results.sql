-- migrate:up
-- Runs the labeled question set in data/eval/rag_qa_pairs.json end to end (retrieval +
-- generation, via src/rag_service.answer()) against whichever project's documents are
-- currently ingested, scoring each question both objectively (did the expected source
-- document actually show up in the citations) and via an LLM-as-judge verdict. See
-- src/rag_eval.py, POST /rag-eval.
CREATE TABLE rag_eval_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    total_questions INTEGER NOT NULL DEFAULT 0,
    completed_questions INTEGER NOT NULL DEFAULT 0,
    current_question TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);

CREATE TABLE rag_eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rag_eval_job_id INTEGER NOT NULL REFERENCES rag_eval_jobs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    question TEXT NOT NULL,
    expected_answer TEXT NOT NULL,
    actual_answer TEXT,
    not_found BOOLEAN NOT NULL,
    retrieval_hit BOOLEAN NOT NULL,
    judge_verdict TEXT,
    judge_detail TEXT,
    complexity_tier TEXT,
    complexity_score REAL,
    latency_s REAL,
    citations JSON,
    run_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE rag_eval_results;
DROP TABLE rag_eval_jobs;
