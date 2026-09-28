-- migrate:up
-- What retrieval actually searched for on this turn, which is no longer necessarily what
-- the user typed: a follow-up is rewritten into a standalone question first (see
-- src/conversation_context.py). Stored so a wrong answer can be attributed to retrieval or
-- to generation after the fact - without it, the query that produced a bad follow-up
-- answer exists only for the length of one HTTP response.
-- Null on rows written before this migration, and on turns where the user's own question
-- was searched unchanged.
ALTER TABLE messages ADD COLUMN search_query TEXT;
ALTER TABLE messages ADD COLUMN search_rewritten BOOLEAN;

-- migrate:down
ALTER TABLE messages DROP COLUMN search_query;
ALTER TABLE messages DROP COLUMN search_rewritten;
