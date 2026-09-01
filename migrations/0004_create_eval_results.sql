-- migrate:up
CREATE TABLE eval_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    top_k JSON NOT NULL,
    run_at TIMESTAMP NOT NULL
);

-- migrate:down
DROP TABLE eval_results;