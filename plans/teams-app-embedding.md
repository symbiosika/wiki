# Teams-App-Embedding (`?host=teams`)

Stand: `develop` @ c36c082, Framework @ cfae1a3.

> ## STATUS: umgesetzt
>
> Betriebsanleitung: `docs/teams-app.md`. Framework-Anteil:
> `FRAMEWORK_CHANGES_TEAMS_SSO.md` + `framework-teams-sso.patch`.
>
> **Vier Dinge sind anders gelaufen als hier geplant:**
>
> 1. **Keine `teams.html`.** Sobald das SPA-Bundle ohne Login ausgeliefert wird
>    (`staticPrivateExclude`), kann der Bootstrap direkt in der SPA laufen. Damit
>    entfällt eine handgeschriebene Vanilla-Seite, `teams-js` kommt als npm-Paket
>    (lazy importiert), und die Einladungscode-Abfrage ist eine Vue-Komponente
>    (`components/teams/TeamsSessionGate.vue`) statt eines zweiten HTML-Formulars.
> 2. **`complete-registration` im Framework blieb unangetastet.** Statt dessen
>    Cookie-Zwang aufzuweichen, gibt es eine eigene App-Route, die den
>    (signierten, 15-minütigen) Pending-Token im Body annimmt und
>    `completePendingOAuthRegistration` aufruft. Kein Eingriff in den
>    Browser-Flow.
> 3. **Der Framework-Patch enthält dafür zwei andere Bausteine:**
>    `staticPrivateExclude` und Session-Token via `?token=` für WebSocket-
>    Handshakes. Beide waren aus der App nicht lösbar (Mount bzw.
>    Auth-Middleware liegen im Framework).
> 4. **`utils/wikiPdf.ts` brauchte keine Änderung** — es lädt Bilder bereits über
>    `fetcher.getBlob`, der Bearer-Header greift also automatisch.
>
> Nicht verifiziert: iPadOS/Teams-Mobile und die Entra-Registrierung selbst
> (Admin-Schritte, kein Tenant-Zugang in dieser Umgebung).

Ziel: Das Wiki als Teams Personal Tab einbetten. Der in Teams angemeldete Nutzer
wird über `teams-js` gegen Entra authentifiziert und gegen eine Framework-Session
getauscht — ohne zweiten Login, mit denselben Invitation-Code-Regeln wie der
bestehende Microsoft-Login.

## Was bereits da ist (und wiederverwendet wird)

Der Social-Login ist vollständig implementiert (Framework #118, App #135) und
liefert genau die Bausteine, die ein Teams-Exchange braucht:

| Baustein | Ort | Rolle für Teams |
|---|---|---|
| `findOAuthUser(profile)` | `lib/auth/oauth2.ts:333` | Auflösung über `extUserId`, dann E-Mail; verlinkt bestehende Magic-Link-Konten |
| `createOAuthUser(profile, tenantId, meta)` | `lib/auth/oauth2.ts:375` | Registrierung inkl. Tenant-Beitritt + Pending-Invitations |
| `needsInvitationCodeToRegister(email)` | `lib/auth/oauth2.ts:517` | Invitation-Gate (offene Tenant-Einladung zählt als Autorisierung) |
| `createPendingRegistrationToken()` | `lib/auth/oauth2.ts:466` | 15-min-Token für „Code fehlt noch" |
| `completePendingOAuthRegistration()` | `lib/auth/oauth2.ts:531` | Zweiter Versuch mit Code → Session |
| `POST /user/oauth/complete-registration` | `routes/user/public.ts:971` | Fertige Route für den Code-Schritt |
| `MICROSOFT_CLIENT_ID/_SECRET/_TENANT_ID` | `docker-compose.prod.yml:79-83` | ENV bereits verdrahtet |

Konsequenz: **kein Refactoring nötig.** Der Teams-Exchange validiert das
Entra-Token, baut daraus ein `OAuthProfile` und hängt sich an dieselbe Kette.
Die drei möglichen Ausgänge sind identisch zum Browser-Flow:
`authenticated` | `invitation_code_required` | Fehler.

## Architekturentscheidung: Bearer im Teams-Modus

Cookie bleibt Default im Browser (HttpOnly, XSS-fest — relevant, weil
`MarkdownRenderer.vue:37` User-Content per `v-html` rendert und der Sanitizer in
`utils/markdown.ts` selbstgeschrieben ist). Im Teams-Modus stattdessen Bearer:

- Das Cookie ist im Teams-iFrame Third-Party (`sameSite: "Lax"`,
  `lib/auth/auth-cookies.ts:29`) und würde nicht mitgesendet.
- `SameSite=None` wäre möglich, kostet aber den einzigen CSRF-Schutz (es gibt
  keine Origin-Prüfung und kein CSRF-Token) und ist auf iPadOS/Safari (kein
  CHIPS-Support) trotzdem unsicher.
- `checkToken` akzeptiert `Authorization: Bearer` bereits (`hono-middlewares.ts:134`).
- Token **nur im Speicher**, kein `localStorage`/`sessionStorage`: nach einem
  Reload holt der Bootstrap still ein neues Entra-Token via `getAuthToken()`.
  Es gibt also nichts Persistentes zu stehlen.

Damit entfallen: `SameSite=None`-Umbau, `Partitioned`-Cookies, CSRF-Middleware.

## Backend

### 1. Entra-Token-Validierung — neu: `lib/auth/teams-sso.ts` (~170 LOC)
- JWKS von `https://login.microsoftonline.com/{tid}/discovery/v2.0/keys` holen,
  nach `kid` cachen (TTL + Refresh bei unbekanntem `kid`). `jsonwebtoken` ist
  vorhanden; JWKS-Fetch selbst schreiben.
- Prüfen: RS256-Signatur, `aud` == `MICROSOFT_CLIENT_ID` **oder**
  `api://<host>/<client-id>`, `iss` == `https://login.microsoftonline.com/{tid}/v2.0`,
  `exp`/`nbf`, `scp` enthält `access_as_user`, `tid` == `MICROSOFT_TENANT_ID`
  (wenn gesetzt und != `common`).
- Claims → `OAuthProfile`: `oid` → `id`, `preferred_username`/`upn` → `email`
  (durch `normalizeEmail`), `name` → `firstname`/`surname`, `provider: "microsoft"`.
  Damit landet ein Teams-Nutzer auf demselben Konto wie beim Browser-Login über
  Microsoft — `findUserByExternalId` matcht auf `oid`, das beide Flows liefern.
- Aktivierung über `isOAuthProviderActive("microsoft")`, keine neue ENV.

### 2. Exchange-Route — `POST /user/auth/teams/exchange` (~90 LOC)
Body: `{ teamsToken: string }`. Ablauf:
1. Token validieren → `OAuthProfile`.
2. `findOAuthUser(profile)` → gefunden: `generateUserSessionJwt`, Antwort
   `{ status: "authenticated", token, expiresAt, user }`.
3. Nicht gefunden + `needsInvitationCodeToRegister(email)` → Antwort
   `{ status: "invitation_code_required", pendingRegistrationToken, email }`.
   Token **im Body**, nicht im Cookie (siehe 3.).
4. Sonst `createOAuthUser(profile)` → Session.
- Rate-Limit pro `oid`/IP.
- Der Token wird im Body zurückgegeben (wie alle Login-Routen,
  `routes/user/public.ts:139`); `setAuthCookies` wird hier **nicht** aufgerufen.

### 3. `complete-registration` body-fähig machen (~10 LOC)
`routes/user/public.ts:999` liest den Pending-Token nur aus dem HttpOnly-Cookie.
Für Teams: optionales `pendingRegistrationToken` im Body als Fallback, Cookie
hat Vorrang. Der Token ist signiert, 15 min gültig und ohne Rechte — im Body
nicht schwächer als im Cookie (er landet nicht in URL/History/Logs). Zusätzlich
den Session-Token im Response-Body zurückgeben, wenn per Body authentisiert
wurde.

### 4. WebSocket-Auth per Query-Token (~25 LOC)
Presence (`routes/tenant/[tenantId]/wiki/index.ts:207`) und Realtime-Transkription
hängen an `authAndSetUsersInfo`, also am Cookie. Die Browser-WebSocket-API kann
**keine** Header setzen. Der `?token=`-Zweig in `hono-middlewares.ts:141` geht
heute nur über `generateTemporaryJwtFromToken` (API-Tokens). Erweitern: ein
Session-JWT wird akzeptiert, wenn der Request ein WS-Upgrade ist
(`Upgrade: websocket`), damit die Erweiterung nicht die ganze REST-API für
Token-in-URL öffnet.

### 5. ENV / Deployment
Keine neue Variable. Zu ergänzen: `MICROSOFT_*` in `.env.prod.example`
(in `docker-compose.prod.yml` vorhanden, in der Beispieldatei nicht).
Entra-App-Registrierung erweitern:
- Application ID URI `api://<host>/<client-id>`
- Scope `access_as_user`
- Vorautorisierte Teams-Client-IDs (Desktop/Web/Mobile)
- Neu: kein Secret nötig (nur Validierung), das bestehende bleibt für den
  Browser-Flow.

## Frontend

### Neu
| Datei | Inhalt | ~LOC |
|---|---|---|
| `backend/public/teams.html` | Öffentlicher Einstieg: `teams-js` initialisieren, `getAuthToken()`, Exchange, Invitation-Code-Schritt (wenn nötig), Theme aus Teams-Kontext, dann Redirect in die SPA. Vorbild: `oauth-callback.html` | ~200 |
| `frontend/src/utils/teamsSession.ts` | Modus + In-Memory-Token, `isTeamsHost()` aus `?host=teams`, silent Re-Auth über `teams-js` | ~60 |

`teams-js` als UMD-Datei ins Image kopieren (Build-Step), kein CDN — der
CSP-/Offline-Fall ist sonst nicht kontrollierbar.

### Geändert
| Datei:Zeile | Änderung | ~LOC |
|---|---|---|
| `utils/fetcher.ts:20,38,71` | Bearer-Header im Teams-Modus; `redirectToLogin()` → im Teams-Modus silent Re-Auth statt Navigation zu `/login.html` | 30 |
| `router/index.ts:125,146` | Guard: im Teams-Modus Token-Status statt `jwt_present`-Cookie | 15 |
| `stores/theme.ts:32` | `setPreference(pref, { persist: false })` — Teams-Theme darf die Browser-Präferenz nicht überschreiben | 8 |
| `stores/authStore.ts` | Logout im Teams-Modus ausblenden (kein `/logout.html`) | 10 |
| `frontend/index.html:16` | Inline-Theme-Skript berücksichtigt `?theme=dark` vor `localStorage` (kein Flash) | 5 |
| `stores/main.ts:297`, `WikiSidebar.vue:596`, `profile.vue:1141` | Bild-URLs über Blob-Helper (Fetcher + `createObjectURL`) statt direktem `<img :src>` | 40 |
| `WikiAiChat.vue:346`, `views/chat/index.vue:87` | `DefaultChatTransport({ api, headers })`, lazy damit ein erneuerter Token greift | 10 |
| `useWikiPresence.ts:80`, `useRealtimeTranscription.ts:134` | `?token=` an die WS-URL im Teams-Modus | 10 |
| `utils/wikiPdf.ts:87` | derselbe Blob-Helper | 5 |

Stores, Views und alle übrigen Fetcher-Aufrufer bleiben unangetastet.

### Offen: SPA-Mount
`/static/*` liegt hinter `authOrRedirectToLogin` (`framework/src/index.ts:428`),
die SPA unter `/static/app/` (`vite.config.ts:18`). Im Bearer-Modus gibt es beim
Dokument-Load kein Cookie → 302 auf `/login.html`. Optionen:
1. **Zweiter, öffentlicher Mount** für das Bundle (z. B. `/app/*`), nur für den
   Teams-Pfad. Das Bundle enthält keine Geheimnisse, der Schutz sitzt in der API.
2. Cookie zusätzlich mit `SameSite=None` setzen, nur damit das Dokument lädt —
   bringt die CSRF-Frage zurück und scheitert auf iPadOS.

Empfehlung: (1). Produktentscheidung, muss vor Umsetzung fallen.

## Teams-Manifest
- `staticTabs[0].contentUrl` = `https://<host>/teams.html?host=teams`
- `validDomains` = `["<host>"]`
- `webApplicationInfo` = `{ id: <MICROSOFT_CLIENT_ID>, resource: "api://<host>/<client-id>" }`
- Icons 192px color + 32px outline
- Voraussetzung im Tenant: Custom App Upload / Sideloading erlaubt

Framing-Header sind unkritisch: es gibt weder `X-Frame-Options` noch eine CSP im
Code. Vor dem Rollout gegen die Live-Instanz prüfen (Reverse Proxy):
`curl -sI https://<host>/ | grep -i -e x-frame -e content-security`.
Falls später eine CSP eingeführt wird, muss
`frame-ancestors teams.microsoft.com *.teams.microsoft.com *.skype.com` mit rein.

## Aufwand
| Block | Schätzung |
|---|---|
| Entra-Token-Validierung + Tests | 0,75 T |
| Exchange-Route + `complete-registration`-Erweiterung + Tests | 0,5 T |
| WS-Query-Token | 0,25 T |
| `teams.html` | 0,5 T |
| Frontend-Anpassungen (inkl. Bild-/WS-/Chat-Sonderfälle) | 0,75 T |
| Entra-Registrierung, Manifest, ZIP, Test im Tenant | 0,5 T |
| **Summe** | **~3,25 Tage** |

Gegenüber der ersten Schätzung fällt der Shared-Helper-Refactor weg (existiert
durch #118 bereits) und die CSRF-Middleware (Bearer statt `SameSite=None`).

## Risiken
- **iPadOS/Teams-Mobile:** ob der Tab dort als eingebetteter Frame oder als
  Top-Level-Dokument lädt, ist nicht aus dem Code ableitbar. Der Bearer-Weg ist
  in beiden Fällen tragfähig — muss aber auf einem echten Gerät verifiziert werden.
- **`getAuthToken()` liefert keine E-Mail**, wenn das Entra-Profil weder
  `preferred_username` noch `upn` trägt (selten, z. B. Gastkonten). Dann bleibt
  nur der reguläre Microsoft-Login im Popup. Fehlermeldung in `teams.html`
  entsprechend formulieren.
- **Nicht getestet ohne Tenant-Zugang:** Sideloading-Policy und die
  Vorautorisierung der Teams-Client-IDs sind Admin-Schritte.

## Nebenbefunde (nicht Teil dieser Arbeit)
- `jwtExpiresAfter` = 30 Tage (`backend/src/index.ts:34`) — lange Lebensdauer für
  ein Session-Token.
- Eigener HTML-Sanitizer (`frontend/src/utils/markdown.ts:58`) statt DOMPurify,
  kombiniert mit `v-html`.
