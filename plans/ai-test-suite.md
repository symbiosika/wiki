# AI Test-Suite & Reward-System für den Wiki-Chat — Architektur-Abstract

**Zielgruppe:** ein Coding-Agent, der das Feature umsetzt.
**Ebene:** Architektur und Konzept — bewusst ohne Code-Tiefe. Alle genannten
Bestandsdateien sind Einstiegspunkte bzw. Blaupausen, keine fertigen Diffs.

---

## 1. Ziel

Der Wiki-AI-Chat (`POST /api/v1/tenant/:tenantId/chat`) soll automatisiert
testbar werden. Es gibt eine Liste realer Kundenfragen. Für jede Frage soll
ein Test-Run prüfen und bewerten ("Reward"):

1. **Prozess:** Hat das LLM die Wiki-Tools ordentlich genutzt (gesucht,
   Seiten gelesen, nicht im Kreis gedreht)?
2. **Evidenz:** Ist jede Aussage der Antwort durch die Tool-Outputs gedeckt —
   oder kam sie aus dem Allgemeinwissen des Modells (Halluzination)?
3. **Ergebnis:** Beantwortet die Antwort die Frage, in der richtigen Sprache,
   mit Quellenangaben?

Testfragen werden in der DB gepflegt (tenant-scoped), Runs werden über eine
Admin-UI gestartet und laufen serverseitig als Background-Job. Ergebnisse
(Antwort, kompletter Tool-Verlauf, Scores, Judge-Begründungen) sind in der UI
einsehbar. Zweck ist **Regressionsmessung über Zeit**: nach jeder Änderung an
Prompt, Modell, Tools oder Wiki-Inhalt denselben Run wiederholen und pro Frage
sehen, was kippte.

## 2. System under Test — Produktions-Parität ist Pflicht

Der produktive Chat ist ein Tool-Agent:
`backend/src/routes/tenant/[tenantId]/chat/index.ts` ruft `streamText` mit
Modell (`getModel()`, OpenRouter, `backend/src/ai/index.ts`), System-Prompt
(`buildWikiChatSystemPrompt`) und Wiki-Tools (`createWikiChatTools`:
`search_wiki`, `list_wiki_pages`, `read_wiki_page`, `get_related_wiki_pages`)
aus `backend/src/ai/tools/wiki/index.ts` auf, Step-Limit 10.

**Architektur-Regel:** Der Test-Runner darf KEIN Parallelsystem sein. Die
Agent-Konfiguration (Modell + System-Prompt + Tools + Step-Limit +
Output-Token-Limit) wird in einen kleinen Shared-Helper extrahiert, den die
Chat-Route (`streamText`) und der Test-Runner (`generateText`,
non-streaming) gemeinsam nutzen. So können Produktion und Test nie
auseinanderlaufen. Der Runner läuft im Read-Mode und mit den Rechten des
Users, der den Run gestartet hat (die Tools erzwingen Sichtbarkeitsrechte
serverseitig — ein Run sieht genau das, was dieser User sieht).

`generateText` liefert `text`, `steps` (Tool-Calls + Tool-Results) und
`totalUsage` — daraus entsteht die **Trajectory**, die Grundlage jeder
Bewertung.

Kein Chat-Modell-Override pro Suite (getestet wird exakt Produktion). Nur das
**Judge-Modell** ist pro Suite überschreibbar.

## 3. Reward-Konzept (der fachliche Kern)

### 3.1 Signal-Schichten

**Schicht A — deterministische Checks (Code, kein LLM), Score `toolUsage` 0–1:**
mind. eine Suche; mind. ein `read_wiki_page`; Abzüge für fehlgeschlagene und
exakt duplizierte Tool-Calls; null Tool-Calls ⇒ 0. Zusätzlich erfasst (ohne
Score): Dauer, Tokenverbrauch, Schrittzahl.

**Schicht B — LLM-as-Judge, max. 2 strukturierte LLM-Calls pro Frage:**

- *Call 1 (kombiniert):* Relevanz 0–1 mit Begründung; Flag
  `saysWikiHasNoAnswer`; **Claim-Dekomposition** — die Antwort wird in atomare
  Tatsachenaussagen zerlegt; falls Soll-Fakten hinterlegt: deren Abdeckung;
  kurzes Trajectory-Urteil.
- *Call 2 (nur wenn Claims existieren):* jeder Claim wird gegen die
  konkatenierten Tool-Outputs geprüft: `supported | unsupported |
  contradicted`. Harte Judge-Regel im Prompt: **Nur die Tool-Outputs zählen
  als Wahrheit, eigenes Weltwissen des Judge zählt nicht.**
  `groundedness` = Anteil `supported`; `unsupported` ⇒ Modellwissen-Verdacht.

Designprinzip: viele kleine ternäre/binäre Urteile mit Begründungspflicht
statt einer freien 1–10-Note — reproduzierbar und in der UI nachvollziehbar.
Judge-Aufrufe über die vorhandene AI-Infrastruktur (`generateObject` mit
Valibot-Schema und `getModel(judgeModelId)`; Hinweis: das bestehende
`generateStructured` hardcodet das Standardmodell und liefert keine Usage —
für den Judge nicht verwenden).

**Schicht C — optionale Referenzdaten pro Frage (kein Pflichtfeld):**
erwartete Quellseiten (Recall: gelesene pageIds ∩ erwartete — rein
deterministisch aus der Trajectory) und 2–5 Soll-Fakten (Abdeckung via Judge
Call 1). Volle Musterantworten sind bewusst NICHT vorgesehen.

### 3.2 Fragetypen (Behavior Classes)

Jede Testfrage hat einen Typ, weil "richtiges Verhalten" typabhängig ist:

| Typ | Erwartetes Verhalten |
|---|---|
| `answerable` | suchen → lesen → antworten → Seiten zitieren |
| `synthesis` | mehrere Seiten lesen und zusammenführen |
| `not-in-wiki` | nach echter Suche ehrlich "steht nicht im Wiki" sagen |
| `ambiguous` | rückfragen oder Annahmen explizit machen |

`not-in-wiki` ist der direkteste Halluzinationstest: plausible Fragen, deren
Antwort das Modell wüsste, das Wiki aber nicht enthält. Inhaltliche Antwort
⇒ ungrounded. Sonderfall in der Bewertung: ehrliches "keine Info" nach
echter Suche (`saysWikiHasNoAnswer`, keine Claims, gesucht) ⇒
`groundedness = 1.0`, Flag `noAnswerCase`.

### 3.3 Scoring

- Pro Frage: `total = 0.25·toolUsage + 0.45·groundedness + 0.30·relevance`;
  mit Referenzdaten: `0.8·total + 0.2·mean(Referenz-Scores)`.
- **Hard Gates schlagen die Gewichtung** — automatisch `fail`, egal wie gut
  der Rest: ein `contradicted`-Claim; eine zitierte Seite, die in der
  Trajectory nicht vorkommt (erfundene Quelle); inhaltliche Antwort ganz ohne
  Tool-Call; inhaltliche Antwort auf eine `not-in-wiki`-Frage.
- Verdict pro Frage: `pass ≥ 0.75`, `warn ≥ 0.5`, sonst `fail`.
- Pro Run: Mittelwerte je Metrik, Pass-Rate, Anzahl Hard-Gate-Fails —
  zusätzlich **je Fragetyp getrennt** aggregiert.
- Alle Judge-Begründungen und Claim-Verdicts werden gespeichert (UI-Drilldown
  und spätere Judge-Kalibrierung gegen Hand-Labels).

## 4. Architektur der Umsetzung

**Gesamtmuster:** vertikaler Slice exakt nach der vorhandenen
`url-import`-Blaupause (dort ist jedes Pattern bereits vorgeführt):
`backend/src/db/schema.ts` (org-scoped Tabellen, Prefix `app_`),
`backend/src/lib/url-import/` (CRUD + Runner), durable Job-Queue
(`backend/framework/src/lib/jobs/`), Routen
`backend/src/routes/tenant/[tenantId]/url-import/` (Middleware-Kette
`authAndSetUsersInfo` → valibot-Validation → `isTenantMember`; Run-Trigger
antwortet 202), Wiring in `backend/src/index.ts` (`customHonoAppsWithAuth` +
`jobHandlers`), Frontend-Store/Views nach `stores/urlImportJobs.ts` +
`views/jobs/`.

**Datenmodell (4 Tabellen, alle org-scoped):**

1. **Suite** — Name, Beschreibung, optionales Judge-Modell, optionales
   Step-Limit, `lastRun`-Stempel.
2. **Frage** — Suite-FK, Fragetext, Typ (siehe 3.2), optionale erwartete
   Seiten-IDs, optionale Soll-Fakten, aktiv/inaktiv, Sortierung.
3. **Run** — Suite-FK, Status `running | success | partial | error |
   cancelled`, Zähler, `startedBy` (Pflicht — bestimmt die Tool-Rechte),
   Aggregate (jsonb), Token-Summen, Zeitstempel.
4. **Ergebnis** — **eigene Tabelle**, nicht jsonb-Array am Run (Trajectories
   und Judge-Reports sind groß; die UI braucht Drilldown pro Frage; Zeitreihen
   pro Frage brauchen `WHERE question_id = …`). Felder: Run-FK, Frage-FK
   (`on delete set null`) **plus Frage-Snapshot als Text** (Zeitreihen
   überleben Frage-Löschung/-Edit), Antwort, Trajectory (jsonb, Tool-Outputs
   gekürzt speichern, z.B. 4 000 Zeichen — der Groundedness-Judge nutzt vorher
   die ungekürzten in-memory), Scores, Verdict, Judge-Report, Usage, Dauer,
   Fehler.

**Ablauf eines Runs:**

1. UI → `POST …/suites/:id/run` → Run-Row (`running`) + Job in der Queue,
   Antwort 202. Doppelstart-Guard: läuft schon ein Run der Suite, wird der
   zurückgegeben statt ein neuer gestartet.
2. Job-Handler arbeitet die aktiven Fragen **sequenziell** ab (kleine Listen,
   schont Rate-Limits, triviale Live-Progress-Semantik). Pro Frage:
   kooperativer Cancel-Check (Run-Status re-lesen) → Agent-Call mit Timeout
   (~120 s) → Trajectory bauen → Reward-Pipeline (3.1–3.3) → Ergebnis-Row
   inserten + Run-Zähler updaten (inkrementell, damit die UI live pollen
   kann). Ein Fehler bei einer Frage bricht den Run nie ab (try/catch pro
   Frage).
3. Terminal: Aggregate berechnen, Run-Status `success | partial | error`
   (bzw. `cancelled`), `lastRun`-Stempel auf die Suite.

**API (unter `/tenant/:tenantId/ai-tests`):** Suite-CRUD; Fragenliste
ersetzen (id-erhaltend, damit Zeitreihen-Verknüpfungen Edits überleben);
**Bulk-Import** `{ text }` mit einer Frage pro Zeile (dafür ist die
Kundenfragen-Liste da); Run starten (202) / Historie / Run-Detail mit
Ergebnissen / Cancel / Run löschen. Sinnvolle Limits (Fragenlänge, Fragen pro
Suite, Bulk-Textgröße).

**Frontend (3 Views + Store + Router-Einträge + Sidebar-Link):**

- *Suite-Liste:* DataTable mit letztem Run-Status + Score, Create-Dialog.
- *Suite-Detail:* Einstellungen, Fragen-Editor (inkl. Typ + Referenzdaten,
  Bulk-Add-Dialog "eine Frage pro Zeile"), Run-Button, Run-Historie mit
  Aggregat-Spalten.
- *Run-Detail:* Statuskopf mit Aggregat-Chips und Cancel; Polling (~3 s)
  solange `running`; Ergebnis-Tabelle mit Verdict-Ampel und aufklappbaren
  Zeilen: volle Antwort, Claims mit Verdicts, Judge-Begründungen (inkl.
  Flags `generalKnowledgeSuspected` / `noAnswerCase` / Hard-Gate-Grund),
  Trajectory Schritt für Schritt (Tool, Input, aufklappbarer Output).

## 5. Tests & Verifikation

- **Dev-Stub** nach Repo-Konvention (`PROTOCOL_DEV_STUB`-Muster, z.B.
  `AI_TESTS_DEV_STUB=true`, beim Import gelesen): Agent liefert feste Antwort
  + Fake-Trajectory, Judge feste Scores — Routen-Tests laufen deterministisch
  ohne LLM.
- Reward-Heuristiken (Schicht A, Recall, Gewichtung, Hard Gates,
  `noAnswerCase`) als reine Unit-Tests ohne LLM.
- Routen-Test nach url-import-Vorbild (`initTests()` + `testFetcher`,
  Cross-Tenant-403, CRUD, Bulk, Run starten → Queue drainen mit
  `processDueJobsOnce()` → Ergebnisse und Aggregate prüfen).
- Chat-Route-Regression: die Helper-Extraktion ist eine reine Umformung —
  Verhalten des produktiven Chats unverändert.
- End-to-End (wenn `OPENROUTER_API_KEY` vorhanden): Suite anlegen, 2–3 Fragen
  (davon eine `not-in-wiki`), Run starten, in der UI Live-Progress, Scores,
  Claims und Trajectory prüfen.

## 6. Risiken & bewusste Entscheidungen

- **Judge-Vertrauen:** Judge-Modell idealerweise ≠ Chat-Modell und stärker
  (Self-Preference-Bias) — deshalb der per-Suite-Override. Später:
  Kalibrierung gegen ~15 Hand-Labels und ein "Judge-Widerspruch"-Knopf in der
  UI; für V1 out of scope.
- **Varianz:** LLM-Ausgaben schwanken; kleine Score-Differenzen zwischen zwei
  Runs nicht überinterpretieren. Mehrfach-Runs zur Varianzmessung sind eine
  Ausbaustufe.
- **Kosten:** pro Frage 1 Agent-Call + max. 2 Judge-Calls; sequenzielle
  Ausführung und Fragen-Limit pro Suite begrenzen Runs natürlich.
- **V1-Scope:** Fragetypen `answerable` + `not-in-wiki` reichen zum Start;
  `synthesis`/`ambiguous`, geplante (nightly) Runs, Human-Kalibrierung und
  Varianz-Runs sind Ausbaustufen.

## 7. Research-Basis

- TruLens **RAG Triad** (Groundedness / Answer Relevance / Context Relevance)
  und **RAGAS** (Faithfulness via Claim-Dekomposition) — referenzfreie
  RAG-Bewertung.
- **Trajectory Evaluation** (u.a. TRAJECT-Bench): Tool-Pfad bewerten, nicht
  nur die Endantwort.
- LLM-as-Judge-Literatur: strukturierte Rubriken, ternäre Urteile,
  Begründungspflicht, Bias-Risiken (Self-Preference, Verbosity),
  Kalibrierung gegen Human Labels.
- Abstention-Evaluation ("known unknowns"): Negativfragen als
  Halluzinationstest.
