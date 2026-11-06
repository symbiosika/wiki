/**
 * Knowledge access of users who are auto-added to a team flagged with
 * "add new users by default".
 *
 * The level lives in `team.meta.newUserKnowledgeAccess` ("read" | "write",
 * missing = "read") and is applied by the database trigger from
 * drizzle-sql/0013_new_user_team_knowledge_access.sql, because the framework's
 * addUserToDefaultTeams() inserts the membership without a level (column
 * default "write"). Driven through the real framework functions.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_2,
  TEST_ORG2_USER_1,
  TEST_ORG3_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import {
  teams,
  teamMembers,
  tenantMembers,
} from "@framework/lib/db/schema/users";
import { addTeamMember, createTeam } from "@framework/lib/usermanagement/teams";
import { addTenantMember } from "@framework/lib/usermanagement/tenants";
import {
  acceptTenantInvitation,
  createTenantInvitation,
} from "@framework/lib/usermanagement/invitations";

const TENANT = TEST_ORGANISATION_2.id;
const NAME_PREFIX = "new-user-team-access-test";
// Joins the organisation fresh in every test.
const NEW_USER = TEST_ORG3_USER_1;

let defaultNoMeta: string;
let defaultRead: string;
let defaultWrite: string;
let normalTeam: string;

const accessOf = async (teamId: string, userId: string) => {
  const [row] = await getDb()
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return row?.knowledgeAccess ?? null;
};

const removeFromTenant = async (userId: string) => {
  await getDb()
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        inArray(teamMembers.teamId, [
          defaultNoMeta,
          defaultRead,
          defaultWrite,
          normalTeam,
        ]),
      ),
    );
  await getDb()
    .delete(tenantMembers)
    .where(
      and(eq(tenantMembers.tenantId, TENANT), eq(tenantMembers.userId, userId)),
    );
};

const cleanup = async () => {
  await getDb().delete(teams).where(like(teams.name, `${NAME_PREFIX}%`));
};

describe("Auto-added team members: configurable knowledge access", () => {
  beforeAll(async () => {
    await initTests();
    await cleanup();

    const create = async (
      suffix: string,
      addNewUsersByDefault: boolean,
      meta?: Record<string, unknown>,
    ) =>
      (
        await createTeam({
          name: `${NAME_PREFIX}-${suffix}`,
          tenantId: TENANT,
          addNewUsersByDefault,
          ...(meta && { meta }),
        })
      ).id;

    defaultNoMeta = await create("default-no-meta", true);
    defaultRead = await create("default-read", true, {
      newUserKnowledgeAccess: "read",
      other: "kept",
    });
    defaultWrite = await create("default-write", true, {
      newUserKnowledgeAccess: "write",
    });
    normalTeam = await create("normal", false);
  });

  afterAll(async () => {
    await removeFromTenant(NEW_USER.id);
    await cleanup();
  });

  test("a new organisation member gets the configured level (default: read)", async () => {
    await removeFromTenant(NEW_USER.id);
    await addTenantMember(TENANT, NEW_USER.id, "member");

    expect(await accessOf(defaultNoMeta, NEW_USER.id)).toBe("read");
    expect(await accessOf(defaultRead, NEW_USER.id)).toBe("read");
    expect(await accessOf(defaultWrite, NEW_USER.id)).toBe("write");
    expect(await accessOf(normalTeam, NEW_USER.id)).toBeNull();
  });

  test("accepting an invitation applies the configured level too", async () => {
    await removeFromTenant(NEW_USER.id);
    const invitation = await createTenantInvitation({
      tenantId: TENANT,
      email: NEW_USER.email,
      role: "member",
      status: "pending",
    });
    await acceptTenantInvitation(invitation.id, NEW_USER.id, TENANT);

    expect(await accessOf(defaultNoMeta, NEW_USER.id)).toBe("read");
    expect(await accessOf(defaultRead, NEW_USER.id)).toBe("read");
    expect(await accessOf(defaultWrite, NEW_USER.id)).toBe("write");
  });

  test("an unknown value in meta falls back to read", async () => {
    await getDb()
      .update(teams)
      .set({ meta: { newUserKnowledgeAccess: "admin" } })
      .where(eq(teams.id, defaultWrite));
    await removeFromTenant(NEW_USER.id);
    await addTenantMember(TENANT, NEW_USER.id, "member");

    expect(await accessOf(defaultWrite, NEW_USER.id)).toBe("read");

    await getDb()
      .update(teams)
      .set({ meta: { newUserKnowledgeAccess: "write" } })
      .where(eq(teams.id, defaultWrite));
  });

  test("a manual add of a long-standing member keeps the explicit level", async () => {
    // Make sure the user is a member of the organisation and pretend they
    // joined a while ago.
    await addTenantMember(TENANT, TEST_ORG2_USER_1.id, "member").catch(
      () => undefined,
    );
    await getDb()
      .update(tenantMembers)
      .set({ joinedAt: sql`now() - interval '1 day'` })
      .where(
        and(
          eq(tenantMembers.tenantId, TENANT),
          eq(tenantMembers.userId, TEST_ORG2_USER_1.id),
        ),
      );
    await getDb()
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, defaultRead),
          eq(teamMembers.userId, TEST_ORG2_USER_1.id),
        ),
      );

    await addTeamMember(
      defaultRead,
      TENANT,
      TEST_ORG2_USER_1.id,
      "member",
      "write",
    );
    expect(await accessOf(defaultRead, TEST_ORG2_USER_1.id)).toBe("write");
  });

  test("team admins are never downgraded", async () => {
    await removeFromTenant(NEW_USER.id);
    await addTenantMember(TENANT, NEW_USER.id, "member");
    await getDb()
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, defaultRead),
          eq(teamMembers.userId, NEW_USER.id),
        ),
      );

    await addTeamMember(defaultRead, TENANT, NEW_USER.id, "admin", "write");
    expect(await accessOf(defaultRead, NEW_USER.id)).toBe("write");
  });
});
