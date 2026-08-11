# Framework change — Bausteine für eingebettete Clients (Teams-Tab)

**Target repo:** `symbiosika/symbiosika-framework` (das `backend/framework`
Submodul). **Nicht** `symbiosika/wiki`.

> ## STATUS: gepusht, PR offen
>
> **PR:** https://github.com/symbiosika/symbiosika-framework/pull/120
> (`claude/teams-sso-support` → `develop`, Commits `61dc95b`, `54d343e`,
> `7b1debb`, Basis `cfae1a3`)
>
> Getestet: `bun run test:local ./framework/src/lib/utils/static-exclude.test.ts`
> → 27 pass, `… ./framework/src/lib/utils/ws-token-auth.test.ts` → 16 pass. Die
> Wiki-App nutzt die Bausteine end-to-end (siehe `docs/teams-app.md`).
>
> **Submodul-Pointer:** Der Wiki-Branch zeigt auf genau diesen Commit `7b1debb`,
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
> Den zeilengenauen Diff liefert der PR selbst; lokal:
> `git -C backend/framework diff cfae1a3..7b1debb`.

## Warum

Die App soll als Microsoft-Teams-Tab laufen. Teams lädt sie in einem iFrame unter
`teams.microsoft.com` — dadurch ist **jeder** Request Third-Party, das
`SameSite=Lax`-Session-Cookie wird nicht mitgesendet, und auf iPadOS ist ein
Cross-Site-Cookie ohnehin keine Option (kein CHIPS-Support). Ein eingebetteter
Client muss sich also per Bearer-Token authentisieren.

Das kann das Framework grundsätzlich schon: `checkToken` akzeptiert
`Authorization: Bearer` seit immer. Zwei Stellen konnten es aber nicht, weil dort
gar kein Header gesetzt werden kann — und die zweite davon zieht eine
Härtung nach sich, die unabhängig davon fällig war (Punkt 3):

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

### 3. Origin-Prüfung für WebSocket-Handshakes

`src/lib/utils/hono-middlewares.ts`

Ein Handshake unterliegt nicht der Same-Origin-Policy: jede fremde Seite kann
`new WebSocket("wss://unser-host/…")` aufrufen, und der Browser hängt die Cookies
an. Die CORS-Middleware greift dort nicht — sie regelt `fetch`/XHR, keine
Upgrades. Bisher hing die Abwehr dieses Angriffs (CSWSH) allein an
`SameSite=Lax`, also an einem Browser-Default. Jetzt wird sie explizit:

| `Origin` | Ergebnis |
| --- | --- |
| fehlt | erlaubt — nur Browser senden ihn; CLI-/Server-Clients sind nicht per Webseite austricksbar |
| gleicher Host wie der Request | erlaubt |
| in `allowedOrigins` bzw. gleich `baseUrl` | erlaubt |
| alles andere | abgelehnt, **bevor** ein Credential angesehen wird |

Verglichen wird der **Host**, nicht das ganze Origin: hinter einem
TLS-terminierenden Proxy kommt der Request als `http` an, während der Browser
`https` meldet — ein Schema-Vergleich würde jedes reale Deployment abweisen. Ein
Schema-Mismatch ist hier auch keine Gefahr, weil Mixed-Content-Regeln eine
`https`-Seite ohnehin daran hindern, ein `ws://` zu öffnen.

Ein `*` in `allowedOrigins` erfüllt die Prüfung **nicht**. Ein Wildcard ist eine
Aussage über öffentliche, CORS-geregelte Lesezugriffe — keine Zustimmung, dass
beliebige Seiten Sockets mit fremder Session öffnen. Regressionsrisiko: keins.
Ein Cross-Site-Handshake im Browser bekommt das Cookie sowieso nicht, und
Nicht-Browser-Clients senden kein `Origin`.

## Tests

| Datei | Inhalt |
| --- | --- |
| `src/lib/utils/static-exclude.test.ts` | +159 Zeilen: Matcher für den privaten Mount (Teilbaum, Segmentgrenzen, Aliase in beide Richtungen) und ein Integrationstest gegen honos echtes `serve-static`: geöffneter Teilbaum anonym 200, Rest 302 auf den Login, auch über `/static/app/../internal/secret.pdf`. 27 pass. |
| `src/lib/utils/ws-token-auth.test.ts` | neu, 16 pass. Query-Token: authentisiert einen Handshake, wird ohne Upgrade-Header abgelehnt, gefälschter Token abgelehnt, Upgrade-Header allein authentisiert nichts, Bearer funktioniert weiter, API-Token mit und ohne Upgrade weiter. Origin: same-origin erlaubt, fehlendes `Origin` erlaubt, fremde Site abgelehnt, konfiguriertes Origin und `baseUrl` erlaubt, `*` öffnet nichts, gleicher Host über https erlaubt (Proxy), Lookalike-Host (`localhost.evil.example.com`) abgelehnt, normaler Request bleibt CORS überlassen. |

## Kompatibilität

Ohne `staticPrivateExclude` verhält sich der private Mount unverändert, und ohne
`Upgrade`-Header verhält sich `?token=` unverändert.

Die Origin-Prüfung ist die einzige Verschärfung: sie lehnt WebSocket-Handshakes
mit fremdem `Origin` ab. Praktisch kann daran nur ein Setup hängen, das eine
Socket-Verbindung aus einem Browser auf einer *anderen* Domain aufbaut — das
funktioniert heute mit Cookie-Auth wegen `SameSite=Lax` schon nicht, und für
einen gewollt cross-origin betriebenen Client genügt der Eintrag in
`ALLOWED_ORIGINS`. Nicht-Browser-Clients sind nicht betroffen.

**Deployment-Hinweis:** Wenn ein Reverse Proxy den `Host`-Header umschreibt
*und* `BASE_URL` nicht auf den öffentlichen Host zeigt, schlagen Handshakes mit
401 fehl. Beides zeigt normalerweise auf denselben Host; im Zweifel den
öffentlichen Origin in `ALLOWED_ORIGINS` aufnehmen.
