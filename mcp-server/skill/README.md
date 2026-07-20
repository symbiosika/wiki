# Skill-Vorlage: „Firmen-Wiki" für claude.ai

Diese Vorlage macht claude.ai zum **Firmengehirn**: sie sorgt dafür, dass Claude
bei Firmenfragen **zuerst das Wiki** nutzt, Antworten **belegt** und beim
**Pflegen** von Wissen hilft.

Es gibt zwei sich ergänzende Ebenen — beide zusammen sind das Optimum:

| Ebene | Datei | Wirkung | Reichweite |
|---|---|---|---|
| **MCP-Server-`instructions`** | `../src/instructions.ts` | Immer aktiv, sobald der Connector an ist. Primt Claude „Firmenfrage → erst Wiki". | Automatisch für **alle** Nutzer des Connectors |
| **Agent Skill** | `./SKILL.md` | Ausführliches Playbook (Suchstrategie, Zitieren, Schreib-Workflow). Wird geladen, wenn die `description` triggert. | Pro Nutzer/Workspace/Projekt installiert |

## Wie greifen Skill und Connector ineinander?

- Der **MCP-Connector** liefert die *Tools* (`search_wiki`, `get_page`, …) und
  jetzt auch die server-seitigen *`instructions`* (siehe `../src/index.ts`). Die
  `instructions` sind das MCP-Pendant zu dem, was GitHubs oder Qontos MCP-Server
  bei claude.ai einblenden — sie stehen **immer** im Kontext, wenn der Connector
  aktiv ist, ganz ohne Skill.
- Das **Skill** ist ein `SKILL.md` mit YAML-Frontmatter. Claude liest nur die
  `description` aller verfügbaren Skills und **lädt den Body erst, wenn die
  Beschreibung zur Anfrage passt**. Deshalb ist die `description` das Wichtigste:
  sie muss die Trigger („Firma", „intern", „Wiki", „wie machen wir…", „wo
  steht…", Onboarding, Prozess, Doku …) auf Deutsch **und** Englisch abdecken.
- **Warum beides?** Die `instructions` garantieren die Grund-Reflex-Handlung
  („nimm das Wiki") für jeden. Das Skill liefert das ausführliche Verhalten
  (Suchmodus, Zitierformat, Read-before-edit, Scoping, Lösch-Rückfrage), ohne
  dauerhaft Kontext zu kosten, weil es nur bei Bedarf geladen wird.

## Installation in claude.ai

1. **Connector verbinden:** In claude.ai unter *Settings → Connectors* einen
   *Custom Connector* mit der MCP-URL `https://<mcp-host>/mcp` hinzufügen. Der
   OAuth-Login/Consent läuft automatisch gegen die Wiki-App (Authorization
   Server). Voraussetzung: der Tenant-Admin hat einen OAuth-Client mit den
   Scopes `knowledge:read` / `knowledge:write` und der claude.ai-Redirect-URI
   registriert (siehe Haupt-`README.md`, Abschnitt „App side").
2. **Skill installieren:** Den Ordner `skill/` als Skill hinterlegen — je nach
   Oberfläche als hochgeladenes Skill (Team/Workspace) oder, in Claude Code,
   unter `.claude/skills/company-wiki/SKILL.md`. Entscheidend ist, dass
   `SKILL.md` mit dem Frontmatter (`name`, `description`) am Skill-Pfad liegt.
3. **Testen:** „Wie läuft bei uns das Onboarding?" oder „Wo steht die Doku zu
   <Thema>?" → Claude sollte `whoami`/`search_wiki` aufrufen und mit
   `[[Seitentitel]]` belegte Antworten liefern.

## Was fehlt / wäre optimaler? (Empfehlungen an den MCP-Server)

Aus Sicht von „claude.ai soll das Wiki optimal nutzen" — sortiert nach Nutzen:

1. **Server-`instructions` (erledigt).** War der größte fehlende Hebel: der
   Server setzte bisher keine `instructions`, damit fehlte der Grund-Reflex. Jetzt
   in `src/instructions.ts` ergänzt und in `src/index.ts` verdrahtet.

2. **Suche defaultet auf `fulltext`.** `search_wiki` nutzt ohne `mode` nur
   Stichwortsuche — für eine LLM-getriebene Nutzung ist **`hybrid`** klar besser
   (findet auch bei anderer Wortwahl). Das Skill weist Claude an, `hybrid` aktiv
   zu setzen. *Optionale Code-Verbesserung:* Default serverseitig auf `hybrid`
   ziehen, wenn Embeddings aktiv sind, sonst sauber auf `fulltext` zurückfallen —
   dann ist es auch ohne Skill optimal.

3. **`append_to_page` fehlt.** Es gibt nur exaktes Find-&-Replace
   (`edit_page_content`). Für den häufigen Fall „hänge Notiz/Log/Eintrag unten an"
   ist ein reiner Append-Modus robuster und weniger fehleranfällig (kein `409`
   bei mehrdeutigem `oldString`).

4. **Seite per Titel/Slug auflösen.** Man muss immer erst suchen, um an eine `id`
   zu kommen. Ein `resolve_page`/`get_page_by_title` (auch zum Auflösen von
   `[[wikilinks]]`) spart Roundtrips und macht das Verlinken beim Schreiben
   zuverlässiger.

5. **„Zuletzt geändert" / Aktivitäts-Feed.** Für „was hat sich diese Woche
   geändert?" / „ist X noch aktuell?" gibt es tenant-weit keinen Einstieg
   (`get_page_history` ist pro Seite). Ein `list_recent_changes` wäre wertvoll.

6. **Batch-Read.** Ein `get_pages([ids])` (oder `search_wiki` mit optionalem
   Voll-Inhalt der Top-Treffer) reduziert die Anzahl der Read-Calls bei
   Recherchen über mehrere Seiten.

7. **Tags/Kategorien in Suche & Tree.** Falls das Datenmodell Tags kennt: als
   Filter in `search_wiki`/`list_pages` exponieren — hilft, große Wikis
   einzugrenzen.

8. **Antwortgröße begrenzen.** `get_page_subtree` (rekursiv) kann sehr groß
   werden. Ein optionales `maxDepth`/`maxChars` schützt das Kontextfenster.

Punkt 1 ist umgesetzt; 2–8 sind Vorschläge, die die reine Skill-Vorlage nicht
braucht, den Connector aber „LLM-optimaler" machen würden.
