# The Wiki as a Microsoft Teams Tab

The app runs as a **personal tab** in Teams. The user signed in to Teams is
identified via Entra ID and exchanged for a normal wiki session without a second
login, under the same registration rules (invitation code, open organization
invitations) as the Microsoft login in the browser.

## How it works

```
Teams tab loads  /static/app/?host=teams       (served publicly)
   └─ teams-js: getAuthToken()                 → Entra ID token for this app
        └─ POST /api/v1/auth/teams/exchange    → token validated server-side
             ├─ account known / no gate        → session token in response body
             └─ gate active, address unknown   → pendingRegistrationToken
                  └─ POST …/complete-registration with invitation code → session
```

The session is sent as `Authorization: Bearer`, **not** as a cookie.
Reason: inside the Teams iframe every request is third-party, the `SameSite=Lax`
cookie is not sent, and on iPadOS a cross-site cookie is not an option anyway.
The token lives in memory only: after a reload the tab silently fetches a new
Entra token, so there is nothing to persist.

What is **not** trusted: `microsoftTeams.app.getContext()`. Its `userObjectId`
is client-supplied data. Authentication relies exclusively on verifying the
signature of the Entra token (`backend/src/lib/teams-sso`).

## Setup

### 1. Entra app registration

The same registration as for the Microsoft login in the browser. Additionally
required:

1. **Expose an API** → set the Application ID URI:
   `api://<host>/<MICROSOFT_CLIENT_ID>` (e.g. `api://wiki.example.com/1234…`)
2. Add a scope: `access_as_user`, consent "Admins and users".
3. Pre-authorize the Teams clients for this scope:
   | Client | Application ID |
   | --- | --- |
   | Teams Desktop/Mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
   | Teams Web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |
4. API permissions: `openid`, `profile`, `email`, `User.Read`.

The Teams path does not need a client secret; it is only required for the
browser login.

### 2. Server configuration

```env
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<only for the browser login>
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
```

`MICROSOFT_TENANT_ID` matters for a Teams rollout: without a GUID (i.e. with
`common`) every valid Entra token is accepted, and every Microsoft 365 user
worldwide at least reaches the invitation code prompt. With a GUID, only your
own directory gets through.

### 3. Teams app package

`docs/teams-app/` contains the complete package for `wiki.symbiosika.de`:
`manifest.json`, `color.png` (192×192) and `outline.png` (32×32, white on
transparent, as Teams requires for the outline icon).

```bash
docs/teams-app/pack.sh          # → docs/teams-app/symbiosika-wiki-teams.zip
```

Upload the ZIP in Teams via "Apps → Manage your apps → Upload an app".
Prerequisite: custom app upload / sideloading is allowed in the tenant (Teams
admin center).

The script first checks the manifest and then packs it flat (`zip -j`). It does
both because Teams is strict in two places, and in each case the error only
shows up at upload time:

- **Flat ZIP.** Manifest and icons directly in the root directory; a package
  with a subfolder is rejected with a generic message.
- **No unknown fields.** The schema sets `additionalProperties: false`.
  A single unexpected key leads to "Das App-Manifest aus Ihrem App-Paket konnte
  nicht analysiert werden" ("The app manifest from your app package could not
  be parsed"). `packageName`, for example, is **not** part of v1.17, even
  though it shows up in older examples.

The check in the script compares the top-level keys with the v1.17 property
list and makes sure the required fields are present. It is not a full
validator; for a complete check:

```bash
curl -sO https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json
pip install jsonschema && python3 -c "
import json, jsonschema
jsonschema.Draft7Validator(json.load(open('MicrosoftTeams.schema.json'))).validate(
    json.load(open('docs/teams-app/manifest.json')))
print('valid')"
```

**For a different instance**, replace:

| Field | Value |
| --- | --- |
| `id` | new GUID for the Teams app, **not** the client ID |
| `staticTabs[0].contentUrl` | `https://<host>/static/app/?host=teams` |
| `staticTabs[0].websiteUrl`, `validDomains` | your own host |
| `webApplicationInfo.id` | `MICROSOFT_CLIENT_ID` |
| `webApplicationInfo.resource` | `api://<host>/<MICROSOFT_CLIENT_ID>` |
| `developer.*`, `name`, `description`, `accentColor` | your own details |

**About `contentUrl`:** The direct path `/static/app/?host=teams` is the
shortest route. The bare domain (`https://<host>/?host=teams`) works too:
`public/index.html` detects the `host=teams` marker and redirects *before* it
checks the session cookie. Without this special handling the tab would end up
on `/login.html`, because no cookie ever arrives in the tab, and the marker
would be lost in the redirect.

## Why the SPA bundle is served publicly

`staticPrivateExclude: ["app"]` in `backend/src/index.ts` exempts `/static/app`
from the login redirect. Without it, the tab's document request, which carries
no cookie, would be redirected to `/login.html` before our own code could run.

Only the built frontend bundle is affected. It contains no secrets; all data
comes from the API, and every route there is still authenticated.

## Images in Teams mode

Wiki images are authenticated API paths, and an `<img src>` does send cookies
but never an `Authorization` header. In the tab, where the session is a bearer
token, they therefore all hit a 401 and the browser shows a broken image.

This is solved in three places, all via
`components/editor/authenticatedImageSrc.ts`:

| Where | How |
| --- | --- |
| Wiki content (TipTap) | NodeView in `wikiImage.ts`: fetches the bytes via the Fetcher and sets a blob URL. `node.attrs.src` stays the real path; otherwise a blob URL would end up in the page content on save |
| Rendered Markdown (chat, previews) | `MarkdownRenderer.vue` patches the `<img>` elements after every render; display only, nothing is written back |
| Logo, profile picture | `useAuthenticatedImage` |

Two rules apply: only app-relative paths are loaded with the token (otherwise
the token would leak to a foreign host), and outside Teams mode the URL stays
unchanged so the browser cache applies. The blob URLs are released when leaving
the wiki view.

## Known limitations

- **No logout in the tab.** The identity comes from the Teams host; signing out
  would immediately sign in again silently. The button is hidden in Teams mode.
- **No passkey login in the tab** (not needed either; sign-in goes through
  Teams).
- **Guest accounts without an email claim** cannot sign in via Teams: without
  `preferred_username`/`upn`/`email` no account can be matched. For these
  users the regular Microsoft login in the browser remains.
- **iPadOS/Teams mobile** is covered by the bearer approach but has not been
  verified on a device; check it once during rollout.
- **Framing headers:** the code sets neither `X-Frame-Options` nor a CSP. If a
  reverse proxy in front sets them,
  `frame-ancestors teams.microsoft.com *.teams.microsoft.com *.skype.com`
  must be allowed. Quick test:
  `curl -sI https://<host>/ | grep -i -e x-frame -e content-security`

## Troubleshooting

The error screen in the tab names the stage at which it broke and shows the
exact wording under "Technische Meldung" (technical message). The same message
appears in the console (`[teams] sign-in failed …`), reachable in Teams desktop
via right-click → "Inspect", and in Teams web via the browser's devtools.

**Most important distinction:** if **no**
`POST /api/v1/auth/teams/exchange` arrives in the server log, the error is
client-side: Teams did not issue a token, and the server was never involved.

### Teams does not issue a token (stage "no_token")

This is the most common case and always concerns the app registration. The
browser login keeps working in this case because it does **not** need these
settings; it gets by with client ID, secret and redirect URI. Check, in this
order:

1. **Application ID URI** set under "Expose an API" and **exactly** equal to
   `webApplicationInfo.resource` in the manifest:
   `api://wiki.symbiosika.de/<MICROSOFT_CLIENT_ID>`
2. **Scope `access_as_user`** present under "Expose an API", "Who can consent:
   Admins and users"
3. **Pre-authorized client applications** for this scope: both GUIDs
   (`1fec8e78-…` desktop/mobile, `5e3ce6c0-…` web). If this is missing, the
   host silently refuses the token.
4. **Delegated permissions** `openid` and `profile` granted
5. **Consent**: for "needs admin approval", run "Grant admin consent" once

Typical wordings: `resourceDisabled` or `invalid_resource` → item 1 or 3.
`consentRequired` / `invalid_grant` → item 5. `2000: …` /
`NOT_SUPPORTED_ON_PLATFORM` → the host does not support SSO in this context.

| Symptom | Cause |
| --- | --- |
| "Diese Seite läuft nicht in Microsoft Teams" ("This page is not running in Microsoft Teams") | `app.initialize()` found no Teams host; the URL was opened outside Teams |
| 401 on `/auth/teams/exchange` | Audience, tenant or scope do not match; the exact reason is in the server log (`Teams SSO exchange rejected: …`) |
| 503 on `/auth/teams/exchange` | `MICROSOFT_CLIENT_ID` is not set |
| Invitation code prompt appears unexpectedly | the instance has active invitation codes and the address is unknown; behavior identical to the browser login |
| Blank page, redirect to `/login.html` | `staticPrivateExclude: ["app"]` is missing from the server configuration |
