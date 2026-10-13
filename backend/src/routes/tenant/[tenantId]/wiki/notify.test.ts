import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  spyOn,
} from "bun:test";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
  TEST_ORG1_USER_3,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { generateUserSessionJwt } from "@framework/lib/auth";
import {
  testing_createTeamAndAddUsers,
  testing_deleteTeam,
} from "@framework/test/permissions.test";
import { getDb } from "@framework/lib/db/db-connection";
import { teamMembers, tenantMembers, users } from "@framework/lib/db/db-schema";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { smtpService, type EmailOptions } from "@framework/lib/email";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import defineWikiRoutes from "./index";
import {
  buildPageNotificationEmail,
  messageParagraphs,
} from "../../../../lib/wiki/notify-page";

const TENANT = TEST_ORGANISATION_1.id;

let app: SymbiosikaFrameworkHonoApp;
let user1Token: string;
let user2Token: string;
let teamId: string;
let readOnlyTeamId: string;
let teamPageId: string;
let readOnlyTeamPageId: string;
let orgPageId: string;
let personalPageId: string;
const createdPages: string[] = [];

const sent: EmailOptions[] = [];
const sendSpy = spyOn(smtpService, "sendMailInBackground").mockImplementation(
  (options: EmailOptions) => {
    sent.push(options);
  }
);

const tokenFor = async (user: { id: string; email: string }) =>
  (
    await generateUserSessionJwt(
      { email: user.email, id: user.id, firstname: "", surname: "" },
      86400
    )
  ).token;

const createPage = async (data: {
  title: string;
  teamId?: string;
  tenantWide?: boolean;
}) => {
  const page = await createKnowledgeText({
    tenantId: TENANT,
    title: data.title,
    text: "",
    createdBy: TEST_ORG1_USER_1.id,
    userId: TEST_ORG1_USER_1.id,
    teamId: data.teamId ?? null,
    tenantWide: data.tenantWide ?? false,
  });
  createdPages.push(page.id);
  return page.id;
};

const emailOf = async (userId: string) => {
  const [user] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return user!.email.toLowerCase();
};

describe("Wiki page notifications", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;
    user2Token = await tokenFor(TEST_ORG1_USER_2);

    app = new Hono();
    defineWikiRoutes(app);

    teamId = (
      await testing_createTeamAndAddUsers(TENANT, [
        TEST_ORG1_USER_1.id,
        TEST_ORG1_USER_2.id,
      ])
    ).teamId;
    // user2 may only READ this team's knowledge
    readOnlyTeamId = (
      await testing_createTeamAndAddUsers(TENANT, [
        TEST_ORG1_USER_1.id,
        TEST_ORG1_USER_2.id,
      ])
    ).teamId;
    await getDb()
      .update(teamMembers)
      .set({ knowledgeAccess: "read" })
      .where(
        and(
          eq(teamMembers.teamId, readOnlyTeamId),
          eq(teamMembers.userId, TEST_ORG1_USER_2.id)
        )
      );

    teamPageId = await createPage({ title: "Team news", teamId });
    readOnlyTeamPageId = await createPage({
      title: "Read-only team page",
      teamId: readOnlyTeamId,
    });
    orgPageId = await createPage({ title: "Org <news>", tenantWide: true });
    personalPageId = await createPage({ title: "My draft" });
  });

  beforeEach(() => {
    sent.length = 0;
  });

  afterAll(() => {
    sendSpy.mockRestore();
    Promise.all(
      createdPages.map((id) =>
        getDb().delete(knowledgeText).where(eq(knowledgeText.id, id))
      )
    )
      .then(() => testing_deleteTeam([teamId, readOnlyTeamId]))
      .catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("a team page reaches every team member, one mail each", async () => {
    const audience = await testFetcher.get(
      app,
      `/tenant/${TENANT}/wiki/${teamPageId}/notify`,
      user1Token
    );
    expect(audience.status).toBe(200);
    expect(audience.jsonResponse).toMatchObject({
      scope: "team",
      recipientCount: 2,
      canNotify: true,
    });
    expect(typeof audience.jsonResponse.teamName).toBe("string");

    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${teamPageId}/notify`,
      user1Token,
      { message: "Hallo Team,\n\nbitte lesen." }
    );
    expect(response.status).toBe(200);
    expect(response.jsonResponse).toEqual({ scope: "team", recipientCount: 2 });

    expect(sent.map((mail) => mail.recipients)).toEqual(
      [
        [await emailOf(TEST_ORG1_USER_1.id)],
        [await emailOf(TEST_ORG1_USER_2.id)],
      ].sort()
    );
    const mail = sent[0]!;
    expect(mail.subject).toBe("Neue Wiki-Seite: Team news");
    expect(mail.html).toContain("Hallo Team,");
    expect(mail.html).toContain(`#/tenant/${TENANT}/wiki/${teamPageId}`);
    expect(mail.text).toContain(`#/tenant/${TENANT}/wiki/${teamPageId}`);
  });

  test("an organisation page reaches the whole organisation", async () => {
    const members = await getDb()
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, TENANT));

    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${orgPageId}/notify`,
      user1Token,
      { subject: "Bitte lesen", message: "Neue Infos" }
    );
    expect(response.status).toBe(200);
    expect(response.jsonResponse.scope).toBe("organisation");
    expect(response.jsonResponse.recipientCount).toBe(members.length);
    expect(sent).toHaveLength(members.length);
    expect(sent.map((mail) => mail.recipients[0])).toContain(
      await emailOf(TEST_ORG1_USER_3.id)
    );
    expect(sent[0]!.subject).toBe("Bitte lesen");
    // the page title is escaped in the html
    expect(sent[0]!.html).toContain("Org &lt;news&gt;");
  });

  test("a personal page only reaches its owner", async () => {
    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${personalPageId}/notify`,
      user1Token,
      { message: "Test" }
    );
    expect(response.status).toBe(200);
    expect(response.jsonResponse).toEqual({
      scope: "personal",
      recipientCount: 1,
    });
    expect(sent.map((mail) => mail.recipients)).toEqual([
      [await emailOf(TEST_ORG1_USER_1.id)],
    ]);
  });

  test("read access is not enough to send", async () => {
    const audience = await testFetcher.get(
      app,
      `/tenant/${TENANT}/wiki/${readOnlyTeamPageId}/notify`,
      user2Token
    );
    expect(audience.status).toBe(200);
    expect(audience.jsonResponse.canNotify).toBe(false);

    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${readOnlyTeamPageId}/notify`,
      user2Token,
      { message: "Hallo" }
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  test("someone else's personal page is not found", async () => {
    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${personalPageId}/notify`,
      user2Token,
      { message: "Hallo" }
    );
    expect(response.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  test("an empty message is rejected", async () => {
    const response = await testFetcher.post(
      app,
      `/tenant/${TENANT}/wiki/${teamPageId}/notify`,
      user1Token,
      { message: "   " }
    );
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("page notification mail", () => {
  test("the author's text becomes escaped paragraphs", () => {
    expect(messageParagraphs("Hallo <b>Team</b>,\n\nZeile 1\nZeile 2\n\n\n")).toEqual([
      "Hallo &lt;b&gt;Team&lt;/b&gt;,",
      "Zeile 1<br />Zeile 2",
    ]);
  });

  test("always carries the link and names the sender", () => {
    const mail = buildPageNotificationEmail({
      appName: "Wiki",
      pageTitle: "Preise",
      pageUrl: "https://wiki.example/static/app/#/tenant/t/wiki/p",
      senderName: "Ada Lovelace",
      message: "Neue Preise sind da.",
    });
    expect(mail.subject).toBe("Neue Wiki-Seite: Preise");
    expect(mail.html).toContain(
      'href="https://wiki.example/static/app/#/tenant/t/wiki/p"'
    );
    expect(mail.html).toContain("Ada Lovelace");
    expect(mail.text).toBe(
      "Neue Preise sind da.\n\nPreise: https://wiki.example/static/app/#/tenant/t/wiki/p\n\nAda Lovelace hat dich über diese Seite benachrichtigt."
    );
  });
});
