/**
 * Post-processing agent routes.
 *
 *   GET    /post-processing-agents            list agents (all tenant members)
 *   POST   /post-processing-agents            create agent
 *   GET    /post-processing-agents/:id        get one
 *   PUT    /post-processing-agents/:id        update
 *   DELETE /post-processing-agents/:id        delete
 *   POST   /post-processing-agents/:id/test-run  run against sample text (no persist)
 *
 * All routes are authenticated and tenant-scoped (isTenantMember). Every agent
 * operation is additionally scoped by tenantId in the lib layer, so a
 * member of tenant A can never read, mutate, or run tenant B's agents. Read
 * endpoints are open to all tenant members so the import dialog can list agents.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
} from "../../../../lib/post-processing-agents/store";
import { runPostProcessingAgent } from "../../../../lib/post-processing-agents/runner";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const agentParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  id: v.pipe(v.string(), v.uuid()),
});

const nullableString = v.nullable(v.string());
const maxStepsSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(100),
);

const createBody = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  description: v.optional(nullableString),
  prompt: v.pipe(v.string(), v.minLength(1)),
  modelId: v.optional(nullableString),
  maxSteps: v.optional(v.nullable(maxStepsSchema)),
  enabled: v.optional(v.boolean()),
});

const updateBody = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1))),
  description: v.optional(nullableString),
  prompt: v.optional(v.pipe(v.string(), v.minLength(1))),
  modelId: v.optional(nullableString),
  maxSteps: v.optional(v.nullable(maxStepsSchema)),
  enabled: v.optional(v.boolean()),
});

/** ~100 kB cap on test-run input so a stray paste can't tie up the server. */
const MAX_TEST_RUN_CHARS = 100_000;

const testRunBody = v.object({
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEST_RUN_CHARS)),
  title: v.optional(v.string()),
});

const ok = { 200: { description: "Successful response" } };

export default function definePostProcessingAgentRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/post-processing-agents`;

  // list --------------------------------------------------------------------
  app.get(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "List post-processing agents",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const agents = await listAgents({ tenantId: tenantId });
      return c.json(agents);
    },
  );

  // create ------------------------------------------------------------------
  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "Create a post-processing agent",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("json", createBody),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const agent = await createAgent(
          { tenantId: tenantId, userId: c.get("usersId") },
          body,
        );
        // Immediately selectable via usePostProcessors: ["agent:<id>"] — the
        // resolver builds the processor on demand, so no registration needed.
        return c.json(agent);
      } catch (e) {
        throw new HTTPException(400, { message: e + "" });
      }
    },
  );

  // get one -----------------------------------------------------------------
  app.get(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "Get a post-processing agent",
      responses: ok,
    }),
    validator("param", agentParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const agent = await getAgentById({ tenantId: tenantId }, id);
      if (!agent) throw new HTTPException(404, { message: "Agent not found" });
      return c.json(agent);
    },
  );

  // update ------------------------------------------------------------------
  app.put(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "Update a post-processing agent",
      responses: ok,
    }),
    validator("param", agentParam),
    validator("json", updateBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        const agent = await updateAgent({ tenantId: tenantId }, id, body);
        if (!agent) throw new HTTPException(404, { message: "Agent not found" });
        return c.json(agent);
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        throw new HTTPException(400, { message: e + "" });
      }
    },
  );

  // delete ------------------------------------------------------------------
  app.delete(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "Delete a post-processing agent",
      responses: ok,
    }),
    validator("param", agentParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const deleted = await deleteAgent({ tenantId: tenantId }, id);
      if (!deleted) throw new HTTPException(404, { message: "Agent not found" });
      return c.json({ success: true });
    },
  );

  // test-run (no persistence) ----------------------------------------------
  app.post(
    `${base}/:id/test-run`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["post-processing-agents"],
      summary: "Run an agent against sample text without persisting anything",
      responses: ok,
    }),
    validator("param", agentParam),
    validator("json", testRunBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const { text, title } = c.req.valid("json");
      const agent = await getAgentById({ tenantId: tenantId }, id);
      if (!agent) throw new HTTPException(404, { message: "Agent not found" });
      try {
        const result = await runPostProcessingAgent({
          text,
          title,
          instructions: agent.prompt,
          modelId: agent.modelId ?? undefined,
          maxSteps: agent.maxSteps ?? undefined,
        });
        return c.json({
          text: result.text,
          title: result.title,
          meta: result.meta,
          summary: result.summary,
          editCount: result.editCount,
          aborted: result.aborted,
        });
      } catch (e) {
        throw new HTTPException(500, { message: e + "" });
      }
    },
  );
}
