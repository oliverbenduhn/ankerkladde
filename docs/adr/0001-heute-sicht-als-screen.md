# Heute-Sicht als eigener Screen

**Status**: accepted

Die Heute-Sicht (Parchment-Plan, Idee #1) wird ein eigener Top-Level-Screen im Navigationsbaum, gleichberechtigt mit `list`, `search`, `settings` und `scanner` — nicht ein Modus über der aktiven Kategorie, kein Default-Landing, kein Modal.

## Considered Options

- **Eigener Screen**: klare Adresse (`/heute`), Manifest-Shortcut, PWA-Badge-Hook alle natürlich.
- **Default-Landing**: verschiebt das mentale Modell der App von „liste-zentriert" zu „agenda-zentriert"; lässt sich später nachrüsten, falls überhaupt gewünscht.
- **Modus über Kategorie**: widerspricht der Screen/Modus-Trennung aus `ui_overhaul.md` und macht das Feature unsichtbar, wenn der Nutzer in `notes`, `links` etc. arbeitet.

## Consequences

- Neuer Tab in der Bottom-Bar mit Label „Heute" und eigenem Icon.
- PWA-Manifest erhält einen entsprechenden `shortcuts`-Eintrag.
- Heute-Sicht ist read-only — Mark-as-Done erfolgt ausschließlich in der Kategorie via Deep-Link mit 1,5 s Highlight.
- Server-berechneter Cutoff in `Europe/Berlin` (passt zum bestehenden `date_default_timezone_set` in `db.php`).