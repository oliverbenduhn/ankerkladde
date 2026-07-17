# `daily_notes` als neuer Kategorie-Typ

**Status**: accepted

Tagesnotizen werden ein neuer `CATEGORY_TYPE` mit dem Wert `daily_notes`, getrennt vom bestehenden `notes`-Typ. Pro Nutzer existiert genau eine Kategorie dieses Typs; sie wird vom System angelegt und im UI als Tab „Journal" sichtbar gemacht. Das Datum der Notiz wird im `due_date`-Feld des Items gespeichert (semantische Überladung: Datums-Key für `daily_notes`, Frist für `list_due_date`).

## Considered Options

- **Neuer Typ `daily_notes`, einer pro Nutzer**: klare Domänentrennung — `notes` ist Freitext-Kategorie, `daily_notes` ist Datums-Index.
- **Konvention auf `notes`**: keine Schema-Änderung, aber Strukturierungspflicht beim Nutzer (Datums-Präfix im Namen) — genau das, was Parchment vermeidet.
- **Mehrere `daily_notes`-Kategorien pro Nutzer** (Privat-Journal, Arbeit-Logbuch): verdoppelt UI-Komplexität ohne klaren Nutzenbeleg; aktuelles YAGNI.

## Consequences

- `CATEGORY_TYPES` in `src/Constants.php` wird um `daily_notes` erweitert.
- Bei erstem Zugriff legt das System die Journal-Kategorie an; nicht löschbar in v1 (YAGNI für Umbenennungs- und Lösch-UI).
- TipTap-Editor wird **pro Item** instanziiert (nicht pro Kategorie wie bei `notes`) — das bestehende `notes`-Editor-Modell reicht nicht.
- `due_date`-Semantik ist typ-abhängig: bei `list_due_date` ist es Frist, bei `daily_notes` ist es Notiz-Datum. Diese Überladung wird in `CONTEXT.md` dokumentiert.