# Ankerkladde

Mobile-freundliche PHP+SQLite-Webapp für Listen, Aufgaben, Notizen, Bilder, Dateien und Links.

## Language

**Heute-Sicht**:
Eine kategorieübergreifende Agenda-Ansicht über alle `list_due_date`-Kategorien des Nutzers. Zeigt ausschließlich Items mit `done = 0` und `due_date != ''` und `due_date <= today` (Europe/Berlin, server-seitig berechnet). Überfällige Items (`due_date < today`) sind eingeschlossen und werden als solche markiert. Items ohne `due_date` werden in dieser Sicht nicht angezeigt; erledigte Items sind ausgeblendet.
_Avoid_: Tagesansicht, Dashboard, Inbox

**Fällig**:
Ein Item in einer `list_due_date`-Kategorie, dessen `due_date` auf heute oder davor liegt und das nicht erledigt ist (`done = 0`).
_Avoid_: Überfällig (siehe unten)

**Überfällig**:
Ein fälliges Item, dessen `due_date` strikt vor heute liegt.
_Avoid_: Verspätet, über die Zeit

**Terminiert**:
Ein fälliges Item vom Typ `list_due_date`, dessen `due_time != ''` ist — d. h. mit fester Uhrzeit versehen. In der Heute-Sicht eigener, oben angeordneter Block, sortiert nach `due_time` aufsteigend.
_Avoid_: Fest terminiert, mit Uhrzeit

**Irgendwann heute**:
Ein fälliges Item vom Typ `list_due_date` mit `due_date = today` und leerem `due_time`. In der Heute-Sicht eigener Block unter „Terminiert", sortiert nach `sort_order`.
_Avoid_: Ohne Uhrzeit, Ganztägig

**Aufbau der Heute-Sicht** (gilt für fällige Items):
1. Überfällig (`due_date < today`) — ältestes zuerst.
2. Terminiert (`due_date = today`, `due_time != ''`) — nach Uhrzeit aufsteigend.
3. Irgendwann heute (`due_date = today`, `due_time = ''`) — nach `sort_order`.

**`due_time`**:
Optionale Uhrzeit auf Items vom Typ `list_due_date`, additive Spalte `due_time TEXT NOT NULL DEFAULT ''` (leerer String = keine Uhrzeit). Wird nie ohne `due_date` gesetzt.

**Journal**:
Vom System automatisch angelegte, einzelne Kategorie vom Typ `daily_notes` pro Nutzer, sichtbar als eigener Tab. Nicht vom Nutzer umbenannt (YAGNI), nicht löschbar; bei Beschädigung wird sie vom System neu angelegt.
_Avoid_: Tagebuch, Logbuch

**Tagesnotiz**:
Ein Item in der Journal-Kategorie. Pro Datum existiert höchstens ein Item; wird beim ersten Speichern angelegt (nicht beim ersten Öffnen). Speicherung als reguläres Item mit TipTap-Content in der Journal-Kategorie; `due_date` enthält das Datum der Notiz.
_Avoid_: Journaleintrag, Tages-Eintrag

**Priorität**:
Optionale Markierung auf Items vom Typ `list_due_date` und `list_quantity`. Werte: `!1` = hoch, `!2` = mittel, `!3` = niedrig. Kein `!` = keine Priorität. Additive Spalte `priority TEXT NOT NULL DEFAULT ''` (leerer String = keine Priorität).
_Avoid_: Wichtigkeit, Dringlichkeit

**Quick-Add**:
Eingabefeld in jeder `list_due_date`- und `list_quantity`-Kategorie sowie in Heute, das beim Submit zuerst einen deterministischen Parser laufen lässt (Vokabular siehe ADR-0004). Bei Mehrdeutigkeit eskaliert es explizit an die Magic Bar.
_Avoid_: Schnell-Add, Quick Input

**Magic Bar**:
Bestehendes AI-gestütztes Eingabefeld (Gemini), das als Eskalationsziel für Quick-Add dient und parallel als eigenständiger AI-only-Modus erhalten bleibt.

**Deep-Link**:
Aus der Heute-Sicht heraus: Tap auf einen Agenda-Eintrag navigiert in die Quell-Kategorie, scrollt zum Item und blendet es für 1,5 s gelb hinterlegt ein. Read-only in Heute — Mark-as-Done erfolgt in der Kategorie.