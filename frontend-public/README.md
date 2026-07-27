# frontend-public — öffentliche Doku-Seite

Read-only Zweitansicht des Wikis für veröffentlichte Seiten. Kein Login, kein
Editor, keine Schreibpfade — eine Doku-Seite, keine zweite App-Oberfläche.

## Warum eine eigene App

Das Haupt-Frontend wird unter `/static/app/` ausgeliefert, und `/static/*` läuft
im Backend durch `authOrRedirectToLogin`. Alles dort ist per Definition hinter
dem Login. Diese App baut deshalb nach `dist/public/docs/` und landet in
`backend/public/`, das ohne Authentifizierung ausgeliefert wird — der einzige
Unterschied im Ausliefern, aber ein grundlegender.

Entsprechend schlank ist der Stack: Vue 3, Vue Router, Tailwind, `marked`.
Kein TipTap, kein PrimeVue, kein Pinia, kein i18n.

## Sichtbarkeit

Die App entscheidet **nichts** über Sichtbarkeit. Sie ruft ausschließlich
`/api/v1/public/wiki/:tenantId/…` auf; das Backend liefert dort nur Seiten aus,
die über `knowledgeText.publicMode` freigegeben wurden (Vererbung an
Unterseiten, `"excluded"` als Notausgang). Ein 404 heißt „nicht veröffentlicht
oder nicht vorhanden" — das Backend unterscheidet die beiden Fälle bewusst
nicht, und diese App tut es folglich auch nicht.

## Routing

Hash-Routen (`#/<tenantId>/page/<pageId>`), wie im Haupt-Frontend. Grund:
Die Bundles werden als statische Dateien ohne SPA-Fallback ausgeliefert, ein
History-Deep-Link würde beim Neuladen 404 liefern.

Die Organisation steht in der URL, weil die öffentliche API mandantenfähig ist.
Eine Installation, die genau eine Organisation zeigt, kann später einen
hübscheren Einstieg davorsetzen — das ist reines Routing und berührt die
Sichtbarkeitsregeln nicht.

## Inhalte

`src/markdown.ts` macht drei Dinge über reines Markdown hinaus:

1. **Sanitizing.** Der Inhalt landet per `v-html` im DOM; Skripte,
   Event-Handler und gefährliche URL-Schemata werden vorher entfernt.
2. **Bilder umschreiben.** Seiten binden Bilder als
   `/files/db/knowledge/<uuid>.<ext>` ein — ein Pfad, der `files:read`
   verlangt. Öffentliche Leser haben keine Scopes, daher zeigen die Bilder auf
   den seitenbezogenen öffentlichen Endpunkt.
3. **Wiki-Links.** `[[Titel]]` wird zu einem echten Link, **wenn** das Ziel
   veröffentlicht ist. Sonst zu Klartext: ein toter Link würde verraten, dass
   eine interne Seite existiert.

## Entwicklung

```bash
bun install
bun run dev          # http://localhost:5174/docs/  (API-Proxy → :3000)
bun run test         # Vitest
bun run type-check
bun run build        # -> dist/public/docs/
```

`VITE_DEV_API_URL` überschreibt das Proxy-Ziel (Default `http://localhost:3000`).
