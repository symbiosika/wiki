/**
 * Protocol routes — "Tagesprotokoll einsprechen".
 *
 * Steps the frontend chains:
 *   0. GET  /protocol/realtime    — WebSocket: live PCM stream → text deltas
 *                                   (Mistral realtime/Voxtral). Live typing UX.
 *   1. POST /protocol/transcribe  — audio (multipart) → text (Mistral/Voxtral)
 *                                   (fallback for browsers without live capture)
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
import {
  startRealtimeTranscription,
  type RealtimeSession,
} from "../../../../lib/audio/transcription/realtime";
import { upgradeWebSocket } from "../../../../lib/ws/bun-ws";
import { createProtocolPage } from "../../../../lib/protocol";
import { processProtocol } from "../../../../lib/protocol/digital-twin-brain-agent";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });

export default function defineProtocolRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/protocol`;

  // 0. Live transcription over WebSocket -------------------------------------
  // The browser captures 16 kHz mono PCM (pcm_s16le) and streams it as binary
  // frames; the relay pipes them to Mistral's realtime endpoint and sends back
  // JSON events: {type:"delta",text}, {type:"done",text}, {type:"error",message}.
  // A JSON {type:"stop"} frame from the browser ends the audio stream.
  // Auth: the global auth middleware validates the session cookie on the
  // upgrade request (same-origin WS); `isTenantMember` scopes it to the tenant.
  app.get(
    `${base}/realtime`,
    authAndSetUsersInfo,
    checkUserPermission,
    validator("param", tenantParam),
    isTenantMember,
    upgradeWebSocket((c) => {
      const rawRate = c.req.query("sampleRate");
      const parsedRate = rawRate ? Number.parseInt(rawRate, 10) : NaN;
      const sampleRate = Number.isFinite(parsedRate) ? parsedRate : undefined;

      let session: RealtimeSession | null = null;
      let closed = false;

      const sendJson = (
        ws: { send: (data: string) => void; close: (code?: number, reason?: string) => void },
        payload: Record<string, unknown>,
      ) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // socket already gone — nothing to do
        }
      };

      return {
        onOpen: (_event, ws) => {
          session = startRealtimeTranscription(
            {
              onDelta: (text) => sendJson(ws, { type: "delta", text }),
              onDone: (text) => {
                sendJson(ws, { type: "done", text });
                try {
                  ws.close(1000, "done");
                } catch {
                  /* noop */
                }
              },
              onError: (message) => {
                sendJson(ws, { type: "error", message });
                try {
                  ws.close(1011, "error");
                } catch {
                  /* noop */
                }
              },
            },
            { sampleRate },
          );
        },
        onMessage: (event, _ws) => {
          const data = event.data;
          if (typeof data === "string") {
            try {
              const msg = JSON.parse(data) as { type?: string };
              if (msg.type === "stop") session?.finishAudio();
            } catch {
              /* ignore malformed control frames */
            }
            return;
          }
          if (data instanceof ArrayBuffer) {
            session?.pushAudio(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            session?.pushAudio(
              new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            );
          }
        },
        onClose: () => {
          if (closed) return;
          closed = true;
          session?.close();
        },
        onError: () => {
          if (closed) return;
          closed = true;
          session?.close();
        },
      };
    }),
  );

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
