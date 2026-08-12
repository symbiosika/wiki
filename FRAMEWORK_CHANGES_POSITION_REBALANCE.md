# Framework-Änderung — Wachstum der fractional-index Sortierschlüssel begrenzen

**Ziel-Repo:** `symbiosika/symbiosika-framework` (das Submodul
`backend/framework`). **Nicht** `symbiosika/wiki`.

> ## STATUS: umgesetzt und lokal getestet
>
> Die Änderung liegt **im lokalen Working Tree des Submoduls
> `backend/framework`** und ist verifiziert:
> `bun run test:local ./framework/src/lib/utils/fractional-index.test.ts` → 20 pass,
> `bun run test:local "./framework/src/routes/tenant/[tenantId]/knowledge/texts/blocks.test.ts"` → 11 pass,
> `bun run test:local ./framework/src/lib/knowledge/` → 409 pass / 9 skip / 0 fail,
> `bun run typecheck` sauber.
>
> **Zeilengenauer Export:** `framework-position-rebalance.patch` im Wurzel-
> verzeichnis des Wiki-Repos ist ein `git diff` exakt dieser Änderungen
> (5 Dateien, nur Quellcode — die Migration wird generiert, siehe unten).
>
> **⚠️ Submodul-Pointer:** Die Session hat nur Zugriff auf `symbiosika/wiki`,
> der Framework-Commit wurde deshalb nicht gepusht und der Submodul-Pointer im
> Wiki-Repo bleibt **unverändert**. Solange die Änderung nicht upstream gelandet
> und der Pointer nicht angehoben ist, enthält das deployte Backend sie
> **nicht** — CI baut den gepinnten Submodul-SHA. Was aus dem Wiki-Repo heute
> ausgeliefert wird, ist die Spaltenverbreiterung (App-Migration
> `0008_widen_knowledge_position.sql`); die macht die kaputten Seiten wieder
> speicherbar. Diese Änderung hier sorgt dafür, dass sie gar nicht erst wieder
> in den Zustand geraten.

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

## Die Änderung

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

   Das bricht bewusst die Eigenschaft „unveränderte Liste ⇒ keine Schreibvorgänge"
   *oberhalb der Schwelle*: der Aufrufer schreibt dann einmalig jede Zeile.
   Im Docstring dokumentiert.

3. **`src/lib/knowledge/knowledge-text-blocks.ts`** — das Speichern der Blöcke
   übersteht jetzt eine komplette Neuverschlüsselung:
   - **Zwischenschlüssel-Durchlauf.** `knowledge_text_block_page_position_idx`
     ist ein gewöhnlicher (nicht deferrable) Unique-Index und wird deshalb pro
     Zeile geprüft. Eine Permutation — zwei getauschte Blöcke oder ein Rebalance,
     das alles neu schreibt — lässt sich nicht Zeile für Zeile anwenden, weil die
     erste Zeile auf einem Schlüssel landet, den ihr Nachbar noch hält. Jede
     Zeile, deren Position sich ändert, wird deshalb zuerst auf `~<token>-<i>`
     geparkt: `~` liegt außerhalb des Schlüssel-Alphabets (`^[a-z]+$`) und kann
     daher nie mit einem echten Schlüssel kollidieren, und das zufällige Token
     hält zwei überlappende Transaktionen auseinander.
   - **Row-Lock pro Seite.** Die Transaktion beginnt mit `SELECT … FOR UPDATE`
     auf der `knowledge_text`-Zeile, damit zwei gleichzeitige Speichervorgänge
     derselben Seite serialisiert werden, statt sich auf dem Unique-Index zu
     überholen.

4. Tests für beides (`fractional-index.test.ts`, `blocks.test.ts`), inklusive
   einem End-to-End-Speichern einer Seite mit 300 Blöcken und dem Speichern
   einer Seite, deren gespeicherte Schlüssel bereits zu lang sind.

## Upstream anwenden

```bash
cd backend/framework
git checkout -b claude/position-key-rebalance
git apply ../../framework-position-rebalance.patch
bun run generate          # erzeugt Migration + Snapshot für die Schema-Änderung
bun test src/lib/utils/fractional-index.test.ts
git add -A && git commit -m "fix(knowledge): bound fractional-index key growth (blocks + page order)"
git push -u origin claude/position-key-rebalance
```

Die generierte Migration ist exakt:

```sql
ALTER TABLE "base_knowledge_text" ALTER COLUMN "position" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "base_knowledge_text_block" ALTER COLUMN "position" SET DATA TYPE text;
```

also dasselbe DDL, das das Wiki-Repo bereits in
`backend/drizzle-sql/0008_widen_knowledge_position.sql` ausliefert. Ein zweites
Anwenden ist ein No-op, die beiden können also in beliebiger Reihenfolge landen.

Nachdem der Framework-Commit gemergt ist: Submodul-Pointer in `symbiosika/wiki`
anheben und diese Datei samt Patch löschen.

## Was das Wiki-Repo in der Zwischenzeit mitbringt

- `backend/drizzle-sql/0008_widen_knowledge_position.sql` — die Verbreiterung,
  damit kaputte Seiten mit dem nächsten Deploy wieder speicherbar sind, ohne auf
  ein Framework-Release zu warten.
- `backend/src/lib/wiki/rebalance-positions.ts` + `bun run wiki:rebalance-positions`
  — einmalige Kompaktierung von Seiten, deren Schlüssel bereits lang geworden
  sind.
- `backend/src/lib/wiki/move.ts` — die Schreibvorgänge beim Umsortieren von
  Geschwisterseiten laufen jetzt in einer Transaktion, da ein Rebalance alle
  Geschwister auf einmal neu verschlüsseln kann und ein Teilschreiben die
  Reihenfolge zerreißen würde.
