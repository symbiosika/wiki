# Refactor Review

Dieses Dokument sammelt die wichtigsten Findings aus dem Code Review des Fullstack-Templates. Es ist bewusst als kommentierbare Arbeitsliste aufgebaut.

## Kommentar-Legende

- `Status`: offen | geplant | in Arbeit | erledigt | verworfen
- `Entscheidung`: Wie wir damit umgehen wollen.
- `Kommentar`: Notizen, Einwande, Kontext, Links.

## P0 - Kritisch

### Session-Persistenz ist defekt

**Bereich:** Backend Framework Auth  
**Dateien:** `backend/framework/src/lib/auth/index.ts`, `backend/framework/src/lib/db/schema/users.ts`

`sessions.sessionToken` ist Primary Key, wird bei Login und Passkey-Login aber immer als leerer String geschrieben. Dadurch kann es faktisch nur eine globale Session-Zeile geben, oder neue Logins überschreiben alte.

**Vorschlag:** Entscheiden, ob Sessions wirklich gebraucht werden. Falls ja: echte eindeutige Session-ID speichern und Tests fur mehrere parallele User/Sessions erganzen. Falls nein: Tabelle und Codepfad entfernen oder klar als ungenutzt markieren.

**Status:** offen  
**Entscheidung:**
Mache daraus ein eigenes Markdown File! wir machen das später!

**Kommentar:**  

### Frontend-Routing ist gebrochen

**Bereich:** Frontend SPA  
**Dateien:** `frontend/src/router/index.ts`, `frontend/src/views/user/index.vue`, `frontend/src/views/user/change-pwd.vue`

Der Auth-Guard leitet auf `name: 'Login'`, aber diese Route existiert nicht. Auch `/user` und `/change-pwd` werden verwendet, sind aber nicht registriert.

**Vorschlag:** Router als Single Source of Truth aufraumen. Entweder Login bewusst extern uber `/login.html` behandeln oder als SPA-Route modellieren. User- und Passwort-Routen registrieren oder tote Views entfernen.

**Status:** offen  
**Entscheidung:**  
Ja, Vorschlag akzeptiert!
Entferne diese ganzen Login Leichen und Routen.
Das wird alles über die statischen HTML Dateien im public Ordner gemacht!

**Kommentar:**  

### Startup-Validierung wird nicht awaited

**Bereich:** Backend Framework Startup  
**Dateien:** `backend/framework/src/index.ts`, `backend/framework/src/lib/utils/env-validate.ts`

`validateAllEnvVariables()` ist async, wird im Server-Setup aber ohne `await` aufgerufen. Env- und JWT-Key-Checks konnen parallel zu DB- und Route-Setup laufen.

**Vorschlag:** Bootpfad async machen und kritische Env-/Key-/DB-Initialisierung abschliessen, bevor der Server Requests annimmt.

**Status:** offen  
**Entscheidung:**  
ist unwichtig.

**Kommentar:**  

### Chat-API hat keine Tenant-Isolation

**Bereich:** Backend App Route  
**Datei:** `backend/src/routes/tenant/[tenantId]/chat/index.ts`

Die Route authentifiziert den User, pruft aber nicht, ob der User Mitglied des `tenantId` aus dem Pfad ist. Das ist ein IDOR-Risiko und kann Provider-Kosten fur fremde Tenant-IDs verursachen.

**Vorschlag:** Tenant-Membership-Middleware oder expliziten DB-Check vor dem Chat-Handler erzwingen.

**Status:** offen  
**Entscheidung:**  
Ja, Vorschlag akzeptiert!

**Kommentar:**  

## P1 - Hoch

### Stale generierte Frontend-Typen

**Bereich:** Frontend Tooling  
**Dateien:** `frontend/src/components.d.ts`, `frontend/src/auto-imports.d.ts`

Die generierten Dateien referenzieren Komponenten und Stores, die im Template nicht existieren.

**Vorschlag:** Dateien aus aktuellem Tree neu generieren. Danach entscheiden, ob sie committed bleiben oder per Ignore/Postinstall generiert werden.

**Status:** offen  
**Entscheidung:**  
Das sollte sich einfach mit einem "bun run build" beheben lassen.
Ja, Vorschlag akzeptiert!

**Kommentar:**  

### Custom-App-Routen sind public by default

**Bereich:** Backend App/Framework Boundary  
**Dateien:** `backend/src/index.ts`, `backend/src/routes/tenant/[tenantId]/chat/index.ts`, `backend/framework/src/index.ts`

`customHonoApps` ist im Framework public. Der Chat setzt zwar selbst Auth-Middleware, aber neue Routen im gleichen Sub-App-Konzept konnten versehentlich public werden.

**Vorschlag:** Geschutzte App-Routen uber `customHonoAppsWithAuth` registrieren und public/protected bewusst trennen.

**Status:** offen  
**Entscheidung:**  
Ja, Vorschlag akzeptiert!

**Kommentar:**  

### Chat-Request-Schema wird nicht verwendet

**Bereich:** Backend App Route  
**Datei:** `backend/src/routes/tenant/[tenantId]/chat/index.ts`

`chatRequestSchema` ist definiert, aber der Handler liest `await c.req.json()` direkt und castet die Daten.

**Vorschlag:** `validator('json', chatRequestSchema)` verwenden, Payload-Grosse/Shape begrenzen, Provider-Fehler serverseitig loggen und dem Client generische Fehler liefern.

**Status:** offen  
**Entscheidung:**  
Ja, Vorschlag akzeptiert!

**Kommentar:**  

### `customDbSchema` ubernimmt Nicht-Tabellen-Exports

**Bereich:** Backend App DB  
**Dateien:** `backend/src/index.ts`, `backend/src/db/schema.ts`

`* as robotTasksSchema` enthalt auch `pgBaseTable`, wird aber komplett an `customDbSchema` ubergeben.

**Vorschlag:** Tabellen-Exports von Hilfsfunktionen trennen oder explizit nur Drizzle-Tabellen in `customDbSchema` aufnehmen.

**Status:** offen  
**Entscheidung:**  
Eher umbenennen. Das soll ein VOLLES schema sein. so dass TS in der App dann ein schema hat, wo es ALLE tabellen kennt, aus app und framework.

**Kommentar:**  

### `checkUserPermission` ist ein No-op

**Bereich:** Backend Framework Authz  
**Datei:** `backend/framework/src/lib/utils/hono-middlewares.ts`

Die Middleware ist an vielen Routen montiert, ruft aktuell aber nur `next()` auf.

**Vorschlag:** Entweder Permission-Check reaktivieren und testen oder Middleware umbenennen/entfernen, damit kein falsches Sicherheitsgefuhl entsteht.

**Status:** offen  
**Entscheidung:** 
Nicht implementieren. Das soll bleiben.

**Kommentar:**  

### App-Init im Frontend hat keinen Fehlerpfad

**Bereich:** Frontend State/Auth  
**Dateien:** `frontend/src/App.vue`, `frontend/src/stores/main.ts`, `frontend/src/utils/fetcher.ts`

Wenn `getMyUser()` oder `getTenants()` fehlschlagt, kann `state.loading` dauerhaft `true` bleiben.

**Vorschlag:** Zentralen 401/403-Flow im Fetcher erganzen, `init()` mit `try/finally` absichern und klaren Redirect/Error-State setzen.

**Status:** offen  
**Entscheidung:**  
Ja, Vorschlag akzeptiert!

**Kommentar:**  

## P2 - Mittel

### Repo-Hygiene und Artefakte

**Bereich:** Repository  
**Dateien:** `.gitignore`, `backend/dist/index.js`, `backend/public/*`, `tmp/public/*`

Root-`.gitignore` ignoriert nur `tmp/**/*`; gleichzeitig gibt es viele untracked Build-/Public-Artefakte.

**Vorschlag:** Monorepo-weite Ignore-Regeln definieren und entscheiden, welche Public-Dateien echte Template-Assets sind.

**Status:** offen  
**Entscheidung:**  
gitignore sollte nur für das root verzeichnis gelten.
frontend und backend sollten ihre eigenen gitignore Dateien haben.
nur anpassen was wirklich unabhängig dieser beiden ist.

**Kommentar:**  

### CI ist nicht monorepo-tauglich

**Bereich:** CI/CD  
**Dateien:** `backend/.github/workflows/*`, `frontend/.github/workflows/*`

Workflows liegen unter App-Unterordnern statt im Root `.github/workflows`. Mehrere Jobs checken zudem hart `develop` aus.

**Vorschlag:** Root-Workflows mit `working-directory: backend` und `working-directory: frontend` anlegen, echten Push-/PR-Commit bauen und Test-/Typecheck-Gates erganzen.

**Status:** offen  
**Entscheidung:** 
Fixe ist selbst!!

**Kommentar:**  

### JavaScript-Cookie statt HttpOnly-Cookie

**Bereich:** Auth/Security  
**Dateien:** `backend/public/login.html`, `backend/public/magic-login-verify.html`

Login-Seiten setzen JWT per `document.cookie`; dadurch ist kein `HttpOnly` moglich. Ausserdem wird Tailwind per CDN geladen.

**Vorschlag:** Backend setzt Session-Cookie per `Set-Cookie` mit `HttpOnly`, `Secure`, `SameSite`. Login-UI entweder in SPA integrieren oder statische Seiten buildbar machen.

**Status:** offen  
**Entscheidung:**  
Nix machen!

**Kommentar:**  

### DB/SSL-Konfiguration ist uneinheitlich

**Bereich:** Backend DB/Ops  
**Dateien:** `backend/framework/src/lib/db/db-connection.ts`, `backend/drizzle.config.ts`, `backend/framework/drizzle.config.ts`

Runtime und Drizzle konfigurieren SSL getrennt und setzen `rejectUnauthorized: false`.

**Vorschlag:** Gemeinsame DB-Konfigurationsfunktion einziehen und lokale Dev-Defaults klar von Production-Defaults trennen.

**Status:** offen  
**Entscheidung:**  
Nix machen!

**Kommentar:**  

### Framework-Startup ist zu breit gekoppelt

**Bereich:** Backend Framework Architecture  
**Datei:** `backend/framework/src/index.ts`

Viele optionale Subsysteme werden immer oder spat asynchron registriert: License, AI Knowledge, Docs, Notifications, Jobs, Static Serving.

**Vorschlag:** Feature-Flags und Startup-Phasen klarer schneiden. Kritische Initialisierung vor Ready-State abschliessen.

**Status:** offen  
**Entscheidung:**  
Nix machen!

**Kommentar:**  

### Static/Public Assets sind inkonsistent

**Bereich:** Backend Assets  
**Dateien:** `backend/public/*`, `backend/static/index.html`

Statische Login-Seiten referenzieren Assets, die nicht eindeutig im Template vorhanden sind. Ein malformed `backend/static/index.html` wurde gemeldet.

**Vorschlag:** Public/Static-Assets als explizite Template-Assets pflegen oder komplett aus einem Build-Prozess ableiten.

**Status:** offen  
**Entscheidung:**  
Ja, alles was diese html seiten nutzen sollte auch DORT im public Ordner sein! kopieren notfalls!

**Kommentar:**  

## P3 - Wartbarkeit

### Fetcher und Auth-State zentralisieren

**Bereich:** Frontend API/Auth  
**Dateien:** `frontend/src/utils/fetcher.ts`, `frontend/src/stores/authStore.ts`, `frontend/src/stores/main.ts`

Auth ist verteilt auf Cookie-Checks, Router Guard, Logout und Fetcher-Fehlerbehandlung.

**Vorschlag:** Auth-Store als Single Source of Truth nutzen, Fetcher mit typed errors und zentralem 401/403-Handling ausbauen.

**Status:** offen  
**Entscheidung:**  
Nix machen!

**Kommentar:**  

### Scripts und Template-Dokumentation bereinigen

**Bereich:** Developer Experience  
**Dateien:** `backend/package.json`, `README.md`, `backend/README.md`, `frontend/README.md`

Einige Scripts wirken kaputt oder nicht passend zum Template, z.B. `init`, `add-demo-data`, `release:*`, `clean`.

**Vorschlag:** Scripts auf Template-Nutzung reduzieren, gefahrliche Publish-Skripte entfernen oder dokumentieren, Setup-Schritte in Root-README konsolidieren.

**Status:** offen  
**Entscheidung:**  
Nix machen!

**Kommentar:**  
