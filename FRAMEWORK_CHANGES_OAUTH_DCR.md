# Framework change — OAuth2: DCR default scopes + RFC 8707 `resource`

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change is **already applied and committed in the local
> `backend/framework` submodule** on branch `claude/mcp-oauth-auto-mode-fixes`
> (local commit `2b7912f`, based on upstream `e553bcb`) and verified:
> the framework OAuth smoke test (`bun run framework/.scripts/oauth-flow.ts`)
> passes 16/16, and a simulated claude.ai connector flow (DCR **without**
> `scope`, `resource` on authorize + token requests, MCP initialize +
> tools/call) runs green end-to-end against the wiki backend + MCP server.
>
> **Line-precise export:** `framework-oauth-dcr-resource.patch` at the wiki
> repo root is a `git diff e553bcb..2b7912f` of exactly these changes. Apply it
> in a clean framework checkout with `git apply
> framework-oauth-dcr-resource.patch`, review, commit, push.
>
> **⚠️ Submodule pointer reconciliation:** this session cannot push to the
> framework repo (scope is `symbiosika/wiki` only), so the framework commit
> `2b7912f` is **local-only**. The wiki submodule pointer on this branch
> references it. Once the framework change lands upstream, re-point the wiki
> submodule to the upstream SHA:
> ```bash
> cd backend/framework && git fetch origin && git checkout <upstream-sha>
> cd ../.. && git add backend/framework && git commit -m "chore: bump framework to upstream oauth DCR/resource fix"
> ```
> (Or push the local commit `2b7912f` as-is to preserve the SHA.)

## Why (the reported bug)

Connecting the wiki MCP server as a claude.ai custom connector failed after
the user authorized: *"Dein Konto wurde autorisiert, aber CEREDA Wiki hat beim
Verbinden einen Fehler zurückgegeben"* (reference `ofid_…`).

Reproduced locally with a faithful simulation of claude.ai's connector flow:

1. **`invalid_scope` at `/oauth/authorize`.** claude.ai registers via Dynamic
   Client Registration (RFC 7591) **without a `scope` field**. The framework
   stored such clients with an **empty scope allow-list**, so the subsequent
   authorize request for the scopes advertised by the MCP server
   (`knowledge:read knowledge:write …`) was rejected with `invalid_scope` —
   auto mode could never work.
2. **RFC 8707 `resource` ignored.** claude.ai sends
   `resource=<MCP-server-URL>/mcp` on the authorize and token requests and the
   MCP auth spec expects the token audience to be bound to it. The framework
   always set `aud` = issuer, which only worked when the MCP server's
   `OAUTH_ISSUER` env var matched the backend's `BASE_URL` byte-for-byte —
   a silent production foot-gun.
3. **No diagnostics.** Authorize rejections and token-endpoint failures were
   not logged, making exactly this class of failure impossible to debug from
   server logs.

## What the patch does

`src/lib/oauth2/index.ts`
- `POST /oauth/register`: when `scope` is omitted, register the client with
  `oauth2.dcrDefaultScopes` (new config; empty/unset = all supported scopes).
  The response now echoes the actually granted `scope`.
- `POST /oauth/token`: parse + validate the RFC 8707 `resource` parameter
  (absolute URI, no fragment → else `invalid_target`) and pass it through to
  token generation, where it becomes the JWT `aud` (already supported there,
  previously never wired up). Applies to both `authorization_code` and
  `refresh_token` grants.
- `console.error` diagnostics on authorize rejections (with requested vs
  allowed scopes) and token-endpoint failures.

`src/types.ts`, `src/store/index.ts`
- New optional config `oauth2.dcrDefaultScopes: string[]` (default `[]` = all
  supported scopes at runtime).

`docs/framework/16_OAuth2_OIDC_Provider.md`
- Documented DCR (the old "kein Dynamic Client Registration" statement was
  outdated), the default-scope behavior and the `resource`/`aud` binding.

## Wiki-side changes that consume this (already on this wiki branch)

- `backend/src/index.ts`: sets `dcrDefaultScopes` to wiki/identity scopes only
  (`openid profile email knowledge:* knowledge-manage:* user:read`) so
  anonymous DCR clients cannot request payment/secrets/AI-admin scopes.
- `mcp-server`: serves RFC 9728 resource metadata also at
  `/.well-known/oauth-protected-resource/mcp`, advertises the canonical
  resource `MCP_PUBLIC_URL/mcp`, accepts `aud` ∈ {`MCP_PUBLIC_URL/mcp`,
  `MCP_PUBLIC_URL`, issuer} with canonical URL comparison, and logs the
  concrete reason for every rejected token.
- `frontend`: new *Manage → OAuth apps* page (list/create/edit/disable/delete,
  one-time secret display, secret rotation) on top of the existing
  tenant-admin endpoints.
