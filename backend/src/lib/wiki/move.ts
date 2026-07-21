/**
 * Wiki tree drag & drop business logic.
 *
 * Moving a page in the sidebar tree is two things at once:
 *   - re-parenting: the page gets a new `parentId` (or `null` for a root),
 *   - re-ordering:  its position among its (new) siblings changes.
 *
 * Ordering uses the fractional-index `position` key (see
 * `@framework/lib/utils/fractional-index`). Legacy pages created before manual
 * ordering existed have `position = null` and therefore fall back to a title
 * sort. Because a mix of null and non-null keys sorts inconsistently (Postgres
 * puts NULLs last on an ascending sort), we cannot simply hand the moved page a
 * fresh key and leave its siblings untouched. Instead the client sends the full
 * desired order of the destination sibling list and we run `assignPositions`
 * over it: existing valid keys are reused (zero writes) and only the pages whose
 * key actually changes are updated — which, once a group has been touched once,
 * is just the moved page.
 *
 * This deliberately bypasses the framework's `updateKnowledgeText`: a move is a
 * purely structural change, so it must not create a history version, snapshot
 * the page's blocks, or mark the summary stale. It also leaves `updatedAt`
 * untouched so a reorder never masquerades as a content edit in the
 * recent-changes list.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { checkKnowledgeTextWritePermission } from "@framework/lib/knowledge/knowledge-texts";
import { assignPositions } from "@framework/lib/utils/fractional-index";

/** The access "section" a page belongs to (personal / a team / organisation). */
type ScopeRow = {
  teamId: string | null;
  tenantWide: boolean;
  userId: string | null;
};

/** True when both pages live in the same sidebar section. */
const sameScope = (a: ScopeRow, b: ScopeRow): boolean => {
  if ((a.teamId ?? null) !== (b.teamId ?? null)) return false;
  if (a.tenantWide !== b.tenantWide) return false;
  // personal pages (no team, not tenant-wide) additionally must share an owner
  if (!a.teamId && !a.tenantWide) {
    return (a.userId ?? null) === (b.userId ?? null);
  }
  return true;
};

/**
 * Reject moving a page underneath itself or one of its own descendants, which
 * would detach a whole subtree into a cycle. Walks up from the candidate parent
 * to the root following `parentId`.
 */
const assertNotDescendant = async (
  pageId: string,
  candidateParentId: string,
  tenantId: string
): Promise<void> => {
  const db = getDb();
  const seen = new Set<string>();
  let current: string | null = candidateParentId;
  while (current) {
    if (current === pageId) {
      throw new Error("Cannot move a page into its own descendant");
    }
    if (seen.has(current)) break; // pre-existing cycle guard
    seen.add(current);
    const [row]: { parentId: string | null }[] = await db
      .select({ parentId: knowledgeText.parentId })
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.id, current),
          eq(knowledgeText.tenantId, tenantId)
        )
      )
      .limit(1);
    current = row?.parentId ?? null;
  }
};

export interface MovePageInput {
  /** The new parent page id, or null to move the page to a section root. */
  parentId: string | null;
  /**
   * The ids of the destination parent's children in their desired order,
   * including the moved page. Order is authoritative; positions are (re)derived
   * from it server-side.
   */
  orderedIds: string[];
}

/**
 * Move a wiki page to a new parent and/or position within its section.
 *
 * @returns the number of rows whose position/parent was actually written.
 */
export const movePage = async (
  pageId: string,
  input: MovePageInput,
  context: { tenantId: string; userId: string }
): Promise<number> => {
  const db = getDb();
  const { tenantId } = context;

  // the page being moved (tenant-scoped)
  const [page] = await db
    .select()
    .from(knowledgeText)
    .where(and(eq(knowledgeText.id, pageId), eq(knowledgeText.tenantId, tenantId)))
    .limit(1);
  if (!page) throw new Error("Page not found");

  await checkKnowledgeTextWritePermission(page, context);

  const newParentId = input.parentId ?? null;

  if (newParentId) {
    if (newParentId === pageId) {
      throw new Error("A page cannot be its own parent");
    }
    const [parent] = await db
      .select()
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.id, newParentId),
          eq(knowledgeText.tenantId, tenantId)
        )
      )
      .limit(1);
    if (!parent) throw new Error("Target parent not found");

    await checkKnowledgeTextWritePermission(parent, context);
    if (!sameScope(parent, page)) {
      throw new Error("Cannot move a page into a different section");
    }
    await assertNotDescendant(pageId, newParentId, tenantId);
  }

  // Derive positions from the desired sibling order. Unknown ids (stale client
  // tree) are ignored; the moved page is always included so it gets a key even
  // if the client omitted it.
  const orderedIds = input.orderedIds.includes(pageId)
    ? input.orderedIds
    : [...input.orderedIds, pageId];

  const siblingRows =
    orderedIds.length > 0
      ? await db
          .select({ id: knowledgeText.id, position: knowledgeText.position })
          .from(knowledgeText)
          .where(
            and(
              inArray(knowledgeText.id, orderedIds),
              eq(knowledgeText.tenantId, tenantId)
            )
          )
      : [];

  const currentPosition = new Map(
    siblingRows.map((r) => [r.id, r.position ?? null])
  );
  // keep only ids that actually exist, preserving the requested order
  const ids = orderedIds.filter((id) => currentPosition.has(id));

  const positions = assignPositions(
    ids.map((id) => ({ position: currentPosition.get(id) ?? null }))
  );

  let writes = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const nextPosition = positions[i]!;
    const positionChanged = (currentPosition.get(id) ?? null) !== nextPosition;
    const parentChanged = id === pageId && (page.parentId ?? null) !== newParentId;
    if (!positionChanged && !parentChanged) continue;

    await db
      .update(knowledgeText)
      .set(
        id === pageId
          ? { position: nextPosition, parentId: newParentId }
          : { position: nextPosition }
      )
      .where(and(eq(knowledgeText.id, id), eq(knowledgeText.tenantId, tenantId)));
    writes++;
  }

  return writes;
};
