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
- **Öffentliche Doku-Seite** (`frontend-public/`): schlanke, read-only
  Zweitansicht für veröffentlichte Seiten — ohne Login, ohne Editor. Sie liest
  ausschließlich die öffentliche API (`/api/v1/public/wiki/:tenantId/…`) und
  zeigt nur, was über `publicMode` freigegeben wurde. Ausgeliefert unter
  `/docs/` aus `backend/public/` (das Haupt-Frontend liegt dagegen hinter dem
  Login unter `/static/app/`). Siehe
  [`frontend-public/README.md`](./frontend-public/README.md).
- **MCP-Server** (`mcp-server/`): eigenständiger OAuth2-Resource-Server, über
  den eine Chat-App das Wiki als "Brain" nutzen kann (Identität, Discovery,
  Lesen, Schreiben). Siehe [`mcp-server/README.md`](./mcp-server/README.md).
- **Tagesprotokoll einsprechen**: von der Startseite ein Protokoll per Sprache
  aufnehmen → **Live-Transkription** (der Text erscheint schon während des
  Sprechens) → KI-Aufbereitung (Zusammenfassung, Kernpunkte, Aufgaben) →
  datierte Seite unter „Tagesprotokolle". Optionaler „Digital-Twin-Brain": ein
  Agent extrahiert Fakten in eine kuratierte Themen-Hierarchie unter
  „Wissensbasis". Keys: `OPENROUTER_API_KEY` (LLM/Agents über OpenRouter mit
  einem Mistral-Modell) und `MISTRAL_API_KEY` (Live-Transkription).
  - Die Live-Transkription streamt 16-kHz-PCM (`pcm_s16le`) vom Browser über
    einen Backend-WebSocket-Relay (`GET …/protocol/realtime`) an Mistrals
    Realtime-Endpoint (Voxtral). Der `MISTRAL_API_KEY` bleibt serverseitig.
    Modell konfigurierbar über `MISTRAL_REALTIME_MODEL`
    (Default `voxtral-mini-transcribe-realtime-2602`). Browser ohne
    Web-Audio-/AudioWorklet-Unterstützung fallen automatisch auf die
    asynchrone Aufnahme (`POST …/protocol/transcribe`) zurück.
- **Dokument-Assistent**: auf jeder Seite ein „Assistent"-Button, der ein Panel
  öffnet, in dem man per Sprache oder Text mit dem Dokument interagiert. Man
  beschreibt eine Änderung in natürlicher Sprache, ein Agent arbeitet sie ins
  Dokument ein (anpassen bestehender Inhalte per String-Replace oder Anhängen
  neuer Blöcke) – strukturerhaltend und direkt angewendet. Jede Änderung wird
  als Version gespeichert (über die Historie revertierbar). LLM über OpenRouter,
  Spracheingabe über die Live-Transkription. Endpoint: `POST
  …/document-assistant` (`{ entryId, instruction }`).

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

# Öffentliche Doku-Seite (optional)
cd ../frontend-public
bun install
bun run dev           # http://localhost:5174/docs/
```

Hinweis für die lokale PGlite-DB: in `backend/.env`
`POSTGRES_CONNECTION_POOL_SIZE=1` setzen. PGlite verkraftet keine
parallel verschränkten Queries; gegen eine echte Postgres
(`bun run docker:up`) ist die Einstellung unnötig.

Login lokal ohne SMTP: `SMTP_HOST=console.localhost` (Default) schreibt
Magic-Link-Mails nach `backend/logs/email/`. Testuser anlegen:
`bash backend/framework/.scripts/testuser.sh http://localhost:3000`.

### Anmeldung mit Microsoft 365 (optional)

Sind Client-ID **und** Secret einer Entra-ID-App gesetzt, zeigt die
Anmeldeseite direkt auf der ersten Stufe zusätzlich den Button
„Mit Microsoft 365 anmelden“. Der Magic-Link-Login bleibt unverändert
verfügbar – die Microsoft-Anmeldung kommt nur dazu. Fehlt eine der beiden
Variablen, erscheint der Button nicht.

```env
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<Client Secret>
# Verzeichnis: Tenant-GUID (nur eigene Organisation), `organizations`
# oder `common` (Default, jedes Microsoft-Konto)
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
```

In der Entra-App als Redirect-URI (Plattform „Web“) exakt hinterlegen:

```
<BASE_URL>/api/v1/auth/microsoft/callback
```

Benötigte Delegated Permissions: `openid`, `profile`, `email`, `User.Read`.
Angemeldet wird über die E-Mail-Adresse des Microsoft-Kontos: existiert ein
Account mit dieser Adresse, wird er verwendet (egal ob er ursprünglich per
Magic-Link entstanden ist), andernfalls wird er wie bei der Magic-Link-
Registrierung neu angelegt – inklusive Invitation-Code-Regeln und offener
Organisations-Einladungen.

## Preview-Container (alles in einem)

[`Dockerfile.preview`](./Dockerfile.preview) baut ein einziges Image mit
**PGlite + Backend + Frontend** – keine externe Datenbank, keine Secrets, kein
Compose-Verbund. Gedacht für schlanke Preview-Deployments (PR-Previews, Demos,
schneller Smoke-Test); für Produktion bleibt [`Dockerfile`](./Dockerfile) +
[`docker-compose.prod.yml`](./docker-compose.prod.yml) zuständig.

```bash
git submodule update --init --recursive     # framework muss ausgecheckt sein

docker build -f Dockerfile.preview -t wiki-preview .
docker run --rm -p 3000:3000 -v wiki_preview:/data wiki-preview
# oder:
docker compose -f docker-compose.preview.yml up --build
```

Danach `http://localhost:3000` öffnen. Login per Magic-Link: die Mail landet
wegen `SMTP_HOST=console.localhost` im Container-Log
(`docker logs -f <container>`), der Link ist direkt anklickbar.

Was der Container beim Start macht
([`.docker/preview-entrypoint.sh`](./.docker/preview-entrypoint.sh)):

1. **Secrets** (AES, JWT, OAuth-Introspection) beim ersten Start erzeugen und
   in `/data/secrets.env` (0600) ablegen – danach wiederverwenden, damit
   Sessions und verschlüsselte Tenant-Secrets Neustarts überleben. Von außen
   gesetzte Variablen haben immer Vorrang.
2. **PGlite** starten: eingebettete Postgres inkl. `pgvector`, über
   pglite-socket auf `127.0.0.1:5432`. Es läuft dasselbe Skript wie bei
   `bun run db:local`.
3. **Migrationen** (`framework:migrate` + `app:migrate`) wie im Prod-Image.
4. **App** starten (`bun ./dist/index.js`), bei SIGTERM wird die Datenbank
   sauber geschlossen.

Alles Zustandsbehaftete liegt unter `/data` (Datenbank, Secrets, lokale
Uploads). Volume mounten = Preview überlebt Neustarts, Volume weglassen =
Wegwerf-Instanz, die bei jedem Start frisch beginnt.

Nützliche Env-Variablen:

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Öffentliche URL = OAuth2-Issuer, muss zur Browser-Adresse passen |
| `APP_NAME` | `Symbiosika Wiki (Preview)` | Anzeigename (Mails, OAuth-Metadaten) |
| `PREVIEW_DATA_DIR` | `/data` | Ablage für DB, Secrets, Uploads |
| `PREVIEW_EMBEDDED_DB` | `auto` | `false` = externe Postgres über `POSTGRES_*` nutzen |
| `PREVIEW_SKIP_MIGRATIONS` | `false` | Migrationen beim Start überspringen |
| `AI_PROVIDER`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY` | – | optional; ohne Keys sind die KI-Features No-ops |
| `SMTP_*` | Console-Modus | echten SMTP-Server statt Container-Log verwenden |

Grenzen: PGlite ist eine dateibasierte Single-Process-Datenbank (deshalb
`POSTGRES_CONNECTION_POOL_SIZE=1`) und der Container hält App und Datenbank im
selben Prozessbaum – gut für eine Preview-Instanz, nicht für echte Last oder
echte Daten.

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
