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

| Tool            | Purpose                                                              |
| --------------- | ------------------------------------------------------------------- |
| `get_wiki_tree` | Full page tree: `personal` / one section per `team` / `organisation` |
| `search_wiki`   | Full-text / hybrid / semantic search over visible pages             |
| `list_pages`    | Flat, paginated index of pages                                      |

### Reading

| Tool                  | Purpose                                                          |
| --------------------- | --------------------------------------------------------------- |
| `get_page`            | A single page in full (title, content, scope)                   |
| `read_page_content`   | File-like read, optional `fromLine` / `maxLines`                |
| `get_page_subtree`    | A page + all descendants as clean JSON (recursive)              |
| `get_page_links`      | Outgoing `[[wikilinks]]` (resolved / unresolved)                |
| `get_page_backlinks`  | Pages linking to this page                                      |
| `get_related_pages`   | Semantically related pages (needs embeddings)                   |
| `get_page_history`    | Version history snapshots                                       |

### Writing

| Tool                 | Purpose                                                          |
| -------------------- | --------------------------------------------------------------- |
| `create_page`        | New page (personal / in a team / organisation-wide; markdown)   |
| `update_page`        | Rename or move (parent, team, organisation-wide)                |
| `edit_page_content`  | Surgical find-and-replace edit of the body                      |
| `delete_page`        | Delete a page                                                   |

---

## Configuration

See [`.env.default`](./.env.default). Key variables:

| Variable                     | Meaning                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `MCP_PORT`                   | Port of this server (default 8787)                               |
| `MCP_PUBLIC_URL`             | Canonical origin of this server = **token audience** (no `/mcp`) |
| `OAUTH_ISSUER`               | Base URL of the wiki app (authorization server + API)           |
| `OAUTH_INTROSPECTION_SECRET` | Shared secret — **must match** the backend                      |
| `WIKI_TENANT_ID`             | Fallback organisation id if the token carries no `tenant`       |

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

### Connecting a chat client

Two ways, both fully supported:

- **Automatic (Dynamic Client Registration, RFC 7591):** MCP clients like
  claude.ai register themselves at `POST /oauth/register`. They typically omit
  `scope` in the registration request — the backend then assigns the
  `oauth2.dcrDefaultScopes` configured in `backend/src/index.ts` (wiki +
  identity scopes only), so the subsequent authorize request for the scopes
  advertised in this server's resource metadata succeeds.
- **Manual:** a tenant admin creates an OAuth app in the frontend under
  *Manage → OAuth apps* (or via
  `POST /api/v1/tenant/:tenantId/oauth/clients`), with the client's redirect
  URI and the `knowledge:read` / `knowledge:write` scopes.

Discovery, login/consent and the token exchange then run automatically against
the authorization server. Token audience: the backend honors the RFC 8707
`resource` parameter (claude.ai sends `MCP_PUBLIC_URL/mcp`), and this server
accepts `MCP_PUBLIC_URL/mcp`, `MCP_PUBLIC_URL` or the issuer as `aud`. Rejected
tokens are logged with the concrete reason (introspection unreachable, secret
mismatch, inactive, audience mismatch) — check these logs first when claude.ai
reports "returned an error when connecting" after authorization.

---

## Deployment & hardening

- Run both services over **HTTPS** (terminate TLS at the reverse proxy).
- Always set `OAUTH_INTROSPECTION_SECRET` in production.
- Never drop the **audience check** in `src/auth.ts` — it is the confused-deputy
  protection.
