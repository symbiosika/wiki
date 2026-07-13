/**
 * Document Assistant Agent.
 *
 * Lets a user interact with a single wiki page by voice or text: they describe a
 * change in natural language ("add that Anna is the new contact", "shorten the
 * intro", "add a task to call the supplier") and an agent works it INTO the
 * document — adapting to the page's existing structure and style, editing
 * surgically rather than pasting the raw input.
 *
 * The LLM runs on OpenRouter (via ../../ai). Reads/writes go through the
 * framework's content layer, which edits inside blocks and records a version
 * snapshot for free — so the block editor and the page history stay in sync.
 *
 * Tools:
 *   - view_document      read the page with line numbers
 *   - replace_in_document exact string replacement (modify existing content)
 *   - append_to_document append a new markdown block (add new content)
 */
import * as v from "valibot";
import { generateText, tool, Output, stepCountIs } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import {
  readKnowledgeTextContent,
  editKnowledgeTextContent,
} from "@framework/lib/knowledge/knowledge-text-edit";
import {
  getKnowledgeTextBlocks,
  syncKnowledgeTextBlocks,
} from "@framework/lib/knowledge/knowledge-text-blocks";
import { STANDARD_AI_MODEL, assertOpenRouterConfigured } from "../../ai";

const DEV_STUB = process.env.PROTOCOL_DEV_STUB === "true";
const MAX_STEPS = 12;

export interface DocumentAssistantContext {
  tenantId: string;
  userId: string;
}

export interface DocumentAssistantResult {
  success: boolean;
  /** Short natural-language summary of what changed (document's language). */
  summary: string;
  /** How many edit/append operations were applied. */
  appliedEdits: number;
}

/** Format a document's content with 1-based, right-padded line numbers. */
export const formatWithLineNumbers = (
  content: string,
  fromLine = 1,
): string => {
  const lines = content.split("\n");
  return lines
    .map((line, idx) => `${(fromLine + idx).toString().padStart(4, " ")}| ${line}`)
    .join("\n");
};

/** Append a new markdown block to the end of a page (keeps blocks in sync). */
const appendMarkdownBlock = async (
  entryId: string,
  ctx: DocumentAssistantContext,
  markdown: string,
): Promise<void> => {
  const blocks = await getKnowledgeTextBlocks(entryId, ctx);
  const next = blocks.map((b) => ({
    id: b.id,
    type: b.type,
    content: b.content,
    meta: (b.meta ?? {}) as Record<string, unknown>,
  }));
  next.push({ id: undefined as unknown as string, type: "markdown", content: markdown, meta: {} });
  await syncKnowledgeTextBlocks(entryId, next, ctx);
};

const buildSystemPrompt = (): string =>
  `You are a precise document-editing assistant embedded in a wiki page. The user
talks or types a request in natural language; you work it INTO the current
document.

MINDSET
- Treat the user's input as INTENT (WHAT they want changed), not literal text to
  paste. Adapt the change to the document's existing format, structure and style.
- Be surgical: change only what is necessary; preserve headings, lists, tables,
  spacing and tone.
- Write in the same language as the document / the user's request.

WORKFLOW
1. Call view_document to read the current content with line numbers.
2. Decide: does this MODIFY existing content or ADD new content?
   - Modify → replace_in_document with a unique oldString (include enough
     surrounding context that it matches exactly once) and the adapted newString.
   - Add new information that doesn't replace anything → append_to_document with a
     well-formatted markdown snippet (a heading, a bullet, a task "- [ ] …", etc.
     matching the document's conventions).
3. You may call the tools several times. Read before you write.
4. When done, return a short summary (one or two sentences) of what you changed.

If replace_in_document reports the string was not found or not unique, view the
document again and retry with a longer, unique oldString.`;

/**
 * Run one turn of the document assistant: apply the user's instruction to the
 * page and return a summary of what changed.
 */
export const runDocumentAssistant = async (
  ctx: DocumentAssistantContext,
  entryId: string,
  instruction: string,
): Promise<DocumentAssistantResult> => {
  // Dev stub: no LLM. Append the instruction as a bullet so the whole
  // apply → reload → editor-refresh flow can be exercised without keys.
  if (DEV_STUB) {
    await appendMarkdownBlock(entryId, ctx, `- ${instruction.trim()}`);
    return {
      success: true,
      summary: `Ergänzt: „${instruction.trim()}" (Demo-Modus).`,
      appliedEdits: 1,
    };
  }

  assertOpenRouterConfigured();

  let appliedEdits = 0;

  const view_document = tool({
    description:
      "Read the current page content with line numbers. Optionally pass " +
      "fromLine/maxLines to read a slice. Always read before editing.",
    inputSchema: valibotSchema(
      v.object({
        fromLine: v.optional(v.number()),
        maxLines: v.optional(v.number()),
      }),
    ),
    execute: async ({ fromLine, maxLines }) => {
      try {
        const view = await readKnowledgeTextContent(entryId, ctx, {
          fromLine,
          maxLines,
        });
        const body = formatWithLineNumbers(view.content, view.fromLine);
        return `title: ${view.title}\ntotalLines: ${view.totalLines}\n\n${body}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const replace_in_document = tool({
    description:
      "Modify existing content via exact string replacement. oldString must " +
      "occur exactly once (include surrounding context) unless replaceAll is " +
      "true. Use this to update/rephrase/delete existing text.",
    inputSchema: valibotSchema(
      v.object({
        oldString: v.pipe(v.string(), v.minLength(1)),
        newString: v.string(),
        replaceAll: v.optional(v.boolean()),
      }),
    ),
    execute: async ({ oldString, newString, replaceAll }) => {
      try {
        const r = await editKnowledgeTextContent(
          entryId,
          { oldString, newString, replaceAll },
          ctx,
        );
        appliedEdits += 1;
        return `OK: replaced ${r.replacements} occurrence(s).`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const append_to_document = tool({
    description:
      "Append NEW content as a markdown block at the end of the document. Use " +
      "this for information that does not replace anything. Provide well-" +
      "formatted markdown that matches the document's conventions.",
    inputSchema: valibotSchema(
      v.object({ markdown: v.pipe(v.string(), v.minLength(1)) }),
    ),
    execute: async ({ markdown }) => {
      try {
        await appendMarkdownBlock(entryId, ctx, markdown);
        appliedEdits += 1;
        return "OK: appended a new block.";
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  let summary = "";
  try {
    const result = await generateText({
      model: STANDARD_AI_MODEL,
      system: buildSystemPrompt(),
      prompt: `USER REQUEST (interpret as intent, work it into the document):\n\n${instruction}`,
      tools: { view_document, replace_in_document, append_to_document },
      stopWhen: stepCountIs(MAX_STEPS),
      experimental_output: Output.object({
        schema: valibotSchema(v.object({ summary: v.string() })),
      }),
    });
    summary = result.experimental_output?.summary ?? "";
  } catch (e) {
    // The generation failed. Report whatever edits already landed (if any) and
    // surface the reason as the summary so the UI can show it.
    return {
      success: false,
      summary: `Fehler: ${(e as Error).message}`,
      appliedEdits,
    };
  }

  return {
    success: appliedEdits > 0,
    summary:
      summary ||
      (appliedEdits > 0
        ? "Änderungen ins Dokument eingearbeitet."
        : "Keine Änderung vorgenommen."),
    appliedEdits,
  };
};
