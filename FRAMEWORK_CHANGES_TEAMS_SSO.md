# Framework change — Bausteine für eingebettete Clients (Teams-Tab)

**Target repo:** `symbiosika/symbiosika-framework` (das `backend/framework`
Submodul). **Nicht** `symbiosika/wiki`.

> ## STATUS: gepusht, PR offen
>
> **PR:** https://github.com/symbiosika/symbiosika-framework/pull/120
> (`claude/teams-sso-support` → `develop`, Commits `61dc95b` + `54d343e`,
> Basis `cfae1a3`)
>
> Getestet: `bun run test:local ./framework/src/lib/utils/static-exclude.test.ts`
> → 27 pass, `… ./framework/src/lib/utils/ws-token-auth.test.ts` → 5 pass. Die
> Wiki-App nutzt die Bausteine end-to-end (siehe `docs/teams-app.md`).
>
> **Submodul-Pointer:** Der Wiki-Branch zeigt auf genau diesen Commit `54d343e`,
> gepusht wurde er unverändert aus dem Submodul heraus. Solange der PR auf dem
> Branch liegt, ist der Wiki-Branch also baubar — kein Re-Point nötig.
>
> ⚠️ Wird der PR **gesquasht** gemergt, entsteht upstream eine andere SHA. Dann
> zeigt der Submodul-Pointer auf einen Commit, der nur noch auf dem
> Feature-Branch existiert. Nach dem Merge deshalb:
> ```bash
> cd backend/framework && git fetch origin && git checkout <merge-sha>
> cd ../.. && git add backend/framework && git commit -m "chore: bump framework to Teams-SSO building blocks"
> ```
>
> Der Patch `framework-teams-sso.patch` im Wiki-Repo-Root bleibt als
> zeilengenauer Diff (`git diff cfae1a3..54d343e`) zum Nachlesen liegen.

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

Zwei Einschränkungen. Erstens `Upgrade`: ein *forbidden header name* — aus
Seiten-JavaScript nicht setzbar, nur der WebSocket-Konstruktor erzeugt ihn. Ein
normaler API-Call kann sich also nicht als Handshake ausgeben, und überall sonst
behält der Parameter seine bisherige Bedeutung. Ohne diese Grenze hätte man einen
generellen „Session-Token in der URL"-Modus — und URLs landen in Proxy-Logs,
Browser-History und Referrern.

Zweitens die Form des Werts: nur etwas mit JWT-Gestalt (drei Segmente) nimmt den
neuen Zweig. Ein API-Token ist ein `nanoid` ohne Punkt und wird weiter über
`generateTemporaryJwtFromToken` gegen die Datenbank aufgelöst — auch am
WebSocket, wo das ein bestehender Pfad ist.

## Tests

| Datei | Inhalt |
| --- | --- |
| `src/lib/utils/static-exclude.test.ts` | +159 Zeilen: Matcher für den privaten Mount (Teilbaum, Segmentgrenzen, Aliase in beide Richtungen) und ein Integrationstest gegen honos echtes `serve-static`: geöffneter Teilbaum anonym 200, Rest 302 auf den Login, auch über `/static/app/../internal/secret.pdf`. 27 pass. |
| `src/lib/utils/ws-token-auth.test.ts` | neu: Session-Token im Query authentisiert einen Handshake; derselbe Token ohne Upgrade-Header wird abgelehnt; gefälschter Token abgelehnt; Upgrade-Header allein authentisiert nichts; Bearer funktioniert weiter; API-Token im Query funktioniert mit und ohne Upgrade weiter. 7 pass. |

## Kompatibilität

Rein additiv. Ohne `staticPrivateExclude` verhält sich der private Mount
unverändert, und ohne `Upgrade`-Header verhält sich `?token=` unverändert. Keine
Migration, keine Änderung an bestehenden Aufrufern.
