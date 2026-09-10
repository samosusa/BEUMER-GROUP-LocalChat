-- migrate:up
-- Document complexity is computed once at ingest time from the parsed text (see
-- src/ingest/pipeline.py) using the same Flesch-Kincaid heuristic in src/complexity.py
-- as query complexity. Message complexity is the preceding user question's tier/score,
-- stored on the assistant's reply so the chat UI can show how hard a question was.
ALTER TABLE documents ADD COLUMN complexity_tier TEXT;
ALTER TABLE documents ADD COLUMN complexity_score REAL;
ALTER TABLE messages ADD COLUMN complexity_tier TEXT;
ALTER TABLE messages ADD COLUMN complexity_score REAL;

-- migrate:down
ALTER TABLE documents DROP COLUMN complexity_tier;
ALTER TABLE documents DROP COLUMN complexity_score;
ALTER TABLE messages DROP COLUMN complexity_tier;
ALTER TABLE messages DROP COLUMN complexity_score;
