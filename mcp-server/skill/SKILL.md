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

Das Wiki ist die **Quelle der Wahrheit für internes Firmenwissen**. Es hängt als
MCP-Connector an claude.ai und liefert Tools, um Wissen zu **finden, zu lesen und
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
4. **Allgemeinwissen sauszeichnen.** Wenn du bewusst Wissen von außerhalb des Wikis
   ergänzt, kennzeichne es klar als solches.

## Ablauf: Orientieren → Finden → Lesen → Antworten

### 1. Orientieren (einmal pro Sitzung)
Beim ersten Wiki-Zugriff `whoami` aufrufen — bestätigt Nutzer und aktive
Organisation. Bei Unklarheit über den Aufbau `get_wiki_tree` holen: es zeigt die
Struktur in drei Bereichen (`personal`, `teams`, `organisation`) und ist die beste
Landkarte, welches Wissen überhaupt existiert.

### 2. Finden
- **Standard: `search_wiki` mit `mode: "hybrid"`.** Hybrid/semantische Suche findet
  Inhalte auch, wenn der Nutzer andere Worte verwendet als die Seite. Nur wenn das
  leer bleibt oder Embeddings nicht verfügbar sind, auf `mode: "fulltext"`
  (Stichwortsuche) zurückfallen.
- Mehrere kurze, gezielte Suchen schlagen eine lange Suche. Synonyme und deutsche
  **und** englische Begriffe probieren (das Wiki ist gemischtsprachig).
- Struktur statt Suche, wenn die Frage nach einem Bereich fragt ("das Onboarding",
  "das Handbuch"): den Teil im `get_wiki_tree` finden und mit `get_page_subtree`
  komplett laden.

### 3. Lesen
- Einzelne Treffer mit `get_page` (id aus Suche/Tree) in voller Länge lesen.
- Ganzen Abschnitt (Seite + alle Unterseiten) in **einem** Call: `get_page_subtree`.
- Große Seiten gezielt: `read_page_content` mit `fromLine`/`maxLines`.
- **Kontext prüfen**, bevor du eine Antwort baust:
  - `get_page_links` — worauf verweist die Seite (offene `[[wikilinks]]` = fehlende
    Seiten).
  - `get_page_backlinks` — was verweist auf die Seite (Umfeld, verwandte Prozesse).
  - `get_related_pages` — semantisch verwandte Seiten (deckt Lücken der Suche ab).
  - `get_page_history` — bei „ist das noch aktuell / was hat sich geändert".

### 4. Antworten
- Antwort **aus dem Wiki-Inhalt** formulieren, nicht paraphrasiertes Vorwissen.
- **Belegen:** je Aussage die Quellseite nennen — Format `[[Seitentitel]]` (+ `pageId`
  bzw. Link, wenn der Client ihn rendert).
- Bei widersprüchlichen/veralteten Seiten den Konflikt benennen und `get_page_history`
  zur Einordnung nutzen — nicht still die neuere Seite wählen.
- Wenn nichts gefunden: klar sagen „steht (noch) nicht im Wiki" und anbieten, eine
  Seite anzulegen oder eine bestehende zu ergänzen.

## Schreiben & Pflegen

Das Wiki soll **wachsen**. Wenn Wissen entsteht (eine Entscheidung, ein Prozess,
Meeting-Notizen, eine Antwort, die andere brauchen werden), biete an, es festzuhalten.

- **Vor jeder Änderung lesen.** `edit_page_content` ist ein exaktes Find-&-Replace:
  `oldString` muss **eindeutig** im aktuellen Text vorkommen. Immer zuerst
  `read_page_content` (oder `get_page`), dann den exakten Ausschnitt ersetzen. Bei
  mehrfachen Vorkommen `replaceAll: true`. Ein `409` heißt: String fehlt oder ist
  mehrdeutig → neu lesen und präziser matchen.
- **Neue Seite:** `create_page`. Standard ist **persönlich/privat**. Bewusst wählen:
  - `teamId` → Seite gehört einem Team,
  - `organisation: true` → firmenweit sichtbar,
  - `parentId` → unter eine bestehende Seite hängen (Struktur sauber halten).
  - Vorher mit `search_wiki`/`get_wiki_tree` prüfen, ob es die Seite schon gibt
    (keine Dubletten), und den passenden Elternknoten wählen.
  - Inhalt als **Markdown**; auf andere Seiten mit `[[Seitentitel]]` verlinken, damit
    das Wissensnetz zusammenhängt.
- **Umbenennen/Verschieben:** `update_page` (Titel, `parentId`, `teamId`,
  `organisation`) — ändert Metadaten, nicht den Text.
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
| Wer bin ich / welche Organisation | `whoami` |
| Landkarte des Wissens | `get_wiki_tree` |
| Inhalt finden | `search_wiki` (`mode: "hybrid"`) |
| Flacher Index / durchblättern | `list_pages` |
| Seite lesen | `get_page` |
| Zeilenbereich lesen | `read_page_content` |
| Ganzen Abschnitt laden | `get_page_subtree` |
| Ausgehende Links | `get_page_links` |
| Wer verweist hierher | `get_page_backlinks` |
| Verwandte Seiten | `get_related_pages` |
| Änderungsverlauf | `get_page_history` |
| Seite anlegen | `create_page` |
| Umbenennen/Verschieben | `update_page` |
| Text ändern (find & replace) | `edit_page_content` |
| Seite löschen (Rückfrage!) | `delete_page` |

## Kurz-Heuristik

> **Firmenfrage → `search_wiki` (hybrid) → lesen → mit `[[Quelle]]` antworten.
> Nichts gefunden → sagen + anbieten anzulegen. Neues Wissen → anbieten festzuhalten.
> Löschen/firmenweit veröffentlichen → vorher fragen.**
