import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  createDatabaseClient,
  waitForDbConnection,
  getDb,
} from "@framework/lib/db/db-connection";
import { generateUserSessionJwt } from "@framework/lib/auth";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { eq } from "drizzle-orm";
import { collections } from "../../../../db/schema";
import defineCollectionRoutes from "./index";

let app: SymbiosikaFrameworkHonoApp;
/** owner of organisation 1 */
let token: string;
/** a user of a DIFFERENT organisation */
let otherOrgToken: string;
/** a second member of organisation 1 — same org, different user */
let sameOrgOtherUserToken: string;

const org = TEST_ORGANISATION_1.id;
const org2 = TEST_ORGANISATION_2.id;
const base = `/tenant/${org}/collections`;

/** page ids created by this file, removed in afterAll */
const createdPages: string[] = [];

/**
 * Create a wiki page to anchor a collection on.
 * `scope: "personal"` makes it private to org1's owner, which is what the
 * visibility tests need.
 */
async function makePage(
  title: string,
  scope: "personal" | "organisation" = "organisation",
) {
  const page = await createKnowledgeText({
    tenantId: org,
    title,
    text: "",
    tenantWide: scope === "organisation",
    userId: scope === "personal" ? TEST_ORG1_USER_1.id : null,
  } as any);
  createdPages.push(page.id);
  return page;
}

describe("Collection routes", () => {
  beforeAll(async () => {
    await createDatabaseClient();
    await waitForDbConnection();
    const t = await initTests();
    token = t.user1Token;
    otherOrgToken = t.user2Token;
    sameOrgOtherUserToken = (
      await generateUserSessionJwt(
        {
          email: TEST_ORG1_USER_2.email,
          id: TEST_ORG1_USER_2.id,
          firstname: "",
          surname: "",
        },
        86400,
      )
    ).token;

    app = new Hono();
    defineCollectionRoutes(app);

    await getDb().delete(collections).where(eq(collections.tenantId, org));
    await getDb().delete(collections).where(eq(collections.tenantId, org2));
  });

  afterAll(() => {
    // Fire and forget (Bun limitation); `.catch` so a late rejection cannot
    // fail an unrelated test file.
    getDb()
      .delete(collections)
      .where(eq(collections.tenantId, org))
      .then(async () => {
        for (const id of createdPages) {
          await getDb().delete(knowledgeText).where(eq(knowledgeText.id, id));
        }
      })
      .catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("full lifecycle: create, columns, records, search, delete", async () => {
    const page = await makePage("Vereinsmitglieder");

    // create the collection with two columns up front
    const created = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
      description: "Alle aktiven Mitglieder",
      fields: [
        { label: "Name", type: "text", required: true },
        { label: "Beitrag", type: "number", options: { suffix: "€" } },
      ],
    });
    expect(created.status).toBe(200);
    const collectionId = created.jsonResponse?.id;
    expect(collectionId).toBeTruthy();
    // the page title is the collection name — never stored twice
    expect(created.jsonResponse?.name).toBe("Vereinsmitglieder");
    expect(created.jsonResponse?.fields).toHaveLength(2);
    expect(created.jsonResponse?.fields[0].key).toBe("name");

    // a page can only carry one collection
    const duplicate = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
    });
    expect(duplicate.status).toBe(400);

    // add a select column
    const field = await testFetcher.post(
      app,
      `${base}/${collectionId}/fields`,
      token,
      {
        label: "Status",
        type: "select",
        options: {
          choices: [{ value: "aktiv" }, { value: "passiv" }],
        },
      },
    );
    expect(field.status).toBe(200);
    expect(field.jsonResponse?.key).toBe("status");

    // a select without choices is rejected — it could never accept a value
    const badField = await testFetcher.post(
      app,
      `${base}/${collectionId}/fields`,
      token,
      { label: "Kaputt", type: "select" },
    );
    expect(badField.status).toBe(400);

    // create records
    const record = await testFetcher.post(
      app,
      `${base}/${collectionId}/records`,
      token,
      { data: { name: "Anna Meier", beitrag: "42.5", status: "aktiv" } },
    );
    expect(record.status).toBe(200);
    const recordId = record.jsonResponse?.id;
    // the string was coerced to a real number by the field type
    expect(record.jsonResponse?.data.beitrag).toBe(42.5);

    // batch insert (the CSV-import path)
    const batch = await testFetcher.post(
      app,
      `${base}/${collectionId}/records`,
      token,
      {
        records: [
          { name: "Bert Klein", status: "passiv" },
          { name: "Cem Yilmaz", status: "aktiv" },
        ],
      },
    );
    expect(batch.status).toBe(200);
    expect(batch.jsonResponse?.records).toHaveLength(2);

    // list
    const list = await testFetcher.get(
      app,
      `${base}/${collectionId}/records`,
      token,
    );
    expect(list.status).toBe(200);
    expect(list.jsonResponse?.total).toBe(3);
    expect(list.jsonResponse?.records).toHaveLength(3);

    // search across all values
    const search = await testFetcher.get(
      app,
      `${base}/${collectionId}/records?search=Yilmaz`,
      token,
    );
    expect(search.status).toBe(200);
    expect(search.jsonResponse?.total).toBe(1);
    expect(search.jsonResponse?.records[0].data.name).toBe("Cem Yilmaz");

    // patch a single column, leaving the others untouched
    const patched = await testFetcher.put(
      app,
      `${base}/${collectionId}/records/${recordId}`,
      token,
      { data: { status: "passiv" } },
    );
    expect(patched.status).toBe(200);
    expect(patched.jsonResponse?.data.status).toBe("passiv");
    expect(patched.jsonResponse?.data.name).toBe("Anna Meier");

    // a value outside the select's options is rejected
    const badValue = await testFetcher.put(
      app,
      `${base}/${collectionId}/records/${recordId}`,
      token,
      { data: { status: "ehemalig" } },
    );
    expect(badValue.status).toBe(400);

    // a required column cannot be left empty
    const missingRequired = await testFetcher.post(
      app,
      `${base}/${collectionId}/records`,
      token,
      { data: { beitrag: 10 } },
    );
    expect(missingRequired.status).toBe(400);

    // delete one record
    const deleted = await testFetcher.delete(
      app,
      `${base}/${collectionId}/records/${recordId}`,
      token,
    );
    expect(deleted.status).toBe(200);

    const afterDelete = await testFetcher.get(
      app,
      `${base}/${collectionId}/records`,
      token,
    );
    expect(afterDelete.jsonResponse?.total).toBe(2);

    // deleting the collection leaves the page itself alone
    const dropped = await testFetcher.delete(
      app,
      `${base}/${collectionId}`,
      token,
    );
    expect(dropped.status).toBe(200);

    const pageRows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, page.id));
    expect(pageRows).toHaveLength(1);
  });

  test("deleting a column removes its values from every record", async () => {
    const page = await makePage("Angebote");
    const created = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
      fields: [
        { label: "Titel", type: "text" },
        { label: "Notiz", type: "text" },
      ],
    });
    const collectionId = created.jsonResponse?.id;
    const noteField = created.jsonResponse?.fields.find(
      (f: any) => f.key === "notiz",
    );

    await testFetcher.post(app, `${base}/${collectionId}/records`, token, {
      data: { titel: "Sommeraktion", notiz: "läuft aus" },
    });

    const dropped = await testFetcher.delete(
      app,
      `${base}/${collectionId}/fields/${noteField.id}`,
      token,
    );
    expect(dropped.status).toBe(200);

    const list = await testFetcher.get(
      app,
      `${base}/${collectionId}/records`,
      token,
    );
    const data = list.jsonResponse?.records[0].data;
    expect(data.titel).toBe("Sommeraktion");
    // the orphaned value is gone, not merely hidden
    expect(Object.prototype.hasOwnProperty.call(data, "notiz")).toBe(false);
  });

  test("materialization mirrors the table into the page body, and only on request", async () => {
    const page = await makePage("Produkte");
    const created = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
      fields: [{ label: "Produkt", type: "text" }],
    });
    const collectionId = created.jsonResponse?.id;

    await testFetcher.post(app, `${base}/${collectionId}/records`, token, {
      data: { produkt: "Wiki-Hosting" },
    });

    // off by default: nothing is written into the page body
    let rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, page.id));
    expect(rows[0]!.text).not.toContain("Wiki-Hosting");

    // switching it on renders the current table
    const enabled = await testFetcher.put(app, `${base}/${collectionId}`, token, {
      settings: { materialize: true },
    });
    expect(enabled.status).toBe(200);

    rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, page.id));
    expect(rows[0]!.text).toContain("Wiki-Hosting");
    expect(rows[0]!.text).toContain("| Produkt |");

    // later writes keep the mirror current
    await testFetcher.post(app, `${base}/${collectionId}/records`, token, {
      data: { produkt: "Support-Vertrag" },
    });
    rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, page.id));
    expect(rows[0]!.text).toContain("Support-Vertrag");

    // switching it off removes the generated block again
    await testFetcher.put(app, `${base}/${collectionId}`, token, {
      settings: { materialize: false },
    });
    rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.id, page.id));
    expect(rows[0]!.text).not.toContain("Wiki-Hosting");
  });

  test("a collection on a personal page is invisible to other members", async () => {
    const page = await makePage("Privates Register", "personal");
    const created = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
      fields: [{ label: "Eintrag", type: "text" }],
    });
    expect(created.status).toBe(200);
    const collectionId = created.jsonResponse?.id;

    // another member of the SAME organisation cannot read it
    const read = await testFetcher.get(
      app,
      `${base}/${collectionId}`,
      sameOrgOtherUserToken,
    );
    expect(read.status).toBe(404);

    // nor its records
    const records = await testFetcher.get(
      app,
      `${base}/${collectionId}/records`,
      sameOrgOtherUserToken,
    );
    expect(records.status).toBe(404);

    // nor write to it
    const write = await testFetcher.post(
      app,
      `${base}/${collectionId}/records`,
      sameOrgOtherUserToken,
      { data: { eintrag: "geht nicht" } },
    );
    expect(write.status).toBe(404);

    // and it does not show up in their listing
    const listed = await testFetcher.get(app, base, sameOrgOtherUserToken);
    expect(listed.status).toBe(200);
    expect(
      (listed.jsonResponse ?? []).some((c: any) => c.id === collectionId),
    ).toBe(false);

    // the owner still sees it
    const ownerList = await testFetcher.get(app, base, token);
    expect(
      (ownerList.jsonResponse ?? []).some((c: any) => c.id === collectionId),
    ).toBe(true);
  });

  test("a user of another organisation is rejected", async () => {
    const page = await makePage("Org-Tabelle");
    const created = await testFetcher.post(app, base, token, {
      knowledgeTextId: page.id,
    });
    const collectionId = created.jsonResponse?.id;

    const read = await testFetcher.get(
      app,
      `${base}/${collectionId}`,
      otherOrgToken,
    );
    expect(read.status).toBe(403);

    const listed = await testFetcher.get(app, base, otherOrgToken);
    expect(listed.status).toBe(403);
  });

  test("unauthenticated access is rejected", async () => {
    const response = await testFetcher.get(app, base, undefined);
    expect(response.status).toBe(401);
  });
});
