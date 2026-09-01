# UI/UX-Backlog: Anleihen bei Tolaria

Recherche-Notiz. Quelle: <https://tolaria.md/> bzw. `refactoringhq/tolaria`
(Tauri + React + BlockNote/CodeMirror, ~364 Komponenten).

**Lizenz-Hinweis:** Tolaria steht unter AGPL-3.0-or-later. Konzepte und
UX-Muster nachbauen ist unproblematisch, Code übernehmen wäre es nicht. Alle
Punkte hier sind Nachbau, keine Portierung.

**Ausgangslage:** Unser Datenmodell
(`backend/framework/src/lib/db/schema/knowledge.ts`) deckt bereits fast alles
ab, was Tolaria über YAML-Frontmatter löst: `pageType`, `status` +
`verifiedAt/By`, `ownerUserId/TeamId`, `validUntil`, `supersedesId`,
`attributes` (jsonb), `summary`, `position`, Links/Backlinks, Versionen.
Die meisten Punkte unten sind daher reine Frontend-Arbeit.

## Beschlossen (Stand 2026-08-27)

### 1. Command Palette (Cmd+K) + Quick Open (Cmd+P)

Das Übernehmenswerte ist nicht die Palette, sondern das *Command-Registry-Pattern*
(Tolaria ADR-0029): pro Domäne ein `build*Commands(config)`, das
`{ id, label, group, shortcut, keywords, enabled, execute }` liefert; die
Palette ist dumm und filtert nur über die Liste.

- Neu: `frontend/src/composables/useCommandRegistry.ts` + `CommandPalette.vue`
- Quick Open recycelt `wiki.search()` aus `WikiSidebar.vue`
- Detail: findet Quick Open nichts, steht unten "Seite »<Query>« anlegen" —
  Capture ohne die Tastatur zu verlassen

### 3. Highlight `==Text==`

Tiptap-Mark + Button im `EditorBubbleMenu` + `Cmd+Shift+M`. Markdown-sauber.

### 4. Slash-Commands "Datum" / "Uhrzeit"

Ergänzung in `frontend/src/components/editor/slashCommands.ts`.

### 5. Klappbare Überschriften im Editor

Folding ist reine Darstellung — es landet nichts im Markdown. Größter
Lesbarkeitsgewinn für lange Handbuch-Seiten.

### 11. Versionshistorie + Recent-Changes-Feed ("Pulse")

Bei Tolaria: Git-Commits nach Tag gruppiert, pro Datei +/-/geändert-Icon.
Unser Äquivalent: Recent Changes nach Tag, wer welche Seite geändert hat,
mit Diff pro Version.

**Backend kann das bereits** (`get_page_history`, `get_page_version`), im
Frontend fehlt es vollständig — echte Lücke, nicht nur Nice-to-have.

### 13. Status-Bar

Dünne Leiste unten: Speicherzustand, Presence, Embedding-/Index-Status,
MCP-Verbindung, Seitenzahl. Billig, wirkt sofort "fertig".

### 14. Inbox-/Draft-Workflow

Schnelles Capture ohne Struktur, danach ein Review-Durchgang (Titel, Typ,
Status, Beziehungen), `Cmd+E` = "erledigt/organisiert", per Setting
abschaltbar. Bei uns über `status: draft` + Sidebar-Sektion "Eingang".
Konzeptionell anspruchsvoll, im Aufwand klein.

## Zusätzlich beschlossen

### A. Farbige Icons in der Navigation

Tolaria löst das in zwei kleinen Layern:

- **`_icon` ist ein String mit drei Bedeutungen**, zur Laufzeit erkannt
  (`utils/noteIcon.ts`, ~40 Zeilen): Emoji -> Emoji rendern; http(s)-URL ->
  Bild; sonst -> Icon-Name; sonst nichts. Ein Feld, drei Quellen.
  Emoji ist der Zero-Effort-Pfad für Nutzer.
- **`_color`** ist Palette-Key (9 Accents red..gray, auf CSS-Variablen
  gemappt) oder beliebige CSS-Farbe. Zu jeder Farbe eine "light"-Variante für
  Chips; bei freien Farben per
  `color-mix(in srgb, X 14%, transparent)` errechnet.
- Fallback-Kette: Custom -> Default pro bekanntem Typnamen -> grau. Sieht
  also auch unkonfiguriert farbig aus.
- Single Source of Truth in einer Datei (`utils/typeColors.ts`), genutzt von
  Sidebar, Liste und Inspector.

**Umsetzung bei uns:**

- Farb-Layer 1:1 übernehmbar: 9 Accent-Paare als CSS-Variablen +
  `pageTypeStyle.ts` mit `getPageTypeColor()` / `getPageTypeLightColor()`.
- Icon-Layer hat einen Haken: `unplugin-icons` (`~icons/mdi/x`) löst **beim
  Build statisch** auf, ein Icon-Name aus der DB ist damit nicht dynamisch
  renderbar. Empfehlung:
  1. Kuratierte Allowlist — eine Datei mit 40-60 `~icons/mdi/*`-Imports als
     `Record<string, Component>`, aus der Admins wählen. Klein, offline.
  2. Plus Emoji-Erkennung analog Tolaria (~20 Zeilen), deckt den Großteil
     ohne jeden Icon-Import.
  3. Volles Iconify-Set offline (`@iconify/json` ist schon Dependency) nur,
     wenn wir den "alle durchsuchen"-Picker wirklich wollen.
- Datenweg: `WikiTreeNode` (`frontend/src/types/wiki.ts`) trägt kein
  `pageType`, der Serializer `backend/src/lib/wiki/tree.ts` selektiert es
  nicht -> ~5 Zeilen Backend. Marker-Slot in `WikiTreeItem.vue` existiert
  schon (Globe-Icon für public).

### B. Property-Bar rechts

Zwei Mechaniken machen das Panel gut:

1. **Der Wert-Editor wird geraten, nicht konfiguriert.**
   `detectPropertyType(key, value)` (`utils/propertyTypes.ts`) leitet aus
   Feldname + Wertform einen von 8 Modi ab
   (`text|number|date|boolean|status|url|tags|color`): Key enthält "status"
   -> Status-Pill; Key in {date, deadline, due, start, end, scheduled} ->
   Datepicker; Wert im Status-Vokabular -> Status-Pill; Hex-Wert ->
   Farbwähler; Key in {tags, keywords, labels} -> Chips. Überschreibbar pro
   Feldname, gespeichert in der Vault-Config — nicht pro Seite.
2. **Fehlende Felder als Geister-Zeilen** ("Suggested Properties"): fehlende
   Felder erscheinen ausgegraut mit "—" als Wert und sind Buttons; Klick legt
   das Feld mit dem passenden Editor an. Macht aus einem leeren Formular eine
   Vorschlagsliste.

Dazu unten Relationships, gruppiert pro Beziehungsfeld, Inverse werden
berechnet statt gepflegt.

**Umsetzung bei uns** (alles ohne Backend-Änderung):

- Einheitliche Zeilen-Optik (Icon + Label + Wert, inline editierbar) statt
  Label-über-Select in `frontend/src/views/wiki/page.vue`.
- Typgerechte Attribut-Editoren: hier sind wir besser dran als Tolaria —
  `KnowledgeAttributeDefinition` hat schon
  `type?: "string"|"number"|"date"|"boolean"|"enum"`. Wir müssen nicht raten,
  wir haben es konfiguriert; das Frontend rendert es nur noch nicht.
  Billigster großer Gewinn im Panel.
- Geister-Zeilen für fehlende `status`, `validUntil`, `owner`, `supersedes`
  und alle konfigurierten, auf der Seite fehlenden Attribute.
- `WikiReferences.vue` als gruppierte Chip-Liste unten ins Panel ziehen
  statt separater Block.

### C. "Types" als Ordnungsprinzip (Konzept, noch nicht beschlossen)

Was Tolaria "Types" nennt:

- `type:` im Frontmatter — eine Seite *ist* ein Ding einer Kategorie
  (Project, Person, Essay, Event, Procedure, Area, ...). Der Ordner ist
  ausdrücklich irrelevant: "Tolaria does not infer type from folder location."
- Die Sidebar-Sektion "TYPES" *ist* die Hauptnavigation — jeder Typ ein
  Filter über den ganzen Bestand, mit Zähler.
- **Ein Typ ist selbst eine Seite** ("Type-Dokument", `type: Type`) und hält
  per System-Properties: `_icon`, `_color`, `_sidebar_label`, `_order`,
  `_pinned_properties` (Felder in der Editor-Inline-Leiste),
  `_list_properties_display` (Felder in Listenzeilen), `template` (Vorlage
  für neue Seiten) sowie Feld-Defaults (`status: Active` im Type-Dokument =>
  Default für jede neue Seite dieses Typs).
- Typ = "was ist das", Relationship = "woran hängt das". Zusammen ersetzen
  sie die Ordnerhierarchie. Effektiv eine Notion-Datenbank ohne Datenbank.

**Was uns fehlt:** `pageType` existiert, aber flach — validierte String-Liste
in `knowledge-config.ts` (`["FAQ","manual","text","policy","note"]`). Es
fehlen Präsentation (Icon/Farbe/Label/Order), Template (neue Seite startet
mit Struktur + Default-Feldern) und Navigation (Sidebar-Sektion "Typen" mit
Zählern, *parallel* zum Baum — unsere echte Hierarchie bleibt).

Vorschlag: `pageTypes: string[]` -> `KnowledgePageTypeDefinition[]` mit
`{ key, label, icon, color, order, template? }`. Rückwärtskompatibel (String
=> `{ key }`); `KnowledgeAttributeDefinition` im selben File macht das Muster
schon vor.

## Bewusst zurückgestellt

- **HTML-Blöcke + Vault Expressions** (`{{status}}`,
  `{{[[andere-seite]].status}}` in sandboxed HTML): mächtig, aber echte
  Security-Fläche. Reduzierte Variante wäre read-only
  `{{property}}`-Interpolation in normalem Markdown.
- **Callouts als editierbare Blöcke** (`> [!NOTE]`), **Block-Selektion per
  Tastatur**, **"Neighborhood"-Modus** (Liste wird zu Beziehungsgruppen um
  eine Seite — der billige Graph-Ersatz), **Saved Views + Filter-Pills**,
  **Editor-Breite pro Seite**: gut, aber nicht in dieser Runde.
- **Spreadsheet-Modus, Whiteboards (tldraw), Math**: zu schwer. Mermaid wäre
  die Ausnahme.
- **H1 als einzige Titelfläche**: kollidiert mit unserem Titel in der DB.
