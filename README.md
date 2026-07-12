# symbiosika-wiki

Ein einfaches, agentenfreundliches Wiki auf Basis des symbiosika-frameworks.

- **Seiten** sind Framework-`knowledgeTexts` mit `parentId`-Hierarchie und
  Block-Inhalten (`knowledge/texts`-API: Blöcke, Volltext-/Hybrid-Suche,
  Wikilinks, Backlinks, Versionshistorie, file-artige Read/Edit-Endpunkte
  für AI-Agenten).
- **Sichtbarkeit** pro Seite: Persönlich (`userId`), Team (`teamId`) oder
  Organisation (`tenantWide`).
- **Frontend**: Vue 3 SPA mit Notion-artigem TipTap-Block-Editor
  (Slash-Befehle, Bubble-Menü, Drag-Handle, Markdown-Input-Rules,
  To-do-Listen) und einklappbarem Seitenbaum
  (Persönlich / Teams / Organisation) plus Organisations-/Team-/
  Einladungsverwaltung.
- **MCP-Server** (`mcp-server/`): eigenständiger OAuth2-Resource-Server, über
  den eine Chat-App das Wiki als "Brain" nutzen kann (Identität, Discovery,
  Lesen, Schreiben). Siehe [`mcp-server/README.md`](./mcp-server/README.md).

## Setup

```bash
git clone https://github.com/symbiosika/wiki.git --recurse-submodules
cd wiki

# Backend
cd backend
bun install
bun run init          # erzeugt .env mit Secrets

# Lokale Dev-Datenbank (PGlite, kein Docker nötig)
bun run db:local      # Terminal 1: startet PGlite auf localhost:5432
bun run migrate       # Framework- + App-Migrationen
bun run dev           # Terminal 2: API auf http://localhost:3000

# Frontend
cd ../frontend
bun install
bun run dev           # http://localhost:5173/static/app/
```

Hinweis für die lokale PGlite-DB: in `backend/.env`
`POSTGRES_CONNECTION_POOL_SIZE=1` setzen. PGlite verkraftet keine
parallel verschränkten Queries; gegen eine echte Postgres
(`bun run docker:up`) ist die Einstellung unnötig.

Login lokal ohne SMTP: `SMTP_HOST=console.localhost` (Default) schreibt
Magic-Link-Mails nach `backend/logs/email/`. Testuser anlegen:
`bash backend/framework/.scripts/testuser.sh http://localhost:3000`.

## Tests

```bash
# Backend (bun:test, läuft gegen die lokale DB)
cd backend
bun test src/lib/wiki/tree.test.ts "src/routes/tenant/[tenantId]/wiki/index.test.ts"

# Frontend (vitest)
cd frontend
bun run test
bun run type-check
```

## Architektur

- `backend/src/routes/tenant/[tenantId]/wiki/` – `GET /api/v1/tenant/:tenantId/wiki/tree`
  liefert den Seitenbaum, partitioniert in `personal`, `teams[]` (eine
  Sektion pro Team) und `organisation`. Alles andere (CRUD, Blöcke, Suche,
  Links, History) kommt direkt vom Framework unter
  `/api/v1/tenant/:tenantId/knowledge/texts…`.
- `backend/src/lib/wiki/tree.ts` – Baum-Businesslogik (reine Funktionen,
  getestet).
- `frontend/src/stores/wiki.ts` – Pinia-Store (Tree, Seite, Blöcke,
  debounced Save, Suche).
- `frontend/src/components/editor/` – TipTap-Block-Editor. Jeder
  Top-Level-Knoten trägt eine stabile Block-ID (`data-block-id` ↔
  Backend-Block-`id`), gespeichert wird per Diff-Sync
  (`PUT …/knowledge/texts/:id/blocks`).
- `frontend/src/components/wiki/` – Sidebar mit einklappbaren Sektionen
  und rekursivem Tree.

## Agentische Nutzung

Jede Wiki-Seite ist über die Framework-API auch für AI-Agenten nutzbar:

- `GET /:id/content?fromLine&maxLines` – file-artiges Lesen
- `PATCH /:id/content` – String-Replace-Edit (wie ein Editor-Tool)
- `GET /knowledge/texts/search?q=…&mode=hybrid|fulltext|semantic`
- `GET /:id/simplified?recursive=true` – ganze Teilbäume als LLM-freundliches JSON
- `GET /:id/links` / `GET /:id/backlinks`

## Init (Template)

```bash
cd backend
bun run init
bun run sync-skills
```
