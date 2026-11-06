-- Teams flagged with "add new users by default" (base_teams.add_new_users_by_default)
-- get a configurable knowledge access level for those auto-added members:
-- base_teams.meta->>'newUserKnowledgeAccess' = 'read' | 'write'.
-- Missing or anything else means 'read' (read-only is the safe default).
--
-- The framework's addUserToDefaultTeams() inserts the membership without a
-- knowledge_access, so the column default 'write' would apply. The framework
-- must not be changed, so this BEFORE INSERT trigger applies the team's level
-- instead — but only for an auto-join: a plain "member" row in a flagged team
-- for a user whose organisation membership is brand new (joined in the last
-- 5 minutes; the framework adds the team rows right after the tenant row).
-- Manual adds of long-standing members, admins and later edits keep whatever
-- was set explicitly. Covered by src/lib/teams/new-user-team-access.test.ts.

CREATE OR REPLACE FUNCTION app_apply_new_user_team_knowledge_access()
RETURNS trigger AS $$
DECLARE
  team_flagged boolean;
  team_tenant uuid;
  team_level text;
BEGIN
  IF NEW.role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT t.add_new_users_by_default, t.tenant_id, t.meta->>'newUserKnowledgeAccess'
    INTO team_flagged, team_tenant, team_level
    FROM base_teams t
   WHERE t.id = NEW.team_id;

  IF team_flagged IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF team_level IS NULL OR team_level NOT IN ('read', 'write') THEN
    team_level := 'read';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM base_tenant_members tm
     WHERE tm.tenant_id = team_tenant
       AND tm.user_id = NEW.user_id
       AND tm.joined_at >= localtimestamp - interval '5 minutes'
  ) THEN
    NEW.knowledge_access := team_level::knowledge_access_level;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_new_user_team_knowledge_access ON base_team_members;
--> statement-breakpoint
CREATE TRIGGER app_new_user_team_knowledge_access
  BEFORE INSERT ON base_team_members
  FOR EACH ROW
  EXECUTE FUNCTION app_apply_new_user_team_knowledge_access();
