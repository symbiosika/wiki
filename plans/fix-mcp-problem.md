# Plan: MCP-Verbindung mit claude.ai reparieren (OAuth „auto"-Mode)

**Zielgruppe:** ein Agent, der diesen Fix umsetzt.
**Betroffen:** (1) das `symbiosika-framework` und (2) der **App-Teil** jedes
Projekts, das das Framework als OAuth2-Authorization-Server + einen eigenen
MCP-Resource-Server nutzt. Der App-Teil ist bewusst **generisch** beschrieben,
damit er auf mehrere Projekte übertragbar ist (das Problem besteht vermutlich
in allen Apps mit diesem Setup). Das Wiki-Projekt dient als konkretes,
durchgetestetes Beispiel.

> **Status dieser Analyse:** Der komplette Fix wurde in einer Wiki-Umgebung
> implementiert und end-to-end verifiziert (originalgetreue Simulation des
> claude.ai-Connector-Flows: DCR ohne `scope` → Authorize → Consent → Token
> mit `resource` → MCP initialize → `tools/call`). Die Diffs unten sind
> **wörtlich die getesteten Änderungen** — sie können als Referenz 1:1
> übernommen werden. Framework-OAuth-Smoke-Test: 16/16 grün.

---

## 1. Symptom

Beim Verbinden des MCP-Servers als Custom Connector in claude.ai:

> „Dein Konto wurde autorisiert, aber `<AppName>` hat beim Verbinden einen
> Fehler zurückgegeben. […] Referenz: `ofid_…`"

Der OAuth-Login/Consent scheint zu funktionieren, die Verbindung schlägt
danach fehl. `ofid_…`-Referenzen kann nur der Anthropic-Support zurückverfolgen
— serverseitige Logs sind die einzige eigene Diagnosequelle (und genau da
loggte bisher nichts, siehe Root Cause 3).

## 2. Root Cause (reproduziert)

claude.ai läuft im „auto"-Mode so ab (offizielle Doku:
<https://claude.com/docs/connectors/building/troubleshooting>):

1. `POST {mcp}/mcp` ohne Token → erwartet `401` + `WWW-Authenticate` mit
   `resource_metadata`-Pointer.
2. Discovery: Protected-Resource-Metadata (RFC 9728) — bei einem MCP-Endpoint
   mit Pfad (`…/mcp`) wird **zuerst**
   `/.well-known/oauth-protected-resource/mcp` probiert.
3. **Dynamic Client Registration** (RFC 7591) am `registration_endpoint` —
   claude.ai sendet dabei **kein `scope`-Feld**.
4. Authorize mit den in der Resource-Metadata beworbenen Scopes, **plus
   `resource=<kanonische MCP-URL inkl. Pfad>`** (RFC 8707).
5. Token-Exchange (PKCE S256, public client), **ebenfalls mit `resource=…`**.
6. `POST {mcp}/mcp` mit Bearer-Token (initialize, tools/list, …).

Dagegen standen drei Defekte:

**(a) `invalid_scope` für alle DCR-Clients — der Hauptfehler.**
`POST /oauth/register` im Framework legte Clients ohne `scope`-Feld mit
**leerer Scope-Allowlist** an. Der Authorize-Request von claude.ai auf z. B.
`knowledge:read knowledge:write` wurde damit immer mit `invalid_scope`
abgelehnt. Der „auto"-Mode konnte nie funktionieren.

**(b) RFC 8707 `resource` wurde ignoriert.**
Das Framework setzte die Token-Audience (`aud`) immer auf den Issuer. Der
MCP-Resource-Server akzeptierte `aud` nur bei **byte-genauer** Übereinstimmung
mit seiner `OAUTH_ISSUER`- bzw. `MCP_PUBLIC_URL`-Env — jede Abweichung
zwischen Backend-`BASE_URL` und MCP-`OAUTH_ISSUER` (www, Port, Slash, http[s])
führt nach erfolgreicher Autorisierung zu `401` am MCP-Endpoint → exakt die
gemeldete Fehlermeldung. Die MCP-Auth-Spec verlangt ohnehin die Bindung der
Audience an die Resource-URL.

**(c) Null Diagnostik.**
Authorize-Ablehnungen, Token-Fehler und Token-Rejections am Resource-Server
wurden nicht geloggt — diese Fehlerklasse war aus Logs nicht diagnostizierbar.

---

## 3. Teil A — Framework-Änderung (`symbiosika/symbiosika-framework`)

Drei Dateien + Doku. Vollständiger, getesteter Diff (Basis: upstream
`e553bcb`):

```diff
diff --git a/src/lib/oauth2/index.ts b/src/lib/oauth2/index.ts
--- a/src/lib/oauth2/index.ts
+++ b/src/lib/oauth2/index.ts
@@ -63,6 +63,41 @@ const isScopeAllowed = (scope: string, client: OAuthClientRow): boolean =>
   (OIDC_SCOPES as readonly string[]).includes(scope) ||
   (client.scopes as string[]).includes(scope);
 
+/** Scopes granted to RFC 7591 clients that register without `scope`. */
+const dcrDefaultScopes = (): string[] => {
+  const configured = oauthCfg().dcrDefaultScopes;
+  if (configured && configured.length > 0) {
+    return configured;
+  }
+  return [...OIDC_SCOPES, ...availableScopes.all];
+};
+
+/**
+ * RFC 8707 resource indicator: must be an absolute URI without a fragment.
+ * Returns the resource or undefined (absent), throws on a malformed value.
+ */
+const parseResourceParam = (value: unknown): string | undefined => {
+  if (typeof value !== "string" || value === "") {
+    return undefined;
+  }
+  let u: URL;
+  try {
+    u = new URL(value);
+  } catch {
+    throw new InvalidTargetError(value);
+  }
+  if (u.hash) {
+    throw new InvalidTargetError(value);
+  }
+  return value;
+};
+
+class InvalidTargetError extends Error {
+  constructor(resource: string) {
+    super(`Invalid resource indicator: ${resource}`);
+  }
+}
+
 const appendParams = (
   uri: string,
   params: Record<string, string | undefined | null>
@@ -176,7 +211,10 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
     }
 
     // From here redirect_uri is trusted → recoverable errors go via redirect.
-    const redirErr = (error: string) => {
+    const redirErr = (error: string, detail = "") => {
+      console.error(
+        `[oauth2] authorize rejected (client=${client.clientId}, error=${error})${detail ? ": " + detail : ""}`
+      );
       if (wantsJson(c)) return c.json({ step: "error", error }, 400);
       return c.redirect(appendParams(redirectUri, { error, state: q.state }));
     };
@@ -188,7 +226,10 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
 
     const requested = parseScopes(q.scope);
     if (requested.some((s) => !isScopeAllowed(s, client)))
-      return redirErr("invalid_scope");
+      return redirErr(
+        "invalid_scope",
+        `requested="${q.scope ?? ""}" allowed="${(client.scopes as string[]).join(" ")}"`
+      );
 
     const userId = await currentUserId(c);
     if (!userId) {
@@ -208,7 +249,7 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
     } else if (memberships.length === 1) {
       tenantId = memberships[0]!.id;
     } else if (memberships.length === 0) {
-      return redirErr("access_denied");
+      return redirErr("access_denied", `user ${userId} has no tenant membership`);
     } else {
       if (wantsJson(c))
         return c.json({ step: "tenant", tenants: memberships });
@@ -370,6 +411,10 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
     const grantType = body.grant_type;
 
     try {
+      // RFC 8707: bind the access token's audience to the requested resource
+      // (MCP clients like claude.ai send their MCP server URL here).
+      const resource = parseResourceParam(body.resource);
+
       if (grantType === "authorization_code") {
         const payload = await consumeAuthCode(
           body.code ?? "",
@@ -392,6 +437,7 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
             tenantId: payload.tenantId,
             scopes: payload.scopes,
             nonce: payload.nonce,
+            resource,
           })
         );
       }
@@ -409,6 +455,7 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
             scopes: rotated.scopes,
             nonce: null,
             existingRefreshToken: rotated.refreshToken,
+            resource,
           })
         );
       }
@@ -416,7 +463,11 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
       return c.json({ error: "unsupported_grant_type" }, 400);
     } catch (err) {
       const message = err instanceof Error ? err.message : String(err);
-      return c.json({ error: "invalid_grant", error_description: message }, 400);
+      const error = err instanceof InvalidTargetError ? "invalid_target" : "invalid_grant";
+      console.error(
+        `[oauth2] token request failed (client=${clientId ?? "?"}, grant=${grantType ?? "?"}): ${message}`
+      );
+      return c.json({ error, error_description: message }, 400);
     }
   });
 
@@ -451,11 +502,17 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
       );
     }
     try {
+      // RFC 7591: `scope` is optional — fall back to the default scope set so
+      // dynamically registered clients can actually request the scopes the
+      // resource server advertises.
+      const requestedScopes = parseScopes(body.scope);
+      const scopes =
+        requestedScopes.length > 0 ? requestedScopes : dcrDefaultScopes();
       const result = await createOAuthClient({
         tenantId: null,
         clientName: body.client_name || "Dynamic Client",
         redirectUris: body.redirect_uris,
-        scopes: body.scope ? body.scope.split(/\s+/).filter(Boolean) : [],
+        scopes,
         clientType: "public",
         clientId: body.client_id || undefined,
       });
@@ -468,7 +525,7 @@ export function defineOAuth2Routes(app: App, API_BASE_PATH: string) {
           grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
           response_types: body.response_types ?? ["code"],
           token_endpoint_auth_method: "none",
-          scope: body.scope ?? "",
+          scope: scopes.join(" "),
           client_id_issued_at: Math.floor(Date.now() / 1000),
           registration_client_uri: `${issuer}/oauth/register/${result.clientId}`,
         },
@@ -618,6 +675,8 @@ const buildTokenResponse = async (args: {
   scopes: string[];
   nonce: string | null;
   existingRefreshToken?: string;
+  /** RFC 8707 resource indicator — becomes the access token audience. */
+  resource?: string;
 }) => {
   const user = await loadOidcUser(args.userId);
   const { token: accessToken, expiresIn } = generateAccessToken({
@@ -626,6 +685,7 @@ const buildTokenResponse = async (args: {
     tenantId: args.tenantId,
     clientId: args.clientId,
     scopes: args.scopes,
+    resource: args.resource,
   });
 
   const refreshToken =
diff --git a/src/store/index.ts b/src/store/index.ts
--- a/src/store/index.ts
+++ b/src/store/index.ts
@@ -61,6 +61,7 @@ export const _GLOBAL_SERVER_CONFIG = {
     emailLoginCodeTtl: 60 * 10, // 10 minutes
     emailLoginCodeMaxAttempts: 5,
     introspectionSecret: "",
+    dcrDefaultScopes: [] as string[], // empty = all supported scopes
     views: defaultOAuthViews,
   },
 };
@@ -173,6 +174,7 @@ export const setGlobalServerConfig = (config: ServerSpecificConfig) => {
     emailLoginCodeTtl: o.emailLoginCodeTtl ?? 60 * 10,
     emailLoginCodeMaxAttempts: o.emailLoginCodeMaxAttempts ?? 5,
     introspectionSecret: o.introspectionSecret ?? "",
+    dcrDefaultScopes: o.dcrDefaultScopes ?? [],
     views: { ...defaultOAuthViews, ...(o.views ?? {}) },
   };
 };
diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -86,6 +86,12 @@ export interface ServerSpecificConfig {
     emailLoginCodeMaxAttempts?: number; // default 5
     // Shared secret for RFC 7662 token introspection (resource servers send this as Bearer).
     introspectionSecret?: string;
+    // Scopes assigned to dynamically registered clients (RFC 7591) that omit
+    // `scope` in their registration request. Empty/unset = all supported
+    // scopes. MCP clients like claude.ai register without `scope` and then
+    // request the scopes advertised by the resource server, so an empty
+    // client allow-list would fail every authorize request with invalid_scope.
+    dcrDefaultScopes?: string[];
     // Override the default login/consent/tenant-select HTML (like emailTemplates).
     views?: Partial<import("./lib/oauth2/views").OAuthViews>;
   };
```

Zusätzlich Doku aktualisieren (`docs/framework/16_OAuth2_OIDC_Provider.md`):

- Die Aussage „**kein** Dynamic Client Registration" ist veraltet — DCR
  existiert (`POST /oauth/register`, immer `public`+PKCE). Ergänzen: „DCR ohne
  `scope` erhält die `dcrDefaultScopes` (leer = alle unterstützten Scopes)."
- Beim Token-Endpoint ergänzen: „Ein `resource`-Parameter (RFC 8707, von
  MCP-Clients gesendet) wird zur **Token-Audience** (`aud`); ohne ihn bleibt
  `aud` = Issuer. Ungültige Werte → `invalid_target`."

**Verifikation im Framework:** `bun run framework/.scripts/oauth-flow.ts`
(aus dem Backend-Verzeichnis einer konsumierenden App) — muss 16/16 bestehen.

---

## 4. Teil B — App-Teil (generisch, pro Projekt anwendbar)

Gilt für **jede App**, die das Framework als Authorization Server nutzt und
einen eigenen MCP-Resource-Server hat. Drei Schritte:

### B1. `defineServer()`: DCR-Default-Scopes eng setzen

Ohne Konfiguration erhalten anonyme DCR-Clients **alle** Framework-Scopes
(inkl. `payment:*`, `secrets:*`, …) als anfragbar. Pro Projekt die Liste auf
das beschränken, was der MCP-Server des Projekts wirklich braucht — sie muss
**mindestens die `scopes_supported` der Resource-Metadata des MCP-Servers
abdecken** (sonst wieder `invalid_scope`), plus die OIDC-Scopes:

```ts
// backend/src/index.ts (Beispiel Wiki — Scope-Liste pro Projekt anpassen!)
oauth2: {
  enabled: true,
  introspectionSecret: process.env.OAUTH_INTROSPECTION_SECRET,
  // Scopes für dynamisch registrierte Clients (RFC 7591) ohne `scope`-Feld.
  // Eng halten: nur Identity- + projektrelevante Scopes.
  dcrDefaultScopes: [
    "openid",
    "profile",
    "email",
    "knowledge:read",
    "knowledge:write",
    "knowledge-manage:read",
    "knowledge-manage:write",
    "user:read",
  ],
},
```

### B2. MCP-Resource-Server: Metadata, Audience-Check, Logging

Annahmen (Wiki-Layout, bei anderen Projekten Namen/Pfade anpassen):
`config.ts` mit `PUBLIC_URL` (Origin des MCP-Servers), `ISSUER`
(Backend-URL), `PRM_PATH = "/.well-known/oauth-protected-resource"`, MCP-
Endpoint unter `/mcp`; `auth.ts` validiert Tokens per `/oauth/introspect`.

**(1) Kanonische Resource-URL definieren** (`config.ts`):

```ts
/**
 * Canonical resource identifier of the MCP endpoint (RFC 8707 / RFC 9728).
 * Clients like claude.ai send exactly this URL as the `resource` parameter and
 * expect it back in the protected-resource metadata.
 */
export const MCP_RESOURCE = `${PUBLIC_URL}/mcp`;
```

**(2) Resource-Metadata unter beiden Pfaden ausliefern und `resource` auf die
volle MCP-URL setzen** (`index.ts`) — claude.ai probiert bei einem Endpoint
mit Pfad **zuerst** die pfad-suffigierte Variante:

```ts
// Resource metadata (RFC 9728): served at the root path and at the
// path-suffixed variant (`…/oauth-protected-resource/mcp`) that clients
// derive for a resource with a path component, e.g. claude.ai.
const resourceMetadata = (c: any) =>
  c.json({
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
  });
app.get(PRM_PATH, resourceMetadata);
app.get(`${PRM_PATH}/mcp`, resourceMetadata);
```

**(3) `WWW-Authenticate`-Pointer auf die pfad-suffigierte Metadata zeigen
lassen** (`auth.ts`, in `unauthorized`):

```ts
c.header(
  "WWW-Authenticate",
  `Bearer resource_metadata="${PUBLIC_URL}${PRM_PATH}/mcp"`,
);
```

**(4) Audience-Check kanonisch + tolerant gegenüber allen legitimen
Audiences, und jede Ablehnung mit Grund loggen** (`auth.ts`). Vollständige,
getestete Fassung der Validierung:

```ts
/**
 * Canonicalize a URL for audience comparison (RFC 8707): lowercase scheme and
 * host, drop default ports and trailing slashes. Falls back to plain
 * trailing-slash stripping for non-URL values.
 */
const canonical = (u: string): string => {
  try {
    const url = new URL(u ?? "");
    const port =
      url.port &&
      !(
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      )
        ? `:${url.port}`
        : "";
    const path = url.pathname.replace(/\/$/, "");
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return (u ?? "").replace(/\/$/, "");
  }
};

const deny = (reason: string): null => {
  console.warn(`[<projekt>-mcp] token rejected: ${reason}`);
  return null;
};
```

In `authenticate()` alle stillen `return null` durch `deny("<grund>")`
ersetzen:

- Introspection-Fetch wirft → `deny("introspection at ${ISSUER}/oauth/introspect unreachable: …")`
- `!res.ok` → `deny("introspection returned HTTP ${res.status} (check OAUTH_INTROSPECTION_SECRET)")`
- ungültiges JSON → `deny("introspection returned invalid JSON")`
- `!data.active` → `deny("token inactive (expired, revoked or unknown)")`

und den Audience-Check ersetzen durch:

```ts
// Audience: the token must target THIS server. Accepted values: the MCP
// endpoint URL (RFC 8707 resource), the server origin, or the issuer itself
// (legacy tokens minted without a resource indicator).
const accepted = [MCP_RESOURCE, PUBLIC_URL, ISSUER].map(canonical);
const audList = (Array.isArray(data.aud) ? data.aud : [data.aud]).map(canonical);
if (!audList.some((a: string) => accepted.includes(a))) {
  return deny(
    `audience mismatch: token aud=${JSON.stringify(data.aud)}, accepted=${JSON.stringify([MCP_RESOURCE, PUBLIC_URL, ISSUER])}`,
  );
}
```

### B3. Env-Checkliste (Produktion, pro Projekt)

- `MCP_PUBLIC_URL` = öffentliche Origin des MCP-Servers, **ohne** `/mcp`,
  ohne Trailing-Slash, https.
- `OAUTH_ISSUER` (MCP-Server) muss der öffentlichen `BASE_URL` des Backends
  entsprechen (nach dem Fix toleriert der Audience-Check kanonische
  Abweichungen, aber die **Introspection-URL** wird daraus gebaut — sie muss
  vom MCP-Container aus erreichbar sein!).
- `OAUTH_INTROSPECTION_SECRET` auf Backend- und MCP-Seite **identisch**.
- Kein Redirect (301/302, z. B. apex→www) vor dem MCP-Endpoint — dabei
  verwirft der HTTP-Client den `Authorization`-Header (siehe Anthropic-Doku).

---

## 5. Verifikation (pro Projekt ausführen)

### 5.1 Framework-Smoke-Test

```bash
cd backend && bun run framework/.scripts/oauth-flow.ts   # muss 16/16 bestehen
```

### 5.2 Simulierter claude.ai-Flow (end-to-end)

Das folgende Skript stellt den Connector-Flow von claude.ai **originalgetreu**
nach (DCR **ohne** `scope`, `resource`-Parameter bei Authorize + Token, MCP
initialize/tools). Backend + MCP-Server lokal starten, einen Test-User mit
Tenant-Mitgliedschaft einloggen (Session-JWT), dann:

```bash
bun claude-flow.ts <session-jwt>
```

```ts
// claude-flow.ts — Simulation des claude.ai-MCP-Connector-Flows.
// URLs bei Bedarf anpassen (MCP = MCP-Server, AS = Backend).
const MCP = "http://localhost:8787";
const AS = "http://localhost:3000";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

const jwt = process.argv[2];
if (!jwt) throw new Error("usage: bun claude-flow.ts <session-jwt>");

const log = (label: string, x: unknown) =>
  console.log(`\n── ${label} ──\n` + (typeof x === "string" ? x : JSON.stringify(x, null, 2)));

// 1) Unauthentifizierter Probe-Request → 401 + WWW-Authenticate
let res = await fetch(`${MCP}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1.0" } } }),
});
log("1. POST /mcp (no token)", `${res.status} · WWW-Authenticate: ${res.headers.get("www-authenticate")}`);

// 2) PRM-Discovery — claude.ai probiert die pfad-suffigierte Variante zuerst
for (const p of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
  res = await fetch(`${MCP}${p}`);
  log(`2. GET ${p}`, `${res.status} ${res.status === 200 ? await res.text() : ""}`);
}
const prm = await (await fetch(`${MCP}/.well-known/oauth-protected-resource`)).json();

// 3) AS-Metadata
const asMeta = await (await fetch(`${AS}/.well-known/oauth-authorization-server`)).json();
log("3. AS metadata", { issuer: asMeta.issuer, reg: asMeta.registration_endpoint });

// 4) DCR — claude.ai-Payload: KEIN scope-Feld!
res = await fetch(asMeta.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
});
const reg = await res.json();
log("4. DCR /oauth/register", { status: res.status, client_id: reg.client_id, scope: reg.scope });
const clientId = reg.client_id;
if (res.status !== 201) process.exit(1);

// 5) Authorize — Scopes aus der PRM + resource=<MCP-Endpoint> (RFC 8707)
const verifier = crypto.randomUUID() + crypto.randomUUID();
const challenge = Buffer.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
).toString("base64url");
const scope = (prm.scopes_supported ?? []).join(" ");
const authUrl = new URL(`${AS}/oauth/authorize`);
authUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: CALLBACK,
  scope,
  state: "st_test",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: `${MCP}/mcp`,
}).toString();

res = await fetch(authUrl, { headers: { cookie: `jwt=${jwt}`, accept: "text/html" }, redirect: "manual" });
const body = await res.text();
log("5. GET /oauth/authorize", `${res.status} · location=${res.headers.get("location") ?? "-"}`);

let code: string | null = null;
const loc = res.headers.get("location");
if (loc?.includes("code=")) {
  code = new URL(loc).searchParams.get("code");
} else if (res.status === 200) {
  // Consent-Screen kam zurück → wie das Browser-Formular approven
  const consentRes = await fetch(`${AS}/oauth/consent`, {
    method: "POST",
    headers: { cookie: `jwt=${jwt}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ authorize_query: authUrl.search.slice(1), decision: "approve" }).toString(),
  });
  const cj = await consentRes.json();
  log("5b. POST /oauth/consent", { status: consentRes.status, ...cj });
  if (cj.redirect) code = new URL(cj.redirect).searchParams.get("code");
}
log("5c. authorization code", code ? "OK" : "NONE — Flow scheitert VOR dem Callback");
if (!code) process.exit(1);

// 6) Token-Exchange — public client, form-encoded, mit resource
res = await fetch(asMeta.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    client_id: clientId,
    code_verifier: verifier,
    resource: `${MCP}/mcp`,
  }).toString(),
});
const tok = await res.json();
log("6. POST /oauth/token", { status: res.status, scope: tok.scope, has_access: !!tok.access_token });
if (!tok.access_token) process.exit(1);
const payload = JSON.parse(Buffer.from(tok.access_token.split(".")[1], "base64url").toString());
log("6b. access-token claims", { aud: payload.aud, scope: payload.scope, tenant: payload.tenant });

// 7) MCP initialize + tools/call mit dem Token
for (const [id, method, params] of [
  [1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1.0" } }],
  [2, "tools/list", undefined],
  [3, "tools/call", { name: "whoami", arguments: {} }],
] as const) {
  res = await fetch(`${MCP}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tok.access_token}`,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  log(`7. POST /mcp ${method}`, `${res.status} · ${(await res.text()).slice(0, 200)}`);
}
```

**Erwartung nach dem Fix** (im Wiki-Projekt so verifiziert):

- Schritt 2: beide PRM-Pfade `200`, `resource` = `…/mcp`.
- Schritt 4: `201`, `scope` = die `dcrDefaultScopes` der App.
- Schritt 5: Consent-Screen → Code (kein `error=invalid_scope`-Redirect!).
- Schritt 6b: `aud` = `…/mcp` (nicht mehr der Issuer), `scope` = PRM-Scopes.
- Schritt 7: initialize `200`, `tools/list` `200`, `tools/call whoami` `200`
  mit korrektem User + Tenant.

Hinweis Test-Setup: der Test-User braucht **mindestens eine
Tenant-Mitgliedschaft**, sonst bricht Authorize korrekt mit `access_denied`
ab (wird jetzt geloggt).

---

## 6. Rollout & Betrieb

1. **Reihenfolge:** erst Framework-Änderung mergen/veröffentlichen, dann in
   jeder App das Framework-Submodul bumpen + Teil B umsetzen, deployen.
2. **Bestehende kaputte DCR-Clients:** Der Fix greift nur bei *neuen*
   Registrierungen. Bereits registrierte claude.ai-Clients haben leere
   Scope-Listen in `base_oauth_clients`. Nach dem Deploy den Connector in
   claude.ai **entfernen und neu verbinden** — oder die Scopes des
   bestehenden Client-Eintrags nachtragen (UI „Verwalten → OAuth-Apps" bzw.
   `PATCH /api/v1/tenant/:tenantId/oauth/clients/:id`).
3. **Diagnose bei erneutem Fehler:** MCP-Server-Logs zeigen jetzt den
   konkreten Ablehnungsgrund (`introspection unreachable` /
   `HTTP 401 … check OAUTH_INTROSPECTION_SECRET` / `token inactive` /
   `audience mismatch`), Backend-Logs jede Authorize-/Token-Ablehnung inkl.
   angefragter vs. erlaubter Scopes. `ofid_…`-Referenzen kann nur
   Anthropic-Support auflösen — bei Bedarf Issue mit Server-Logs unter
   <https://github.com/anthropics/claude-ai-mcp/issues> aufmachen.

## 7. Abnahme-Checkliste

- [ ] Framework: `oauth-flow.ts`-Smoke-Test 16/16.
- [ ] Framework: DCR ohne `scope` → Client hat `dcrDefaultScopes`; Response
      echot die tatsächlichen Scopes.
- [ ] Framework: Token-Request mit `resource` → JWT-`aud` = resource; mit
      kaputtem `resource` (`"::"` o. ä.) → `400 invalid_target`.
- [ ] App: Simulations-Skript (5.2) läuft komplett grün.
- [ ] App: `GET {mcp}/.well-known/oauth-protected-resource/mcp` → `200`,
      `resource` endet auf `/mcp`.
- [ ] App: Token-Rejections und Authorize-Fehler erscheinen mit Grund im Log.
- [ ] Prod: Connector in claude.ai neu verbunden, Tools nutzbar.
