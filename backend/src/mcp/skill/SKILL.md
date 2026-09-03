---
name: company-wiki
description: >
  Firmenwissen & internes Wiki (Firmen-Wiki-MCP-Connector). Use whenever the user asks
  about the COMPANY or anything internal that would live in the wiki — vom Firmenwissen
  (Prozesse, Onboarding, Richtlinien, Entscheidungen, Personen, Handbuch) bis zum
  Produktwissen (Specs, Architektur, Anleitungen, Datenblätter, Schaltpläne). E.g. "how
  do we do X", onboarding, guidelines, policies, product/spec/architecture docs, wer
  betreut was, "where is the doc for…". Also use to write/update wiki content: capture
  notes, document a decision, draft a new page, keep a handbook current. German triggers:
  „Firma", „intern", „Wiki", „Handbuch", „Onboarding", „Prozess", „Richtlinie", „Doku",
  „Produkt", „Anleitung", „Datenblatt", „Schaltplan", „wie machen wir…", „wo steht…",
  „dokumentiere…", „leg eine Seite an". If a question is about the company or its
  products, reach for the wiki BEFORE answering from general knowledge or the web.
---

# Firmen-Wiki — das Firmengehirn

Das Firmen-Wiki ist die **Quelle der Wahrheit für internes Wissen** — von
allgemeinem **Firmenwissen** (Prozesse, Handbuch, Onboarding, Policies,
Entscheidungen, Personen) bis zu spezifischem **Produktwissen** (Specs,
Architektur, Anleitungen, Datenblätter, Schaltpläne). Es ist als MCP-Server
angebunden und liefert Tools, um Wissen zu **finden, zu recherchieren, zu lesen,
zu zeigen und zu pflegen** — immer mit den Rechten des angemeldeten Nutzers
(persönliche / Team- / Organisationsseiten). Fehlt eine Berechtigung, kommt ein
`403` zurück (das heißt „nicht erlaubt", nicht „existiert nicht").

## Goldene Regel

Bei **firmen- und produktspezifischen** Fragen (Prozesse, Produkte,
Entscheidungen, Personen, Policies, Zahlen, „wie machen wir das hier") gilt:

1. **Erst das Wiki fragen, dann antworten.** Nicht aus dem Allgemeinwissen raten.
2. **Nur belegen, was im Wiki steht.** Jede firmenspezifische Aussage mit der
   Quellseite belegen — als **Link**: jedes Seiten-Objekt in einer Tool-Antwort
   trägt ein `url`-Feld (`[Seitentitel](url)`), dazu `path`/Breadcrumb, wenn
   vorhanden. So ist die Quelle nachprüfbar *und* mit einem Klick offen.
3. **Ehrlich sein, wenn nichts gefunden wird.** Kein Erfinden. Stattdessen sagen,
   dass es (noch) nicht im Wiki steht, und **anbieten, es anzulegen**.
4. **Allgemeinwissen auszeichnen.** Wenn du bewusst Wissen von außerhalb des Wikis
   ergänzt, kennzeichne es klar als solches.

## Ablauf: Briefen → Recherchieren → Lesen → Zeigen → Antworten

### 1. Briefen (einmal pro Sitzung)
`get_wiki_overview` aufrufen: liefert Kennzahlen, die Top-Level-Bereiche **mit
Kurzbeschreibungen (Summaries) und Facetten**, die letzten Änderungen — und, wenn
gepflegt, die **Agent-Anweisungsseite der Organisation**. Deren Inhalt ist
verbindlicher Arbeitskontext: **befolge diese Anweisungen.** `whoami` bestätigt bei
Bedarf Nutzer und Organisation; `get_wiki_tree` zeigt die volle Baumstruktur als
Landkarte.

### 2. Recherchieren — die Kern-Kompetenz

Diese Tools machen dich beim Suchen & Recherchieren wirklich stark. **Nutze sie
aktiv**, statt bei einem Treffer stehenzubleiben:

- **`search_wiki` ist der Motor.** Hybride Suche (Volltext + semantisch,
  rank-fused) ist der Default und fällt automatisch auf Volltext zurück — `mode`
  nur setzen, wenn du bewusst abweichen willst. Ergebnisse sind
  **vertrauens-gewichtet** (verified geboostet, outdated abgewertet, superseded
  unter ihren Nachfolger gefaltet).
- **Treffer sind reich an Triage-Signalen:** jeder Hit bringt `snippet`, `summary`,
  `pageType`, `status`, `updatedAt`, **`path`** (Breadcrumb im Baum, z. B.
  „Handbuch/HR/Urlaub") und **`chunkOrder`** mit. Entscheide damit, welche 2–3
  Seiten du wirklich liest, statt alles zu öffnen.
- **Mehrere kurze, gezielte Suchen schlagen eine lange.** Variiere die Begriffe,
  probiere **deutsch UND englisch** (das Wiki ist gemischtsprachig), zerlege
  zusammengesetzte Fragen in Teilsuchen.
- **Eingrenzen statt raten:** `parentId` (nur ein Teilbaum, z. B. „im Handbuch"
  oder „unter Produkt X"), `pageType`/`status` (Facetten), `teamId`, `limit`.
- **Verlorenen Kontext nachladen: `get_page_chunk_context`.** Ein Suchtreffer
  liefert nur einen Snippet — mit `pageId` + `chunkOrder` des Treffers holst du
  den Chunk **plus die Nachbar-Chunks davor/danach** in Lesereihenfolge zurück
  (`before`/`after`, je Default 2). Ideal, um aus einem Treffer die volle Aussage
  zu rekonstruieren, ohne die ganze Seite zu laden — inkl. `sourcePage` (welche
  PDF-Seite) und `path`.
- **Dem Wissensgraphen folgen** statt nur zu suchen:
  - `get_related_pages` — semantisch verwandte Seiten (Embedding-Ähnlichkeit).
  - `get_page_backlinks` — was verweist auf diese Seite (wer nutzt/zitiert sie).
  - `get_page_links` — worauf verweist diese Seite (weiterführende Quellen).
- **Titel bekannt?** `resolve_page` löst einen exakten Titel (Wikilink-Semantik)
  ohne Suchrunde direkt zur Seite auf.
- **„Was hat sich getan?"** → `list_recent_changes` (filterbar mit `since`,
  `parentId`-Teilbaum, Facetten, `teamId`) — auch gut, um zu prüfen, ob X noch
  aktuell ist.
- **Flach durchblättern:** `list_pages` als gepagter Index, wenn du stöbern willst.

### 3. Lesen — nur so viel wie nötig (Kontext-Ökonomie)
- Einzelne Seite: `get_page` (liefert bewusst nur `id`, `title`, `content` als
  Markdown).
- **Mehrere Treffer: `get_pages`** — ein Call statt N; unsichtbare ids werden
  still weggelassen.
- **Lange Seiten:** erst `get_page_outline` (Überschriften-Gerüst), dann gezielt
  `read_page_section` (Anchor) oder `read_page_content` (Zeilenbereich) — nicht
  die ganze Seite laden.
- **Ganzer Abschnitt/Teilbaum:** `get_page_subtree` — **immer begrenzen** mit
  `maxDepth` und/oder `maxChars`. Gekürzte Knoten sind markiert
  (`contentTruncated`, `childrenOmitted`); die Struktur bleibt vollständig,
  Fehlendes gezielt nachladen.
- **Metadaten sind ein eigener, expliziter Call:** `get_page_metadata` (Scope,
  Facetten, Autorschaft, Größe) — nur holen, wenn wirklich relevant.
- **Verlauf:** `get_page_history` (kompakt) + `get_page_version` (alter Stand in
  voller Länge).

### 4. Bilder ansehen & zeigen

Viele Produkt- und Anleitungsseiten leben von **Bildern**: Datenblätter,
Schaltpläne, Diagramme, Screenshots, Schritt-für-Schritt-Fotos. Seiten betten
Bilder als `/files/db/<bucket>/<uuid>.<ext>`-Pfade ein.

- **Wenn DU das Bild brauchst** (um es zu verstehen und die Antwort darauf zu
  stützen): `get_page_image` (pageId + genau die Bildreferenz aus dem Inhalt) —
  liefert einen echten Image-Block zum Ansehen.
- **Wenn der NUTZER das Bild sehen soll — biete es aktiv an und nutze es, wann
  immer es die Antwort greifbarer macht:** bei Anleitungen, Datenblättern,
  Schaltplänen, Diagrammen oder wo „ein Bild sagt mehr als tausend Worte".
  - `view_image` — ein einzelnes Bild groß & zoombar (Klick = Vollbild, wo der
    Host es unterstützt); optionale `caption`.
  - `view_page_images` — Galerie **aller** Bilder einer Seite.
  - `view_page` — die **ganze Seite** formatiert gerendert (Überschriften,
    Tabellen, Bilder, klickbare [[Wikilinks]]); mit `anchor` (aus
    `get_page_outline`) nur einen Abschnitt zeigen. Bevorzuge das gegenüber
    `get_page`, wann immer der Nutzer die Seite **sehen** will.

**Bildbeschreibungen.** Jede gelesene Seite listet ihre Bilder unter
`embeddedImages` — `ref` (damit lädst du es) und, wo vorhanden, `description`:
was auf dem Bild zu sehen ist. Dieselbe Beschreibung steht im Seitentext als
`<image-description src="…">…` unter dem Bild und ist damit auch über
`search_wiki` findbar (in Snippets als `[image: …]`).

- Die Beschreibung ist **Seiteninhalt**: zitiere sie, antworte daraus, belege
  sie wie jede andere Textstelle mit `path` / `[[Seite]]`.
- Sie ersetzt das Bild **nicht**. Hängt die Antwort an einem Detail (ein Wert im
  Schaltplan, eine Beschriftung auf dem Foto), lade das Bild trotzdem mit
  `get_page_image` und sieh es an.
- Ein Bild **ohne** `description` ist ungelesenes Wissen: ansehen, oder sagen,
  dass du es nicht beurteilen kannst.
- Wenn du weißt, was ein unbeschriebenes Bild zeigt, biete an, es zu
  dokumentieren: **`set_image_description`** (`pageId` + `ref` aus
  `embeddedImages` + eine Zeile Text). Das ist der einzige Weg, das Feld zu
  füllen — ein Alt-Text oder ein Markdown-Titel ist **keine** Beschreibung und
  wird nie als solche übernommen; den Marker von Hand schreiben musst du nicht.
  Erneutes Setzen **ersetzt** die Beschreibung, ein leerer Text **entfernt**
  sie. Eine Zeile, keine Zeilenumbrüche, beschreibe nur Sichtbares — und sieh
  dir das Bild vorher mit `get_page_image` an, statt zu raten.

### 5. Antworten
- Antwort **aus dem Wiki-Inhalt** formulieren, nicht paraphrasiertes Vorwissen.
- **Belegen:** je Aussage die Quellseite nennen — als klickbaren Link
  `[Seitentitel](url)` mit dem `url`-Feld aus der Tool-Antwort (Abschnitte haben
  eine eigene `url` mit `#anchor`), dazu `path`/Breadcrumb, damit der Nutzer
  sieht, wo die Antwort lebt. `url` **nie selbst zusammenbauen** — immer das
  Feld aus der Antwort verwenden.
- **Vertrauenssignale ernst nehmen:** `status: "verified"` bevorzugen; bei
  `"outdated"` oder überschrittenem `validUntil` den Vorbehalt nennen; verweist
  `supersedesId` auf einen Nachfolger, die neuere Seite nutzen.
- Bei Widersprüchen den Konflikt benennen (`get_page_history` zur Einordnung) —
  nicht still eine Seite wählen.
- Wenn nichts gefunden: klar sagen „steht (noch) nicht im Wiki" und anbieten, eine
  Seite anzulegen oder eine bestehende zu ergänzen.

## Schreiben & Pflegen

Das Wiki soll **wachsen**. Wenn Wissen entsteht (eine Entscheidung, ein Prozess,
Meeting-Notizen, eine Antwort, die andere brauchen werden), biete an, es festzuhalten.

- **Anhängen statt editieren:** `append_to_page` ist der robuste Standard für
  Notizen, Log-Einträge, neue Abschnitte — kein Lesen vorher, kein
  String-Matching, kein Konflikt.
- **Gezielt ändern:** `edit_page_content` ist exaktes Find-&-Replace: `oldString`
  muss **eindeutig** vorkommen. Immer zuerst `read_page_content`, dann ersetzen —
  den Suchtext wörtlich aus dem Gelesenen kopieren, inklusive Markdown-Auszeichnung
  (`**fett**`, `## Überschrift`, Listenpunkte) und der Leerzeilen zwischen Absätzen.
  Ein `oldString` darf mehrere Absätze umspannen, `newString` ist ebenfalls Markdown.
  Bei mehrfachen Vorkommen `replaceAll: true`. Ein `409` heißt: String fehlt oder
  ist mehrdeutig → neu lesen und präziser matchen.
- **Verweise setzen:** `[[Seitentitel]]` (oder `[[Seitentitel|Anzeigetext]]`)
  einfach in den Text schreiben — in `create_page`, `append_to_page` und
  `edit_page_content` gleichermaßen. Daraus wird ein echter, klickbarer
  Seitenverweis; zeigt er auf eine noch nicht existierende Seite, bleibt er als
  Phantom-Link stehen und rastet ein, sobald die Seite angelegt wird. Nicht
  escapen und keine Backslashes setzen.
- **Löschen:** `edit_page_content` mit leerem `newString`. Ein dadurch leer
  gewordener Absatz wird sauber entfernt (kein leerer Platzhalter), und ein
  `oldString`, der mehrere Absätze umspannt (wörtlich aus `read_page_content`
  kopiert, inkl. der Leerzeilen dazwischen), entfernt sie alle auf einmal.
- **Neue Seite:** `create_page`. Standard ist **persönlich/privat**. Bewusst wählen:
  - `teamId` → Seite gehört einem Team,
  - `organisation: true` → firmenweit sichtbar,
  - `parentId` → unter eine bestehende Seite hängen (Struktur sauber halten).
  - Vorher mit `resolve_page`/`search_wiki` prüfen, ob es die Seite schon gibt
    (keine Dubletten), und den passenden Elternknoten wählen.
  - Inhalt als **Markdown**; auf andere Seiten mit `[[Seitentitel]]` verlinken.
- **Kuratieren:** `update_page` setzt Titel, Position im Baum, Scope — und die
  **Facetten**: `pageType`/`status` (erlaubte Werte: `get_wiki_config`),
  `validUntil` (Ablaufdatum), `supersedesId` (ersetzt Seite X), `summary`
  (manuelle Kurzbeschreibung; schaltet die Auto-Zusammenfassung dieser Seite ab).
- **Sichtbarkeit ist eine bewusste Entscheidung.** Persönliche Notizen nicht ungefragt
  firmenweit stellen. Im Zweifel den Scope erfragen.
- **Löschen ist heikel.** `delete_page` ist nicht rückgängig zu machen und kann
  Unterseiten mitnehmen — **immer vorher rückfragen**, was genau gelöscht wird.

## Berechtigungen & Organisation

- Alle Tools laufen mit den **Rechten des Nutzers**. `403` = keine Berechtigung
  (nicht „existiert nicht") — dem Nutzer sagen, dass ihm der Zugriff fehlt, statt zu
  behaupten, es gäbe die Seite nicht.
- Das Token ist an **eine** Organisation gebunden. `list_organisations` ist
  informativ; ist der Nutzer in mehreren Tenants, kann diese Verbindung nur zeigen,
  was zur aktiven Organisation gehört.

## Tool-Spickzettel

| Ziel | Tool |
|---|---|
| Briefing zum Sitzungsstart | `get_wiki_overview` |
| Wer bin ich / welche Organisation | `whoami` |
| Landkarte des Wissens | `get_wiki_tree` |
| **Inhalt finden (hybrid, Facetten, `path`+`chunkOrder`)** | `search_wiki` |
| **Kontext um einen Treffer nachladen** | `get_page_chunk_context` |
| **Verwandte Seiten (semantisch)** | `get_related_pages` |
| **Was verweist hierher / worauf verweist die Seite** | `get_page_backlinks` / `get_page_links` |
| Titel → Seite (ohne Suche) | `resolve_page` |
| Was hat sich geändert | `list_recent_changes` |
| Flacher Index / durchblättern | `list_pages` |
| Erlaubte Facetten-Werte | `get_wiki_config` |
| Seite lesen (nur Inhalt) | `get_page` |
| Mehrere Seiten in einem Call | `get_pages` |
| Überschriften-Gerüst | `get_page_outline` |
| Einen Abschnitt lesen | `read_page_section` |
| Zeilenbereich lesen | `read_page_content` |
| Teilbaum laden (begrenzt!) | `get_page_subtree` (`maxDepth`/`maxChars`) |
| Metadaten (explizit) | `get_page_metadata` |
| Änderungsverlauf (kompakt) | `get_page_history` |
| Alte Version in voller Länge | `get_page_version` |
| **Bild ansehen (für dich)** | `get_page_image` |
| **Was ist auf dem Bild?** | `embeddedImages[].description` der gelesenen Seite |
| **Ein Bild dem Nutzer zeigen (groß/zoombar)** | `view_image` |
| **Alle Bilder einer Seite zeigen (Galerie)** | `view_page_images` |
| **Bildbeschreibung setzen/ändern/löschen** | `set_image_description` |
| **Ganze Seite formatiert zeigen** | `view_page` (`anchor` für Abschnitt) |
| Seite anlegen | `create_page` |
| Umbenennen/Verschieben/Facetten | `update_page` |
| Ans Ende anhängen (robust) | `append_to_page` |
| Text ändern (find & replace) | `edit_page_content` |
| Seite löschen (Rückfrage!) | `delete_page` |

## Kurz-Heuristik

> **Sitzungsstart → `get_wiki_overview` (Agent-Anweisungen befolgen).
> Firmen-/Produktfrage → `search_wiki` (mehrere gezielte Suchen, de+en) →
> Kontext mit `get_page_chunk_context` / dem Link-Graph (`get_related_pages`,
> Backlinks) vertiefen → gezielt lesen (`get_pages`, Outline/Section) →
> Bilder bei Anleitungen/Datenblättern/Schaltplänen mit `view_image` /
> `view_page` zeigen → mit `[[Quelle]]` + `path` antworten, `status`/`validUntil`
> beachten. Nichts gefunden → sagen + anbieten anzulegen. Neues Wissen →
> `append_to_page` oder `create_page` anbieten. Löschen/firmenweit
> veröffentlichen → vorher fragen.**
