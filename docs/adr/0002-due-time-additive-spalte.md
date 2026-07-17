# `due_time` als additive Spalte

**Status**: accepted

Items vom Typ `list_due_date` erhalten eine optionale Uhrzeit über eine neue Spalte `due_time TEXT NOT NULL DEFAULT ''`. Der leere String bedeutet „keine Uhrzeit" und folgt damit dem bestehenden Muster von `due_date TEXT NOT NULL DEFAULT ''`.

## Considered Options

- **Neue Spalte `due_time`**: bestehende Queries auf `due_date` bleiben unverändert; Migration ist ein einzelnes `ALTER TABLE … ADD COLUMN`.
- **`due_date` zu Datetime-String falten** (`YYYY-MM-DD` oder `YYYY-MM-DD HH:MM`): zwingt jede bestehende Query, beide Formate zu parsen — Spec-Drift und Fehlerquelle.
- **Separater Boolean `has_due_time` plus `due_time`**: redundant, weil der leere String in `due_time` bereits die Information trägt.

## Consequences

- Additive Migration in `db.php` mit `schema_version`-Bump.
- Heute-Sicht-Queries gewinnen eine `due_time`-Klausel für die Aufteilung in „Terminiert" und „Irgendwann heute".
- Quick-Add schreibt beide Spalten atomar in derselben API-Operation.
- Index-Strategie: kein neuer Index nötig — die Heute-Sicht filtert zuerst über `due_date` und gruppiert dann clientseitig nach `due_time`.