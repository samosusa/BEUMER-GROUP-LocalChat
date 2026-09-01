-- migrate:up
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    checksum TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    uploaded_at TIMESTAMP NOT NULL,
    indexed_at TIMESTAMP
);

-- migrate:down
DROP TABLE documents;