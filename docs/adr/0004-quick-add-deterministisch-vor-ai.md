# Quick-Add: deterministischer Parser vor AI-Eskalation

**Status**: accepted

Quick-Add (Parchment-Plan, Idee #4) versucht bei jedem Submit zuerst den lokalen, deterministischen Parser (Vokabular: `heute` / `morgen` / `übermorgen`, optional `HH:MM` oder `HH Uhr`; Token `/kategorie` und `!1`–`!3`). Nur wenn der Parser ein Token nicht auflösen kann oder die Eingabe mehrdeutig ist, eskaliert Quick-Add explizit an die Magic Bar (Gemini). Ohne Gemini-Key bleibt Quick-Add mit deterministischer Funktionalität voll nutzbar.

## Considered Options

- **Deterministisch zuerst, AI nur bei Mehrdeutigkeit**: passt zur Projektlinie „so wenig Funktionen wie möglich vom AI-Key abhängig" (`CLAUDE.md`).
- **AI ersetzt deterministischen Parser**: ständige Latenz- und Verfügbarkeits-Abhängigkeit, Offline-Fallback nötig.
- **Zwei parallele Add-Modi**: verdoppelt UI, zwingt Nutzer zur wiederholten Modus-Wahl.

## Consequences

- Quick-Add ersetzt die bestehende „+"-Schaltfläche in jeder Kategorie und in Heute.
- Bei Mehrdeutigkeit zeigt das Eingabefeld einen Hinweis und einen Button „Mit AI klären", der an die bestehende Magic Bar weiterleitet (kein neuer AI-Pfad).
- Magic Bar bleibt als eigener AI-only-Modus erhalten (Komplement, nicht Ersatz).
- Unbekannte Kategorie über `/kategorie`: harter Fehler, kein Auto-Create — verhindert Tippo-Geister-Kategorien.
- Aktive Kategorie wird Default, wenn `/kategorie` fehlt; priority, due_date und due_time defaulten auf leer, wenn die jeweilige Phrase fehlt.