/**
 * Protocol routes — "Tagesprotokoll einsprechen".
 *
 * Three steps the frontend chains:
 *   1. POST /protocol/transcribe  — audio (multipart) → text (Mistral/Voxtral)
 *   2. POST /protocol             — transcript → dated wiki page (LLM workup)
 *   3. POST /protocol/process     — transcript → digital-twin brain merge
 *
 * Steps 2 and 3 are separate so a brain-merge failure never loses the saved
 * protocol page.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { transcribeAudio } from "../../../../lib/audio/transcription";
import { createProtocolPage } from "../../../../lib/protocol";
import { processProtocol } from "../../../../lib/protocol/digital-twin-brain-agent";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });

export default function defineProtocolRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/protocol`;

  // 1. Transcribe audio -------------------------------------------------------
  app.post(
    `${base}/transcribe`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["protocol"],
      summary: "Transcribe recorded audio to text",
      responses: {
        200: {
          description: "Transcription",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      try {
        const body = await c.req.parseBody();
        const audio = body["audio"];
        if (!(audio instanceof File)) {
          return c.json({ success: false, error: "No audio file provided" }, 400);
        }
        const buffer = Buffer.from(await audio.arrayBuffer());
        const { text } = await transcribeAudio(buffer, audio.name || "recording.webm");
        return c.json({ success: true, text });
      } catch (error) {
        console.error("Failed to transcribe audio", error);
        return c.json({ success: false, error: "Failed to transcribe audio" }, 500);
      }
    },
  );

  // 2. Create protocol page (LLM workup) -------------------------------------
  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["protocol"],
      summary: "Structure a transcript and file it as a dated wiki page",
      responses: {
        200: {
          description: "Created protocol",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    validator("param", tenantParam),
    validator(
      "json",
      v.object({ transcript: v.pipe(v.string(), v.minLength(1)) }),
    ),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { transcript } = c.req.valid("json");
      const userId = c.get("usersId");
      try {
        const result = await createProtocolPage(
          { tenantId, userId },
          transcript,
          new Date(),
        );
        return c.json({ success: true, ...result });
      } catch (error) {
        console.error("Failed to create protocol", error);
        return c.json({ success: false, error: "Failed to create protocol" }, 500);
      }
    },
  );

  // 3. Merge into the digital-twin brain -------------------------------------
  app.post(
    `${base}/process`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["protocol"],
      summary: "Extract facts from a protocol into the Wissensbasis (brain)",
      responses: {
        200: {
          description: "Processing result",
          content: { "application/json": { schema: resolver(v.any()) } },
        },
      },
    }),
    validator("param", tenantParam),
    validator("json", v.object({ protocol: v.pipe(v.string(), v.minLength(1)) })),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const { protocol } = c.req.valid("json");
      const userId = c.get("usersId");
      try {
        const result = await processProtocol({ tenantId, userId }, protocol);
        return c.json(result);
      } catch (error) {
        console.error("Failed to process protocol", error);
        return c.json({ success: false, error: "Failed to process protocol" }, 500);
      }
    },
  );
}
