---
name: company-wiki
description: >
  Firmenwissen & internes Wiki (Firmen-Wiki-MCP-Connector). Use whenever the user asks
  about the COMPANY or anything internal that would live in the wiki — e.g. "how do
  we do X", onboarding, processes, guidelines, policies, product/spec/architecture
  docs, handbook, team knowledge, decisions, who owns what, "where is the doc for…".
  Also use to write/update wiki content: capture notes, document a decision, draft a
  new page, keep a handbook current. German triggers: „Firma", „intern", „Wiki",
  „Handbuch", „Onboarding", „Prozess", „Richtlinie", „Doku", „wie machen wir…", „wo
  steht…", „dokumentiere…", „leg eine Seite an". If a question is about the company,
  reach for the wiki BEFORE answering from general knowledge or the web.
---

# Firmen-Wiki — das Firmengehirn

Das Wiki ist die **Quelle der Wahrheit für internes Firmenwissen**. Es ist als
MCP-Server angebunden und liefert Tools, um Wissen zu **finden, zu lesen und
zu pflegen** — immer mit den Rechten des angemeldeten Nutzers (persönliche / Team- /
Organisationsseiten). Fehlt eine Berechtigung, kommt ein `403` zurück.

## Goldene Regel

Bei **firmenspezifischen** Fragen (Prozesse, Produkte, Entscheidungen, Personen,
Policies, Zahlen, „wie machen wir das hier") gilt:

1. **Erst das Wiki fragen, dann antworten.** Nicht aus dem Allgemeinwissen raten.
2. **Nur belegen, was im Wiki steht.** Jede firmenspezifische Aussage mit der
   Quellseite belegen (Titel + `pageId`), damit sie nachprüfbar ist.
3. **Ehrlich sein, wenn nichts gefunden wird.** Kein Erfinden. Stattdessen sagen,
   dass es (noch) nicht im Wiki steht, und **anbieten, es anzulegen**.
4. **Allgemeinwissen auszeichnen.** Wenn du bewusst Wissen von außerhalb des Wikis
   ergänzt, kennzeichne es klar als solches.

## Ablauf: Briefen → Finden → Lesen → Antworten

### 1. Briefen (einmal pro Sitzung)
`get_wiki_overview` aufrufen: liefert Kennzahlen, die Top-Level-Bereiche **mit
Kurzbeschreibungen (Summaries) und Facetten**, die letzten Änderungen — und, wenn
gepflegt, die **Agent-Anweisungsseite der Organisation**. Deren Inhalt ist
verbindlicher Arbeitskontext: **befolge diese Anweisungen.** `whoami` bestätigt bei
Bedarf Nutzer und Organisation; `get_wiki_tree` zeigt die volle Baumstruktur.

### 2. Finden
- **Standard: `search_wiki`** — hybride Suche (Volltext + semantisch) ist der
  Default und fällt automatisch auf Volltext zurück; `mode` nur setzen, wenn du
  bewusst abweichen willst.
- Treffer bringen **Summary, `pageType`, `status`, `updatedAt`** mit — entscheide
  damit, welche 2–3 Seiten du wirklich liest, statt alles zu öffnen.
- **Eingrenzen** statt raten: `parentId` (nur ein Teilbaum, z. B. „im Handbuch"),
  `pageType`/`status` (Facetten), `teamId`.
- **Titel bekannt?** `resolve_page` löst einen exakten Titel (Wikilink-Semantik)
  ohne Suche direkt zur Seite auf.
- **„Was hat sich getan?"** → `list_recent_changes` (filterbar mit `since`,
  `parentId`-Teilbaum, Facetten, `teamId`).
- Mehrere kurze, gezielte Suchen schlagen eine lange. Deutsche **und** englische
  Begriffe probieren (das Wiki ist gemischtsprachig).

### 3. Lesen — nur so viel wie nötig (Kontext-Ökonomie)
- Einzelne Seite: `get_page` (liefert bewusst nur `id`, `title`, `content`).
- **Mehrere Treffer: `get_pages`** — ein Call statt N; unsichtbare ids werden
  still weggelassen.
- **Lange Seiten:** erst `get_page_outline` (Überschriften-Gerüst), dann gezielt
  `read_page_section` (Anchor) oder `read_page_content` (Zeilenbereich) — nicht
  die ganze Seite laden.
- **Ganzer Abschnitt:** `get_page_subtree` — **immer begrenzen** mit `maxDepth`
  und/oder `maxChars`. Gekürzte Knoten sind markiert (`contentTruncated`,
  `childrenOmitted`); die Struktur bleibt vollständig, fehlendes gezielt nachladen.
- **Metadaten sind ein eigener, expliziter Call:** `get_page_metadata` (Scope,
  Facetten, Autorschaft, Größe) — nur holen, wenn wirklich relevant.
- **Kontext prüfen:** `get_page_links` (worauf verweist die Seite),
  `get_page_backlinks` (was verweist hierher), `get_related_pages` (semantisch
  verwandt), `get_page_history` + `get_page_version` (Verlauf, alte Stände).

### 4. Antworten
- Antwort **aus dem Wiki-Inhalt** formulieren, nicht paraphrasiertes Vorwissen.
- **Belegen:** je Aussage die Quellseite nennen — Format `[[Seitentitel]]` (+ `pageId`
  bzw. Link, wenn der Client ihn rendert).
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
  muss **eindeutig** vorkommen. Immer zuerst `read_page_content`, dann ersetzen.
  Bei mehrfachen Vorkommen `replaceAll: true`. Ein `409` heißt: String fehlt oder
  ist mehrdeutig → neu lesen und präziser matchen.
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
| Inhalt finden (hybrid, Facetten-Filter) | `search_wiki` |
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
| Ausgehende Links | `get_page_links` |
| Wer verweist hierher | `get_page_backlinks` |
| Verwandte Seiten | `get_related_pages` |
| Änderungsverlauf (kompakt) | `get_page_history` |
| Alte Version in voller Länge | `get_page_version` |
| Seite anlegen | `create_page` |
| Umbenennen/Verschieben/Facetten | `update_page` |
| Ans Ende anhängen (robust) | `append_to_page` |
| Text ändern (find & replace) | `edit_page_content` |
| Seite löschen (Rückfrage!) | `delete_page` |

## Kurz-Heuristik

> **Sitzungsstart → `get_wiki_overview` (Agent-Anweisungen befolgen).
> Firmenfrage → `search_wiki` → gezielt lesen (`get_pages`, Outline/Section) →
> mit `[[Quelle]]` antworten, `status`/`validUntil` beachten.
> Nichts gefunden → sagen + anbieten anzulegen. Neues Wissen → `append_to_page`
> oder `create_page` anbieten. Löschen/firmenweit veröffentlichen → vorher fragen.**
