-- Data migration: organisation owners get their write access back.
--
-- The read/write level lives on base_tenant_members.knowledge_access and is
-- the only thing the framework's write check (checkTenantKnowledgeWriteAccess)
-- looks at — the role plays no part. The members endpoint allowed setting an
-- owner to "read", which locked that owner out of every organisation-wide
-- page, and the members table refused to let anyone edit their own row, so it
-- could not be undone from the UI.
--
-- From now on the app keeps owners on "write" (see
-- src/lib/http/owner-knowledge-access.ts); this repairs the rows that were
-- already set to "read".

--> statement-breakpoint
UPDATE "base_tenant_members"
SET "knowledge_access" = 'write'
WHERE "role" = 'owner' AND "knowledge_access" <> 'write';
