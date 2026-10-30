/**
 * An organisation owner always keeps write access to the organisation's
 * knowledge.
 *
 * The read/write level lives on `tenantMembers.knowledgeAccess`, and the
 * framework's write check (`checkTenantKnowledgeWriteAccess`) looks at nothing
 * else — the role plays no part. The members endpoint
 * (`PUT /tenant/:tenantId/members/:memberId`) lets an owner or admin set ANY
 * member to "read", the owner included, and an owner set to "read" was then
 * locked out of every organisation-wide page with no way back from the UI.
 *
 * This wrapper closes that hole for the endpoint: after the framework has
 * handled a member update successfully (authentication and the admin/owner
 * check stay entirely with the framework — a refused request passes through
 * untouched), a target member who is an owner is put back on "write", and the
 * response carries the stored row. That also covers a promotion of a
 * read-only member to owner. Existing owners stored as "read" got their write
 * access back with drizzle-sql/0012_owner_knowledge_write.sql.
 *
 * It sits around the whole server `fetch` (see ../../index.ts) like the other
 * wrappers next to it: the framework registers the members route before any
 * app route, so an app route or app middleware never sees the request. It
 * works at this level rather than in the database because the framework's own
 * library contract (and its tests) allow an owner row to be set to "read".
 */
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { tenantMembers } from "@framework/lib/db/db-schema";

/** The shape of `server.fetch`: Bun may answer `undefined` (e.g. an upgrade). */
type FetchLike = (
  request: Request,
  ...rest: unknown[]
) => Response | undefined | Promise<Response | undefined>;

const MEMBER_PATH = new RegExp(
  "^/api/v1/tenant/([0-9a-f-]{36})/members/([0-9a-f-]{36})/?$",
  "i",
);

/** Tenant and member id of a member-update request, or null for any other. */
export const memberUpdateTarget = (
  request: Request,
): { tenantId: string; memberId: string } | null => {
  if (request.method !== "PUT") return null;
  const match = MEMBER_PATH.exec(new URL(request.url).pathname);
  return match ? { tenantId: match[1]!, memberId: match[2]! } : null;
};

/**
 * Put an owner back on "write". Returns the stored row when it had to be
 * changed, null when the member is no owner or already had write access.
 */
export const ensureOwnerKnowledgeWriteAccess = async (
  tenantId: string,
  userId: string,
) => {
  const [row] = await getDb()
    .update(tenantMembers)
    .set({ knowledgeAccess: "write" })
    .where(
      and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.role, "owner"),
        ne(tenantMembers.knowledgeAccess, "write"),
      ),
    )
    .returning();
  return row ?? null;
};

export function withOwnerKnowledgeWriteAccess(inner: FetchLike): FetchLike {
  return async (request, ...rest) => {
    const target = memberUpdateTarget(request);
    const response = await inner(request, ...rest);
    if (!target || !response || !response.ok) return response;

    const corrected = await ensureOwnerKnowledgeWriteAccess(
      target.tenantId,
      target.memberId,
    );
    if (!corrected) return response;

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(corrected), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
