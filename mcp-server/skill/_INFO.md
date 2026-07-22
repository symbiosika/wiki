# Hinweis für die Installation / Anpassung

## Kundennamen anpassen (Suchen & Ersetzen)

Der Wiki-Name ist bei jedem Kunden individuell (der MCP-Connector-Name). In der
`SKILL.md` steht dafür durchgängig der Platzhalter:

```
Firmen-Wiki
```

Vor der Auslieferung an einen Kunden diesen Platzhalter per **Suchen & Ersetzen**
gegen den echten MCP-Connector-Namen des Kunden austauschen (z. B. `ACME-Wissen`,
`Muster-Wiki`, …).

- Betrifft nur den **Anzeigenamen im Text** (Description + Prosa) — die Tool-Namen
  selbst (`search_wiki`, `get_page`, …) sind bei allen Kunden gleich und bleiben
  unverändert.
- Der Skill-`name:` im Frontmatter (`company-wiki`) ist ein generischer Slug und
  muss **nicht** angepasst werden.

Einmal ersetzen genügt — es gibt keinen weiteren kundenspezifischen Wert im Skill.
