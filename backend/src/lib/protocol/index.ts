/**
 * Daily-protocol workup.
 *
 * Takes a raw transcript, has the LLM structure it (summary, key points, action
 * items) and files it as a dated wiki page under an auto-managed personal
 * "Tagesprotokolle" folder. The optional digital-twin brain merge lives in
 * ./digital-twin-brain-agent.
 */
import * as v from "valibot";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import type { KnowledgeTextSelect } from "@framework/lib/db/schema/knowledge";
import { generateStructured } from "../../ai";

export interface ProtocolContext {
  tenantId: string;
  userId: string;
}

const DEV_STUB = process.env.PROTOCOL_DEV_STUB === "true";

/** Auto-managed folder names (personal space). */
export const PROTOCOL_FOLDER_TITLE = "Tagesprotokolle";
export const BRAIN_FOLDER_TITLE = "Wissensbasis";

/**
 * Find or create a top-level personal folder page (parentId null, not
 * tenant-wide, not team). Idempotent — returns the existing page if one with
 * the given title already exists for this user.
 */
export const ensurePersonalFolder = async (
  context: ProtocolContext,
  title: string,
): Promise<KnowledgeTextSelect> => {
  const existing = await getDb()
    .select()
    .from(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, context.tenantId),
        eq(knowledgeText.userId, context.userId),
        eq(knowledgeText.title, title),
        isNull(knowledgeText.parentId),
        eq(knowledgeText.tenantWide, false),
        isNull(knowledgeText.teamId),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0];

  return await createKnowledgeText({
    tenantId: context.tenantId,
    userId: context.userId,
    title,
    text: "",
    contentMode: "text",
    tenantWide: false,
  });
};

// ---- structured workup ------------------------------------------------------

export interface StructuredProtocol {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}

const structuredProtocolSchema = v.object({
  title: v.pipe(
    v.string(),
    v.description("A short, human-friendly title for this protocol (max ~8 words)."),
  ),
  summary: v.pipe(
    v.string(),
    v.description("A concise prose summary of the protocol."),
  ),
  keyPoints: v.pipe(
    v.array(v.string()),
    v.description("The most important points as short bullet strings."),
  ),
  actionItems: v.pipe(
    v.array(v.string()),
    v.description("Concrete to-dos / action items derived from the protocol."),
  ),
});

const STRUCTURE_SYSTEM_PROMPT = `You are an assistant that works up spoken daily protocols.
Given a raw transcript, produce a structured protocol.

RULES:
- Respond in the SAME LANGUAGE as the transcript.
- title: short and descriptive (not a date).
- summary: concise but capturing all key points, no meta-commentary.
- keyPoints: the essential facts/decisions as short bullet strings.
- actionItems: concrete, actionable to-dos. Empty array if there are none.
- Do not invent information that is not in the transcript.`;

/** Ask the LLM to structure a raw transcript. */
export const structureProtocol = async (
  transcript: string,
): Promise<StructuredProtocol> => {
  if (DEV_STUB) {
    return {
      title: "Kundengespräch Beispiel AG",
      summary:
        "Gespräch mit der Beispiel AG: Sie möchten die Bestellung um 20 % " +
        "erhöhen; die neuen Konditionen werden angenommen.",
      keyPoints: [
        "Beispiel AG erhöht Bestellung um 20 %",
        "Neue Konditionen angenommen",
        "Nächstes Treffen im Februar",
      ],
      actionItems: ["Angebot bis Freitag anpassen"],
    };
  }

  return await generateStructured<StructuredProtocol>({
    schema: structuredProtocolSchema,
    system: STRUCTURE_SYSTEM_PROMPT,
    prompt: `Work up the following transcript:\n\n${transcript}`,
  });
};

// ---- page creation ----------------------------------------------------------

/** Two-digit zero-padded. */
const pad = (n: number) => String(n).padStart(2, "0");

/** Dated page title, e.g. "2026-07-13 14:30 · Kundengespräch Beispiel AG". */
export const buildProtocolPageTitle = (
  structured: StructuredProtocol,
  now: Date,
): string => {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `${date} ${time} · ${structured.title}`;
};

/** Assemble the markdown body of a protocol page. */
export const buildProtocolMarkdown = (
  transcript: string,
  structured: StructuredProtocol,
): string => {
  const lines: string[] = [];
  lines.push(`# ${structured.title}`, "");
  lines.push("## Zusammenfassung", "", structured.summary, "");
  if (structured.keyPoints.length) {
    lines.push("## Kernpunkte", "");
    for (const point of structured.keyPoints) lines.push(`- ${point}`);
    lines.push("");
  }
  if (structured.actionItems.length) {
    lines.push("## Aufgaben", "");
    for (const item of structured.actionItems) lines.push(`- [ ] ${item}`);
    lines.push("");
  }
  lines.push("---", "", "## Originaltranskript", "", transcript, "");
  return lines.join("\n");
};

export interface CreatedProtocol {
  entryId: string;
  title: string;
  summary: string;
  actionItems: string[];
}

/**
 * Structure a transcript, then create a dated protocol page under the personal
 * "Tagesprotokolle" folder.
 */
export const createProtocolPage = async (
  context: ProtocolContext,
  transcript: string,
  now: Date,
): Promise<CreatedProtocol> => {
  const structured = await structureProtocol(transcript);
  const folder = await ensurePersonalFolder(context, PROTOCOL_FOLDER_TITLE);
  const pageTitle = buildProtocolPageTitle(structured, now);
  const markdown = buildProtocolMarkdown(transcript, structured);

  const page = await createKnowledgeText({
    tenantId: context.tenantId,
    userId: context.userId,
    parentId: folder.id,
    title: pageTitle,
    text: markdown,
    contentMode: "text",
    tenantWide: false,
  });

  return {
    entryId: page.id,
    title: page.title,
    summary: structured.summary,
    actionItems: structured.actionItems,
  };
};
