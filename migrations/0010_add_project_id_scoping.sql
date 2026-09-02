-- migrate:up
-- NULL project_id means "general corpus" (unscoped), preserving today's behavior for
-- existing documents and conversations. Deleting a project takes its own documents and
-- conversations with it, the same way deleting a conversation cascades its messages.
ALTER TABLE documents ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;

-- migrate:down
ALTER TABLE documents DROP COLUMN project_id;
ALTER TABLE conversations DROP COLUMN project_id;
