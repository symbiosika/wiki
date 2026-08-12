# Framework-Änderung — Wachstum der fractional-index Sortierschlüssel begrenzen

**Ziel-Repo:** `symbiosika/symbiosika-framework` (das Submodul
`backend/framework`). **Nicht** `symbiosika/wiki`.

> ## STATUS: als PR offen
>
> [symbiosika/symbiosika-framework#122](https://github.com/symbiosika/symbiosika-framework/pull/122)
>
> **⚠️ Submodul-Pointer:** Solange PR #122 nicht gemergt und der Submodul-
> Pointer in `symbiosika/wiki` nicht angehoben ist, bleibt `position`
> `varchar(64)` und der Fehler kann erneut auftreten. Bis dahin repariert
> `bun run wiki:rebalance-positions` bereits blockierte Seiten (siehe unten);
> das braucht keine Schemaänderung, weil es Schlüssel nur verkürzt.
>
> Nachdem PR #122 gemergt ist: Submodul-Pointer in `symbiosika/wiki`
> anheben und diese Datei löschen.

## Der Fehler

Wiki-Seiteninhalte liegen als `base_knowledge_text_block`-Zeilen, sortiert über
`position` — einen fractional-index Schlüssel aus `assignPositions`
(`src/lib/utils/fractional-index.ts`). Neue Schlüssel entstehen immer *zwischen*
zwei Nachbarn, und Anhängen heißt „zwischen dem letzten Schlüssel und dem
Listenende" — was den Schlüssel je vier angehängter Blöcke um etwa ein Zeichen
verlängert.

`position` war `varchar(64)`. Bei ~257 Blöcken erreichte der erzeugte Schlüssel
also 65 Zeichen, Postgres wies das INSERT in `syncKnowledgeTextBlocks` ab
(„value too long for type character varying(64)"), und der Catch-all der Route
machte daraus **HTTP 400 bei jedem weiteren Speichern** — die Seite war dauerhaft
nicht mehr editierbar. Gemessen an der echten Implementierung:

| Blöcke | längster Schlüssel |
|---|---|
| 200 | 50 Zeichen |
| 256 | 64 Zeichen — genau am alten Limit |
| 257 | 65 Zeichen — erster fehlschlagender Block |
| 461 | 116 Zeichen |

In Produktion aufgetreten bei einer Seite mit 461 Blöcken (Tenant `c96798ed…`).
Dasselbe Wachstum gilt für `base_knowledge_text.position` (Sortierung im
Wiki-Baum), wo ein Elternknoten mit 257+ Kindern hineingelaufen wäre.

## Die Änderung (in PR #122)

1. **`src/lib/db/schema/knowledge.ts`** — beide `position`-Spalten werden `text`
   statt `varchar(64)`. Eine Längenbegrenzung auf einem monoton wachsenden
   Schlüssel verwandelt das Wachstum in einen harten Schreibfehler; gebracht hat
   die Begrenzung nichts.

2. **`src/lib/utils/fractional-index.ts`** — neue exportierte Konstante
   `MAX_KEY_LENGTH_BEFORE_REBALANCE = 32`. Überschreiten die Schlüssel, die
   `assignPositions` zurückgeben würde, diesen Wert, wird stattdessen die
   gesamte Liste mit `generateNKeysBetween` kompakt neu verschlüsselt
   (3 Zeichen für 1000 Einträge, 4 für 5000). Das Wachstum startet wieder von
   einer kleinen Basis; gemessen tritt ein Rebalance danach etwa alle 120
   angehängten Blöcke auf.

3. **`src/lib/knowledge/knowledge-text-blocks.ts`** — das Speichern der Blöcke
   übersteht jetzt eine komplette Neuverschlüsselung: ein Row-Lock pro Seite
   serialisiert gleichzeitige Speichervorgänge, und jede Zeile, deren Position
   sich ändert, wird zuerst auf einen temporären Schlüssel geparkt, damit die
   Permutation nicht am Unique-Index (`page`, `position`) scheitert.

4. Migration `drizzle-sql/0041_faulty_whizzer.sql` — verbreitert die Spalten
   auf `text`. Landet erst mit dem Framework-Release, wenn der Submodul-
   Pointer angehoben wird; das Wiki-Repo liefert keine eigene Kopie davon
   (siehe unten, warum das nicht nötig ist).

Details, Tests und Review: siehe PR #122.

## Was das Wiki-Repo in der Zwischenzeit mitbringt

- `backend/src/lib/wiki/rebalance-positions.ts` + `bun run wiki:rebalance-positions`
  — kompaktiert Seiten, deren Schlüssel bereits lang geworden sind, auf
  kurze Schlüssel zurück. Braucht keine Schemaänderung (verkürzen passt immer
  in `varchar(64)`) und macht blockierte Seiten damit sofort wieder speicherbar,
  ohne auf das Framework-Release zu warten. Postponed nur den Fehler: ohne
  PR #122 wachsen die Schlüssel danach erneut und das Script muss
  gelegentlich wiederholt laufen.
- `backend/src/lib/wiki/move.ts` — die Schreibvorgänge beim Umsortieren von
  Geschwisterseiten laufen jetzt in einer Transaktion, da ein Rebalance alle
  Geschwister auf einmal neu verschlüsseln kann und ein Teilschreiben die
  Reihenfolge zerreißen würde.
