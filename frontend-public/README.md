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

Hash-Routen (`#/<slug>/page/<pageId>`), wie im Haupt-Frontend. Grund:
Die Bundles werden als statische Dateien ohne SPA-Fallback ausgeliefert, ein
History-Deep-Link würde beim Neuladen 404 liefern.

Die Organisation steht als lesbarer Slug in der URL (`#/acme-gmbh/…`). Slugs
werden serverseitig aus dem Organisationsnamen abgeleitet, nicht gespeichert —
die Auflösung ist deshalb eine Suche (`GET …/public/wiki/by-slug/:slug`) und
ein Slug wandert, wenn eine Organisation umbenannt wird. Kanonisch bleibt die
Tenant-ID; der Slug ist nur der Einstieg.

Seiten behalten ihre ID: Titel sind weder eindeutig noch stabil, ein
titelbasierter Seiten-Slug würde bei jeder Umbenennung Links brechen.

Ohne Organisation in der URL zeigt der Einstieg die veröffentlichenden
Organisationen; gibt es genau eine (der Normalfall), wird direkt
weitergeleitet. Eine ID muss niemand eingeben.

## Erscheinungsbild

Hell/Dunkel folgt standardmäßig dem Betriebssystem und lässt sich über den
Schalter im Header auf hell oder dunkel festlegen. Umgesetzt über die
`.app-dark`-Klasse auf `<html>` und denselben localStorage-Schlüssel wie das
Haupt-Frontend (`wiki:theme`) — beide Apps laufen auf derselben Origin, die
Wahl gilt also für beide.

**Branding.** Logo und Primärfarbe kommen aus derselben Quelle wie im
Haupt-Frontend (Logo-Tabelle bzw. `tenant_settings` key `branding`), damit eine
veröffentlichte Seite aussieht wie das Wiki, aus dem sie stammt. Die Farbe wird
nicht roh übernommen: `src/brand.ts` leitet pro Erscheinungsbild eine lesbare
Variante ab — eine für Weiß gewählte Markenfarbe ist auf dem dunklen
Hintergrund sonst unlesbar und umgekehrt. Ungültige Werte fallen auf die
Standardpalette zurück.

**Navigationsbreite.** Der Baum ist per Griff zwischen Sidebar und Inhalt
verschiebbar (Tastatur: Pfeil links/rechts, Doppelklick setzt zurück). Die
Breite wird pro Browser gemerkt.

**Suche.** Sitzt in der Sidebar über dem Baum, wie im Haupt-Frontend: solange
etwas eingegeben ist, treten die Treffer an die Stelle des Baums, der
Inhaltsbereich zeigt weiter die gelesene Seite. Eine eigene Suchseite gibt es
deshalb nicht. Anfragen sind entprellt und die vorherige wird abgebrochen — der
semantische Teil der Suche erzeugt pro Anfrage ein Embedding.

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
