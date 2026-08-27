# Framework change — per-page-type presentation (`pageTypeStyles`)

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change is **applied and committed in the local `backend/framework`
> submodule** on branch `claude/tolaria-ui-ux-features-x95x1b` (local commit
> `7612625`) and verified — `bun run test:local
> framework/src/lib/knowledge/facets.test.ts` → 19 pass. The wiki app consumes
> it end to end (page type icons in the sidebar tree, above the page title, and
> an admin editor under Manage → Document tags).
>
> **Line-precise export:** `framework-page-type-styles.patch` at the wiki repo
> root is a `git diff` of exactly these changes. Apply it in a clean framework
> checkout with `git apply framework-page-type-styles.patch`, review, commit,
> push.
>
> **⚠️ Submodule pointer reconciliation:** I cannot push to the framework repo
> (session scope is `symbiosika/wiki` only), so commit `7612625` is
> **local-only** and the wiki submodule pointer references it. Once the change
> lands upstream the commit will have a different SHA — then re-point:
>
> ```bash
> cd backend/framework && git fetch origin && git checkout <upstream-sha>
> cd ../.. && git add backend/framework
> git commit -m "chore: bump framework to upstream pageTypeStyles"
> ```
>
> (Or push the local commit as-is to preserve the SHA — then no re-point is
> needed.)

## Why

The wiki needs an icon and a colour per page type, so the sidebar tree and the
page header can show what kind of page something is without reading it. The
`pageType` facet already exists as a controlled per-tenant vocabulary; what was
missing was somewhere to store its *presentation*.

## What changed

`KnowledgeTenantConfig` gains one optional field:

```ts
pageTypeStyles: Record<string, KnowledgePageTypeStyle>

interface KnowledgePageTypeStyle {
  icon?: string   // emoji, or an icon name from the client's allowlist
  color?: KnowledgePageTypeColor
  label?: string  // display label; falls back to the page type key
}
```

- **`KNOWLEDGE_PAGE_TYPE_COLORS`** — closed palette (`slate`, `red`, `orange`,
  `amber`, `green`, `teal`, `blue`, `violet`, `pink`), validated by the config
  route so a typo is rejected on write rather than silently rendering nothing.
- **`icon` stays a bounded free string** (≤ 64 chars). Which icons exist is a
  client concern: the wiki frontend resolves an emoji as-is, a name from its
  bundled allowlist to that icon, and anything else to no icon. Keeping the
  framework out of that decision means the allowlist can grow without a
  framework release, and a config written by a newer client never breaks an
  older one.
- **Pruning on save:** `setKnowledgeTenantConfig` drops style entries whose page
  type is no longer in `pageTypes`. Without it, removing a page type would leave
  its icon behind to reappear if the same name were added again later.

## Why a side map, not a richer `pageTypes`

The obvious alternative was turning `pageTypes: string[]` into
`(string | KnowledgePageTypeDefinition)[]` with a normalizer — closer to how
`KnowledgeAttributeDefinition` works.

Rejected after checking the consumers: `pageTypes` is read by facet validation
(`facets.ts`), the config route, the MCP `get_wiki_config` surface, the wiki
store, the page view and the existing tests. A union type would have touched all
of them and pushed a normalizer requirement onto every external reader of the
config, all to carry data that never affects a write.

A separate map keeps the vocabulary a plain `string[]` everywhere and keeps the
split honest: `pageTypes` is validated data, `pageTypeStyles` is presentation.
The cost is that the two can drift, which the pruning step handles.

## Compatibility

Purely additive. Configs stored before this change have no `pageTypeStyles` key
and pick up the `{}` default through the existing merge-over-defaults read, so
no migration and no data backfill are needed. Clients that ignore the field are
unaffected.

## Tests

Added to `framework/src/lib/knowledge/facets.test.ts`:

- defaults to an empty map
- stores icon, colour and label per page type and survives a store round trip
- is cosmetic — a page whose type has no style still saves
- prunes styles whose page type is removed from the vocabulary
