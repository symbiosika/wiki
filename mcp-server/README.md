# Symbiosika Wiki — MCP server

An **MCP server** (Model Context Protocol) that lets a chat app use the wiki as
its **"brain"**: discover what knowledge exists, read pages (and whole
subtrees), search, and author/maintain content — all with the signed-in user's
own permissions.

The server is an **OAuth2 resource server** following the
[MCP authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization).
It issues **no** tokens and knows **no** passwords — login, consent and token
issuance are handled by the wiki app (the `symbiosika-framework` backend) as the
authorization server. This server validates incoming bearer tokens at the AS
(introspection) and enforces that the token was issued **for it** (audience
check). Calls to the app API then run **in the name of the user** — with exactly
that user's permissions.

Hosts that **cannot** run the interactive OAuth2 flow (ElevenLabs, n8n, Zapier,
…) authenticate instead with a long-lived **API token** sent as a static header
— see [Connecting a non-interactive client](#connecting-a-non-interactive-client-elevenlabs-n8n-).

Everything sits on top of the framework's agent-friendly `knowledge/texts` API
(pages with a `parentId` hierarchy, block content, hybrid search, wikilinks,
version history and file-like read/edit endpoints).

---

## Available tools

All tools call the existing wiki API; **authorization is enforced by the app**
(personal / team / organisation visibility, write permission). Missing
permission comes back as a `403` error text.

### Identity & context

| Tool                 | Purpose                                                          |
| -------------------- | --------------------------------------------------------------- |
| `whoami`             | Signed-in user's profile + the active organisation id           |
| `list_organisations` | Organisations (tenants) the user belongs to                     |

### Discovery

| Tool                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `get_wiki_overview`   | Session-start briefing: metrics, top-level areas (with summaries/facets), recent changes, agent-instructions page |
| `get_wiki_tree`       | Full page tree: `personal` / one section per `team` / `organisation` |
| `search_wiki`         | Hybrid search (default) with facet/subtree filters; trust-aware ranking |
| `resolve_page`        | Exact title → page reference (wikilink semantics, no search round trip) |
| `list_recent_changes` | Activity feed, filterable by `since` / subtree / facets / team       |
| `list_pages`          | Flat, paginated index of pages                                       |
| `get_wiki_config`     | Controlled facet vocabularies (`pageType`, `status`)                 |

### Reading

| Tool                  | Purpose                                                          |
| --------------------- | --------------------------------------------------------------- |
| `get_page`            | A single page as clean `{ id, title, content }`                 |
| `get_page_metadata`   | Metadata WITHOUT the body (scope, facets, authorship, size)     |
| `get_pages`           | Batch read: several pages in one call                           |
| `get_page_outline`    | Heading outline of a page (structure, no body)                  |
| `read_page_section`   | One section by heading anchor                                   |
| `read_page_content`   | File-like read, optional `fromLine` / `maxLines`                |
| `get_page_subtree`    | A page + descendants, bounded by `maxDepth` / `maxChars`        |
| `get_page_links`      | Outgoing `[[wikilinks]]` (resolved / unresolved)                |
| `get_page_backlinks`  | Pages linking to this page                                      |
| `get_related_pages`   | Semantically related pages (needs embeddings)                   |
| `get_page_history`    | Compact version list (no old contents)                          |
| `get_page_version`    | One archived version in full                                    |

### Writing

| Tool                 | Purpose                                                          |
| -------------------- | --------------------------------------------------------------- |
| `create_page`        | New page (personal / in a team / organisation-wide; markdown)   |
| `update_page`        | Rename, move, or curate facets (`pageType`, `status`, `validUntil`, `supersedesId`, manual `summary`) |
| `append_to_page`     | Append markdown to the end (no read-modify-write, no conflicts) |
| `edit_page_content`  | Surgical find-and-replace edit of the body                      |
| `delete_page`        | Delete a page                                                   |

### Tool annotations (behaviour hints)

Every tool ships MCP [tool annotations](https://modelcontextprotocol.io/specification/server/tools#tool)
so clients (Claude & co.) can tell reading apart from writing before they call
anything — no confirmation prompt for a search, an explicit one for a delete:

| Tool group                                                     | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| -------------------------------------------------------------- | -------------- | ----------------- | ---------------- |
| identity, discovery, reading, `view_*` / `get_page_image`       | `true`         | –                 | –                |
| `create_page`, `append_to_page`                                 | `false`        | `false` (additive) | `false` (repeats duplicate) |
| `update_page`                                                   | `false`        | `true` (overwrites metadata) | `true`  |
| `edit_page_content`                                             | `false`        | `true` (overwrites body) | `false`     |
| `delete_page`                                                   | `false`        | `true`            | `true`           |

`openWorldHint` is `false` everywhere: the wiki is a closed, bounded domain
(the pages of one organisation), not an open-ended external world. The hints
are set centrally via `READ_ONLY` / `writeAnnotations()` in
[`src/tools/_helpers.ts`](./src/tools/_helpers.ts) and covered by
`src/tools/annotations.test.ts`, which fails if a new tool forgets them.

---

## Configuration

See [`.env.default`](./.env.default). Key variables:

| Variable                     | Meaning                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `MCP_PORT`                   | Port of this server (default 8787)                               |
| `MCP_PUBLIC_URL`             | Canonical origin of this server = **token audience** (no `/mcp`) |
| `OAUTH_ISSUER`               | Base URL of the wiki app (authorization server + API)           |
| `OAUTH_INTROSPECTION_SECRET` | Shared secret — **must match** the backend                      |
| `WIKI_TENANT_ID`             | Single-org fallback (see note) — **leave empty on multi-tenant** |

> **`WIKI_TENANT_ID` is only for single-organisation deployments** reached via
> framework API tokens (n8n, ElevenLabs, …). On a multi-tenant deployment leave
> it **empty**: OAuth access tokens carry their own `tenant` binding (chosen by
> the user at sign-in), and a global fallback would force every tenant-less
> token into one organisation — leaking the wrong org's data or failing with
> "User is not a member of this tenant". An OAuth token that arrives without a
> tenant binding is treated as an error (reconnect), never silently mapped.

---

## Run locally

The backend must have OAuth2 enabled (it is, via `oauth2.enabled` in
`backend/src/index.ts`) and be running on `OAUTH_ISSUER`.

```bash
cd mcp-server
bun install
bun run init          # copies .env, pulls OAUTH_INTROSPECTION_SECRET from ../backend
bun run dev           # http://localhost:8787/mcp
```

Check the protection (no token → 401 with a pointer to the resource metadata):

```bash
curl -i -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# → HTTP/1.1 401  +  WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"
```

---

## App side (authorization server)

The backend enables OAuth2 in `defineServer()`:

```ts
oauth2: {
  enabled: true,
  introspectionSecret: process.env.OAUTH_INTROSPECTION_SECRET,
}
```

The framework then mounts all OAuth endpoints automatically
(`/oauth/authorize`, `/oauth/token`, `/oauth/introspect`, `/oauth/userinfo`,
`/.well-known/*`, …). Set `BASE_URL` (= issuer) and `OAUTH_INTROSPECTION_SECRET`
in the backend `.env`.

To connect a chat client, the tenant admin registers an OAuth client (with the
`knowledge:read` / `knowledge:write` scopes and the client's redirect URI) via
`POST /api/v1/tenant/:tenantId/oauth/clients`. Discovery, login/consent and the
token exchange then run automatically against the authorization server.

---

## Connecting a non-interactive client (ElevenLabs, n8n, …)

Interactive hosts like claude.ai discover the authorization server from the
`401` and run the full OAuth2 authorization-code flow (login + consent in a
browser) on their own. Many automation hosts — **ElevenLabs Agents**, n8n,
Zapier — cannot do that: they only support a **static credential** (a Bearer /
custom header). Give them a framework **API token** instead. It is long-lived,
scoped and revocable. An API token is **not** an OAuth bearer, so it has its own
header: send it as **`X-API-KEY`**. (For hosts that only expose a single "Bearer
token" field, `Authorization: Bearer <api-token>` is accepted too.)

**1. Create an API token** (once, as the user the agent should act as). Any
valid session works to mint it:

```bash
# Find your organisation (tenant) id:
curl -s https://wiki.symbiosika.de/api/v1/user/tenants \
  -H "Authorization: Bearer <your-session-jwt>"

# Mint a read-only token (add "knowledge:write" for authoring):
curl -s -X POST https://wiki.symbiosika.de/api/v1/user/api-tokens \
  -H "Authorization: Bearer <your-session-jwt>" \
  -H "content-type: application/json" \
  -d '{"name":"elevenlabs","tenantId":"<tenant-id>","scopes":["knowledge:read"]}'
# → { "token": "…" }   ← shown only once, store it as a secret
```

You can also create and revoke tokens from the wiki UI (user settings →
API tokens). Revoke anytime with
`DELETE /api/v1/user/api-tokens/:id`.

**2. Configure the host.** In ElevenLabs: *Add Custom MCP Server* →

- **Server URL**: `https://wiki-mcp.symbiosika.de/mcp`
- **Transport**: Streamable HTTP
- **Authentication**: custom header —

  ```
  X-API-KEY: <the-api-token>
  ```

  (or `Authorization: Bearer <the-api-token>` if the host only offers a Bearer
  field.)

Store the token as a **workspace secret**, never inline. That's it — the agent
now reads (and, with `knowledge:write`, edits) the wiki as that user.

---

## Deployment & hardening

- Run both services over **HTTPS** (terminate TLS at the reverse proxy).
- Always set `OAUTH_INTROSPECTION_SECRET` in production.
- Never drop the **audience check** in `src/auth.ts` — it is the confused-deputy
  protection.
