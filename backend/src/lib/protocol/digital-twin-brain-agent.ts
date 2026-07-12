/**
 * Digital-Twin Brain Agent.
 *
 * An agentic loop that reads a protocol, extracts durable key facts and merges
 * them into a curated hierarchical personal wiki ("Wissensbasis"):
 *   - Level 0: the "Wissensbasis" root (auto-managed).
 *   - Level 1: main categories — USER-managed; the agent may NOT create them.
 *   - Level 2/3: subcategories — the agent creates/updates these (max depth 3).
 * A "90_sonstiges" fallback level-1 category is auto-ensured for miscellaneous
 * facts.
 *
 * The LLM runs on OpenRouter (via ../../ai). Wiki reads/writes reuse the
 * framework helpers; updateKnowledgeText writes history snapshots for free.
 */
import * as v from "valibot";
import { and, eq, isNull } from "drizzle-orm";
import { generateText, tool, Output, stepCountIs } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  createKnowledgeText,
  updateKnowledgeText,
  getKnowledgeTextById,
} from "@framework/lib/knowledge/knowledge-texts";
import { STANDARD_AI_MODEL, assertOpenRouterConfigured } from "../../ai";
import {
  ensurePersonalFolder,
  BRAIN_FOLDER_TITLE,
  type ProtocolContext,
} from "./index";

const DEV_STUB = process.env.PROTOCOL_DEV_STUB === "true";
const FALLBACK_CATEGORY = "90_sonstiges";
const MAX_DEPTH = 3;
const MAX_STEPS = 24;

export interface ProcessProtocolResult {
  success: boolean;
  processedFacts: number;
  updatedCategories: string[];
  newCategories: string[];
  errors: string[];
}

interface BrainRow {
  id: string;
  title: string;
  parentId: string | null;
}

// ---- low-level wiki access (personal scope) ---------------------------------

const childrenOf = async (
  context: ProtocolContext,
  parentId: string,
): Promise<BrainRow[]> => {
  return await getDb()
    .select({
      id: knowledgeText.id,
      title: knowledgeText.title,
      parentId: knowledgeText.parentId,
    })
    .from(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, context.tenantId),
        eq(knowledgeText.userId, context.userId),
        eq(knowledgeText.parentId, parentId),
      ),
    );
};

/** Depth of an entry relative to the root (root = 0). Caps traversal. */
const depthFromRoot = async (
  context: ProtocolContext,
  rootId: string,
  entryId: string,
): Promise<number> => {
  let depth = 0;
  let current: string | null = entryId;
  while (current && current !== rootId && depth <= MAX_DEPTH + 2) {
    const row = await getDb()
      .select({ parentId: knowledgeText.parentId })
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.id, current),
          eq(knowledgeText.tenantId, context.tenantId),
        ),
      )
      .limit(1);
    if (!row[0]) break;
    current = row[0].parentId;
    depth += 1;
  }
  return depth;
};

/** Ensure the "90_sonstiges" fallback level-1 category exists under the root. */
const ensureFallbackCategory = async (
  context: ProtocolContext,
  rootId: string,
): Promise<BrainRow> => {
  const children = await childrenOf(context, rootId);
  const existing = children.find((c) => c.title === FALLBACK_CATEGORY);
  if (existing) return existing;
  const created = await createKnowledgeText({
    tenantId: context.tenantId,
    userId: context.userId,
    parentId: rootId,
    title: FALLBACK_CATEGORY,
    text: "",
    contentMode: "text",
    tenantWide: false,
  });
  return { id: created.id, title: created.title, parentId: created.parentId };
};

// ---- agent tools ------------------------------------------------------------

const buildTools = (
  context: ProtocolContext,
  rootId: string,
  tracking: {
    facts: number;
    updated: Set<string>;
    created: Set<string>;
    errors: string[];
  },
) => {
  const ctx = { tenantId: context.tenantId, userId: context.userId };

  const read_structure = tool({
    description:
      "List the wiki hierarchy under a parent (default: the Wissensbasis root). " +
      "Returns child pages as `- <title> (id: <id>)`. Set deep=true for a " +
      "recursive view (up to 3 levels).",
    inputSchema: valibotSchema(
      v.object({
        parentId: v.optional(v.string()),
        deep: v.optional(v.boolean()),
      }),
    ),
    execute: async ({ parentId, deep }) => {
      const start = parentId || rootId;
      const render = async (id: string, indent: number): Promise<string[]> => {
        const kids = await childrenOf(context, id);
        const lines: string[] = [];
        for (const k of kids) {
          lines.push(`${"  ".repeat(indent)}- ${k.title} (id: ${k.id})`);
          if (deep && indent < MAX_DEPTH - 1) {
            lines.push(...(await render(k.id, indent + 1)));
          }
        }
        return lines;
      };
      const lines = await render(start, 0);
      return lines.length ? lines.join("\n") : "(no entries)";
    },
  });

  const read_text = tool({
    description:
      "Read the full text content of a wiki entry. ALWAYS read before writing " +
      "so you do not lose existing information.",
    inputSchema: valibotSchema(v.object({ entryId: v.string() })),
    execute: async ({ entryId }) => {
      try {
        const entry = await getKnowledgeTextById(entryId, ctx);
        return entry.text ?? "";
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const create_subcategory = tool({
    description:
      "Create a new level-2 or level-3 subcategory under an existing category. " +
      "You CANNOT create level-1 categories (those are user-managed) — never " +
      "pass the Wissensbasis root as parentId.",
    inputSchema: valibotSchema(
      v.object({
        parentId: v.string(),
        title: v.string(),
        initialContent: v.optional(v.string()),
      }),
    ),
    execute: async ({ parentId, title, initialContent }) => {
      try {
        if (parentId === rootId) {
          return "ERROR: cannot create level-1 categories (root is user-managed). Use an existing category or 90_sonstiges.";
        }
        const parentDepth = await depthFromRoot(context, rootId, parentId);
        if (parentDepth >= MAX_DEPTH) {
          return `ERROR: max depth ${MAX_DEPTH} reached; cannot nest deeper.`;
        }
        const siblings = await childrenOf(context, parentId);
        const dupe = siblings.find(
          (s) => s.title.toLowerCase() === title.toLowerCase(),
        );
        if (dupe) return `Already exists (id: ${dupe.id}).`;
        const created = await createKnowledgeText({
          tenantId: context.tenantId,
          userId: context.userId,
          parentId,
          title,
          text: initialContent ?? "",
          contentMode: "text",
          tenantWide: false,
        });
        tracking.created.add(title);
        const warn =
          siblings.length >= 10
            ? " (warning: parent already has many subcategories — prefer reusing)"
            : "";
        return `Created "${title}" (id: ${created.id}).${warn}`;
      } catch (e) {
        tracking.errors.push((e as Error).message);
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const update_text = tool({
    description:
      "Update the content of a wiki entry. appendMode=true adds to the existing " +
      "content (preferred for merging facts), false replaces it. Read the entry " +
      "first.",
    inputSchema: valibotSchema(
      v.object({
        entryId: v.string(),
        newContent: v.string(),
        appendMode: v.optional(v.boolean()),
      }),
    ),
    execute: async ({ entryId, newContent, appendMode }) => {
      try {
        const entry = await getKnowledgeTextById(entryId, ctx);
        const nextText =
          appendMode && entry.text
            ? `${entry.text}\n\n${newContent}`
            : newContent;
        await updateKnowledgeText(entryId, { text: nextText }, ctx);
        tracking.updated.add(entry.title);
        tracking.facts += 1;
        return `Updated "${entry.title}".`;
      } catch (e) {
        tracking.errors.push((e as Error).message);
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  return { read_structure, read_text, create_subcategory, update_text };
};

// ---- agent driver -----------------------------------------------------------

const buildSystemPrompt = (categories: string): string =>
  `You are the Digital-Twin Brain Agent. You process protocols and extract key facts to merge into a structured personal knowledge base ("Wissensbasis").

## KNOWLEDGE STRUCTURE (max 3 levels)
- Level 1: main categories — MANAGED BY USER, you CANNOT create or modify these.
- Level 2/3: subcategories — you CAN create and manage these (aim for <= 10 per parent).

## EXISTING MAIN CATEGORIES (level 1)
${categories}

## TOOLS
- read_structure(parentId?, deep?): explore the hierarchy. Start with deep=true.
- read_text(entryId): ALWAYS read an entry before updating it.
- create_subcategory(parentId, title, initialContent?): create level 2/3 only.
- update_text(entryId, newContent, appendMode?): merge facts (appendMode=true).

## WORKFLOW
1. Read the protocol; identify discrete durable facts (decisions, contacts, dates, action items). Ignore noise.
2. read_structure(deep=true) to understand what exists.
3. For each fact: pick the right main category; find or create a subcategory; read it, then update_text (append) to merge the fact.

## RULES
- NEVER create level-1 categories. If nothing fits, use "${FALLBACK_CATEGORY}".
- Always read before writing; do not overwrite existing info — append.
- Store discrete facts (bullet points, include dates/people), not prose.
- Use lowercase_with_underscores for new subcategory titles.
- Respond in the language of the protocol.

When done, return the JSON summary of what you changed.`;

/**
 * Process a protocol: extract key facts and merge them into the personal
 * "Wissensbasis" hierarchy. Resilient — returns a result object even on partial
 * failure (errors are collected, never thrown to the caller).
 */
export const processProtocol = async (
  context: ProtocolContext,
  protocol: string,
): Promise<ProcessProtocolResult> => {
  if (DEV_STUB) {
    // Deterministically file one fact under the fallback category so the flow
    // can be verified without a real LLM.
    const root = await ensurePersonalFolder(context, BRAIN_FOLDER_TITLE);
    const fallback = await ensureFallbackCategory(context, root.id);
    await updateKnowledgeText(
      fallback.id,
      {
        text: `- ${new Date().toISOString().slice(0, 10)}: ${protocol.slice(0, 120)}`,
      },
      { tenantId: context.tenantId, userId: context.userId },
    );
    return {
      success: true,
      processedFacts: 1,
      updatedCategories: [FALLBACK_CATEGORY],
      newCategories: [],
      errors: [],
    };
  }

  assertOpenRouterConfigured();

  const root = await ensurePersonalFolder(context, BRAIN_FOLDER_TITLE);
  await ensureFallbackCategory(context, root.id);

  const level1 = await childrenOf(context, root.id);
  const categoriesList = level1.length
    ? level1.map((c) => `- ${c.title} (id: ${c.id})`).join("\n")
    : `- ${FALLBACK_CATEGORY} (fallback)`;

  const tracking = {
    facts: 0,
    updated: new Set<string>(),
    created: new Set<string>(),
    errors: [] as string[],
  };
  const tools = buildTools(context, root.id, tracking);

  const resultSchema = v.object({
    processedFacts: v.number(),
    updatedCategories: v.array(v.string()),
    newCategories: v.array(v.string()),
    errors: v.array(v.string()),
  });

  try {
    await generateText({
      model: STANDARD_AI_MODEL,
      system: buildSystemPrompt(categoriesList),
      prompt: `## PROTOCOL\n\n${protocol}\n\nExtract the key facts and merge them into the Wissensbasis. Use the tools; read before writing; return the JSON summary when done.`,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      experimental_output: Output.object({
        schema: valibotSchema(resultSchema),
      }),
    });
  } catch (e) {
    tracking.errors.push((e as Error).message);
  }

  // Trust our own tracking (side effects) over the model's self-report.
  return {
    success: tracking.errors.length === 0,
    processedFacts: tracking.facts,
    updatedCategories: [...tracking.updated],
    newCategories: [...tracking.created],
    errors: tracking.errors,
  };
};
