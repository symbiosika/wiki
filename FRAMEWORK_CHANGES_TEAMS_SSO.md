# Framework change — Bausteine für eingebettete Clients (Teams-Tab)

**Target repo:** `symbiosika/symbiosika-framework` (das `backend/framework`
Submodul). **Nicht** `symbiosika/wiki`.

> ## STATUS: implementiert + lokal getestet in dieser Umgebung
>
> Die Änderung ist **im lokalen `backend/framework`-Submodul committet**, auf
> Branch `claude/teams-sso-support` (lokaler Commit `61dc95b`, Basis
> `cfae1a3`), und getestet:
> `bun run test:local ./framework/src/lib/utils/static-exclude.test.ts` → 27 pass,
> `… ./framework/src/lib/utils/ws-token-auth.test.ts` → 5 pass.
> Die Wiki-App nutzt sie end-to-end (siehe `docs/teams-app.md`).
>
> **Zeilengenauer Export:** `framework-teams-sso.patch` im Wiki-Repo-Root ist ein
> `git diff cfae1a3..61dc95b`. In einem sauberen Framework-Checkout anwenden mit
> `git apply framework-teams-sso.patch`, prüfen, committen, pushen.
>
> **⚠️ Submodul-Pointer:** Ich kann nicht ins Framework-Repo pushen (Session-Scope
> ist nur `symbiosika/wiki`), der Commit `61dc95b` ist also **nur lokal**. Der
> Wiki-Submodul-Pointer zeigt derzeit darauf. Nach dem Landen upstream:
> ```bash
> cd backend/framework && git fetch origin && git checkout <upstream-sha>
> cd ../.. && git add backend/framework && git commit -m "chore: bump framework to Teams-SSO building blocks"
> ```
> (Oder `61dc95b` unverändert pushen — dann ist kein Re-Point nötig.)
>
> **Bis dahin ist der Wiki-Branch nicht baubar in einem frischen Checkout**, weil
> der Submodul-Commit fehlt. Das ist derselbe Ablauf wie bei
> `FRAMEWORK_CHANGES_PHASE3.md`.

## Warum

Die App soll als Microsoft-Teams-Tab laufen. Teams lädt sie in einem iFrame unter
`teams.microsoft.com` — dadurch ist **jeder** Request Third-Party, das
`SameSite=Lax`-Session-Cookie wird nicht mitgesendet, und auf iPadOS ist ein
Cross-Site-Cookie ohnehin keine Option (kein CHIPS-Support). Ein eingebetteter
Client muss sich also per Bearer-Token authentisieren.

Das kann das Framework grundsätzlich schon: `checkToken` akzeptiert
`Authorization: Bearer` seit immer. Zwei Stellen konnten es aber nicht, weil dort
gar kein Header gesetzt werden kann:

1. **Der Dokument-Request der SPA.** Ein Browser, der `/static/app/index.html`
   navigiert, sendet Cookies — aber keine Header, die wir kontrollieren. Ohne
   Cookie greift `authOrRedirectToLogin` und der Tab landet auf `/login.html`,
   bevor eigener Code laufen kann. Es gibt keine Möglichkeit, das aus der App
   heraus zu lösen: der Mount liegt im Framework, App-Routen liegen unter
   `basePath`.
2. **WebSocket-Handshakes.** `new WebSocket(url)` nimmt ausschließlich eine URL.
   Presence/Lock beim Wiki-Editieren und die Realtime-Transkription hängen daran.

## Was sich ändert

### 1. `staticPrivateExclude` (neue `defineServer`-Option)

`src/types.ts`, `src/index.ts`, `src/lib/utils/static-exclude.ts`

Teilbäume des privaten Static-Mounts, die ohne Login-Redirect ausgeliefert
werden:

```ts
defineServer({
  staticPrivateDataPath: "./static",
  staticPrivateExclude: ["app"], // /static/app ist ohne Session erreichbar
});
```

Umsetzung als Spiegel des vorhandenen `staticPublicExclude`: derselbe Matcher,
nur mit dem Prefix `/static` statt `/public`. `resolveSegments` bekommt die
Strip-Funktion als Parameter, `isExcludedFromPrivateStatic` kommt dazu. Damit
gelten dieselben Alias-Regeln (Percent-Escapes, Dot-Segmente,
Prefix-ohne-Segmentgrenze) — wichtig, weil sonst eine geschützte Datei über einen
Alias in den geöffneten Teilbaum „hineinzeigen" könnte.

Im Mount entscheidet die Prüfung nur, **ob die Auth-Middleware läuft**; der
Static-Handler dahinter ist in beiden Fällen derselbe:

```ts
app.use("/static/*", async (c, next) => {
  if (isExcludedFromPrivateStatic(c.req.path, staticPrivateExclusions)) return next();
  return authOrRedirectToLogin(c, next);
}, serveStatic({ … }));
```

Default ist unverändert: ohne Konfiguration bleibt der komplette Mount hinter dem
Login.

### 2. Session-Token via `?token=` für WebSocket-Handshakes

`src/lib/utils/hono-middlewares.ts`

`checkToken` behandelt `?token=` bisher immer als Service-Token
(`generateTemporaryJwtFromToken`). Neu: liegt ein `Upgrade: websocket`-Header vor,
wird der Wert als Session-JWT verwendet.

Die Einschränkung ist der Punkt: `Upgrade` ist ein *forbidden header name* — aus
Seiten-JavaScript nicht setzbar, nur der WebSocket-Konstruktor erzeugt ihn. Ein
normaler API-Call kann sich also nicht als Handshake ausgeben, und überall sonst
behält der Parameter seine bisherige Bedeutung. Ohne diese Grenze hätte man einen
generellen „Session-Token in der URL"-Modus — und URLs landen in Proxy-Logs,
Browser-History und Referrern.

## Tests

| Datei | Inhalt |
| --- | --- |
| `src/lib/utils/static-exclude.test.ts` | +159 Zeilen: Matcher für den privaten Mount (Teilbaum, Segmentgrenzen, Aliase in beide Richtungen) und ein Integrationstest gegen honos echtes `serve-static`: geöffneter Teilbaum anonym 200, Rest 302 auf den Login, auch über `/static/app/../internal/secret.pdf`. 27 pass. |
| `src/lib/utils/ws-token-auth.test.ts` | neu: Session-Token im Query authentisiert einen Handshake; derselbe Token ohne Upgrade-Header wird abgelehnt; gefälschter Token abgelehnt; Upgrade-Header allein authentisiert nichts; Bearer funktioniert weiter. 5 pass. |

## Kompatibilität

Rein additiv. Ohne `staticPrivateExclude` verhält sich der private Mount
unverändert, und ohne `Upgrade`-Header verhält sich `?token=` unverändert. Keine
Migration, keine Änderung an bestehenden Aufrufern.
