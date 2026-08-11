import { describe, it, expect, beforeAll } from "bun:test";
import {
  readKnowledgeTextContent,
  editKnowledgeTextContent,
} from "../../../framework/src/lib/knowledge/knowledge-text-edit";
import { createKnowledgeText } from "../../../framework/src/lib/knowledge/knowledge-texts";
import { syncKnowledgeTextBlocks } from "../../../framework/src/lib/knowledge/knowledge-text-blocks";
import { initTests, TEST_ORGANISATION_1 } from "../../../framework/src/test/init.test";
import {
  agentEditCases,
  losslessCases,
} from "../../../../frontend/src/components/editor/agentEditFixture";

/**
 * Server half of the agent-edit contract (see `agentEditFixture.ts` in the
 * frontend for the whole picture and the editor half).
 *
 * An agent edit can leave a block stored as a MARKDOWN block; the editor half
 * proves what the web editor sends back after a human opens and saves such a
 * page. This half takes exactly that html, stores it the way the save endpoint
 * would, and checks what the page then READS as — the thing agents, search,
 * embedding and export all consume. A loss here would surface only long after
 * the edit looked successful.
 */
const ctx = { tenantId: TEST_ORGANISATION_1.id };

const createBlockPage = async (blocks: { type: "markdown" | "html"; content: string }[]) => {
  const page = await createKnowledgeText({
    title: `Agent Edit Round Trip ${crypto.randomUUID()}`,
    text: "",
    tenantId: TEST_ORGANISATION_1.id,
  });
  await syncKnowledgeTextBlocks(page.id, blocks, ctx);
  return page;
};

describe("Agent edit through the web editor", () => {
  beforeAll(async () => {
    await initTests();
  });

  it("reads unchanged for everything the round trip is lossless for", async () => {
    // guards against the fixture silently losing its lossless cases
    expect(losslessCases.length).toBeGreaterThan(4);

    for (const testCase of losslessCases) {
      const page = await createBlockPage(
        testCase.savedByEditor.map((content) => ({ type: "html" as const, content })),
      );
      const view = await readKnowledgeTextContent(page.id, ctx);

      expect(view.content).toBe(testCase.edited);
    }
  });

  it("reads as the fixture states for every case, lossless or not", async () => {
    for (const testCase of agentEditCases) {
      const page = await createBlockPage(
        testCase.savedByEditor.map((content) => ({ type: "html" as const, content })),
      );
      const view = await readKnowledgeTextContent(page.id, ctx);

      expect(view.content).toBe(testCase.readsAsAfterSave);
    }
  });

  it("stays editable after the editor saved it", async () => {
    // the point of the whole exercise: an agent can edit the page again
    const testCase = agentEditCases.find((c) => c.name === "bold inside a paragraph")!;
    const page = await createBlockPage(
      testCase.savedByEditor.map((content) => ({ type: "html" as const, content })),
    );

    const view = await readKnowledgeTextContent(page.id, ctx);
    const result = await editKnowledgeTextContent(
      page.id,
      { oldString: view.content, newString: "Der **Listenpreis** beträgt 14 EUR pro Monat." },
      ctx,
    );

    expect(result.replacements).toBe(1);
    expect(result.content).toBe("Der **Listenpreis** beträgt 14 EUR pro Monat.");
  });
});
