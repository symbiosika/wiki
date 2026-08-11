# Das Wiki als Microsoft-Teams-Tab

Die App läuft als **Personal Tab** in Teams. Der in Teams angemeldete Nutzer wird
über Entra ID identifiziert und ohne zweiten Login in eine normale Wiki-Session
getauscht — mit denselben Registrierungsregeln (Einladungscode, offene
Organisations-Einladungen) wie der Microsoft-Login im Browser.

## Wie es funktioniert

```
Teams-Tab lädt  /static/app/?host=teams        (öffentlich ausgeliefert)
   └─ teams-js: getAuthToken()                 → Entra-ID-Token für diese App
        └─ POST /api/v1/auth/teams/exchange    → Token serverseitig validiert
             ├─ Konto bekannt / kein Gate      → Session-Token im Response-Body
             └─ Gate aktiv, Adresse unbekannt  → pendingRegistrationToken
                  └─ POST …/complete-registration mit Einladungscode → Session
```

Die Session wird als `Authorization: Bearer` mitgeschickt, **nicht** als Cookie.
Grund: im Teams-iFrame ist jeder Request Third-Party, das `SameSite=Lax`-Cookie
wird nicht mitgesendet, und auf iPadOS ist ein Cross-Site-Cookie ohnehin keine
Option. Das Token liegt ausschließlich im Speicher — nach einem Reload holt der
Tab still ein neues Entra-Token, es gibt also nichts zu persistieren.

Was **nicht** vertraut wird: `microsoftTeams.app.getContext()`. Dessen
`userObjectId` ist eine Client-Angabe. Authentisiert wird ausschließlich über die
Signaturprüfung des Entra-Tokens (`backend/src/lib/teams-sso`).

## Einrichtung

### 1. Entra-App-Registrierung

Dieselbe Registrierung wie für den Microsoft-Login im Browser. Zusätzlich nötig:

1. **Expose an API** → Application ID URI setzen:
   `api://<host>/<MICROSOFT_CLIENT_ID>` (z. B. `api://wiki.example.com/1234…`)
2. Scope hinzufügen: `access_as_user`, Consent „Admins and users".
3. Diesem Scope die Teams-Clients vorautorisieren:
   | Client | Application ID |
   | --- | --- |
   | Teams Desktop/Mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
   | Teams Web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |
4. API-Berechtigungen: `openid`, `profile`, `email`, `User.Read`.

Ein Client-Secret braucht der Teams-Pfad nicht — es bleibt nur für den
Browser-Login nötig.

### 2. Server-Konfiguration

```env
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<nur für den Browser-Login>
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
```

`MICROSOFT_TENANT_ID` ist bei einem Teams-Rollout wichtig: ohne GUID (also mit
`common`) wird jedes gültige Entra-Token akzeptiert, und jeder Microsoft-365-
Nutzer weltweit landet zumindest auf der Einladungscode-Abfrage. Mit GUID kommt
nur das eigene Verzeichnis durch.

### 3. Teams-App-Paket

Unter `docs/teams-app/` liegt das vollständige Paket für `wiki.symbiosika.de`:
`manifest.json`, `color.png` (192×192) und `outline.png` (32×32, weiß auf
transparent — so verlangt es Teams für das Outline-Icon).

```bash
docs/teams-app/pack.sh          # → docs/teams-app/symbiosika-wiki-teams.zip
```

Das ZIP in Teams unter „Apps → Manage your apps → Upload an app" hochladen.
Voraussetzung: Custom App Upload / Sideloading ist im Tenant erlaubt (Teams Admin
Center).

Das ZIP muss **flach** sein — Manifest und Icons direkt im Wurzelverzeichnis. Ein
Paket mit Unterordner wird beim Upload mit einer generischen Fehlermeldung
abgelehnt; genau dafür gibt es das Skript (`zip -j`).

**Für eine andere Instanz** zu ersetzen:

| Feld | Wert |
| --- | --- |
| `id` | neue GUID für die Teams-App — **nicht** die Client-ID |
| `staticTabs[0].contentUrl` | `https://<host>/static/app/?host=teams` |
| `staticTabs[0].websiteUrl`, `validDomains` | eigener Host |
| `webApplicationInfo.id` | `MICROSOFT_CLIENT_ID` |
| `webApplicationInfo.resource` | `api://<host>/<MICROSOFT_CLIENT_ID>` |
| `developer.*`, `name`, `description`, `accentColor` | eigene Angaben |

**Zur `contentUrl`:** Der direkte Pfad `/static/app/?host=teams` ist der
kürzeste Weg. Die bloße Domain (`https://<host>/?host=teams`) funktioniert auch —
`public/index.html` erkennt den `host=teams`-Marker und leitet weiter, *bevor* es
das Session-Cookie prüft. Ohne diese Sonderbehandlung würde der Tab auf
`/login.html` landen, weil im Tab nie ein Cookie ankommt, und der Marker ginge
beim Redirect verloren.

## Warum das SPA-Bundle öffentlich ausgeliefert wird

`staticPrivateExclude: ["app"]` in `backend/src/index.ts` nimmt `/static/app`
aus dem Login-Redirect heraus. Ohne das würde der Dokument-Request des Tabs —
der kein Cookie trägt — auf `/login.html` umgeleitet, bevor unser eigener Code
laufen kann.

Betroffen ist nur das gebaute Frontend-Bundle. Es enthält keine Geheimnisse; alle
Daten kommen aus der API, und dort ist jede Route weiterhin authentifiziert.

## Bekannte Einschränkungen

- **Kein Logout im Tab.** Die Identität kommt vom Teams-Host; ein Abmelden würde
  sofort still wieder anmelden. Der Button ist im Teams-Modus ausgeblendet.
- **Kein Passkey-Login im Tab** (wird auch nicht gebraucht — die Anmeldung läuft
  über Teams).
- **Gastkonten ohne E-Mail-Claim** können sich nicht über Teams anmelden: ohne
  `preferred_username`/`upn`/`email` lässt sich kein Konto zuordnen. Für diese
  Nutzer bleibt der reguläre Microsoft-Login im Browser.
- **iPadOS/Teams-Mobile** ist mit dem Bearer-Weg abgedeckt, wurde aber nicht auf
  einem Gerät verifiziert — beim Rollout einmal prüfen.
- **Framing-Header:** im Code gibt es weder `X-Frame-Options` noch eine CSP. Falls
  ein Reverse Proxy davor welche setzt, muss
  `frame-ancestors teams.microsoft.com *.teams.microsoft.com *.skype.com`
  erlaubt sein. Schnelltest:
  `curl -sI https://<host>/ | grep -i -e x-frame -e content-security`

## Fehlersuche

| Symptom | Ursache |
| --- | --- |
| „Anmeldung fehlgeschlagen" im Tab | `getAuthToken()` scheitert — meist fehlende Vorautorisierung der Teams-Clients oder falsche Application ID URI |
| 401 auf `/auth/teams/exchange` | Audience, Tenant oder Scope passen nicht; der genaue Grund steht im Server-Log (`Teams SSO exchange rejected: …`) |
| 503 auf `/auth/teams/exchange` | `MICROSOFT_CLIENT_ID` ist nicht gesetzt |
| Einladungscode-Abfrage erscheint unerwartet | die Instanz hat aktive Einladungscodes und die Adresse ist unbekannt — Verhalten identisch zum Browser-Login |
| Leere Seite, Redirect auf `/login.html` | `staticPrivateExclude: ["app"]` fehlt in der Server-Konfiguration |
