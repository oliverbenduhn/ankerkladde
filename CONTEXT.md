# Ankerkladde

Mobile-freundliche PHP+SQLite-Webapp für Listen, Aufgaben, Notizen, Bilder, Dateien und Links.

## Language

**Tagesansicht**:
Eine datumszentrierte Ansicht, die die kategorieübergreifende Agenda und die Tagesnotiz für dasselbe gewählte Datum zusammenführt; wählbar sind heute, gestern, morgen und freie Daten. Am tatsächlichen heutigen Datum schließt die Agenda Überfälliges ein, für jedes andere Datum ausschließlich Items mit genau diesem Datum.
_Avoid_: Heute-Sicht, Dashboard, Inbox

**Heute**:
Der aktuelle Kalendertag in `Europe/Berlin`, serverseitig bestimmt. Agenda, Überfälligkeit, Badge und Quick-Add verwenden gemeinsam dieses Datum statt der Gerätezeitzone.
_Avoid_: lokales Gerätedatum

**Fällig**:
Ein Item in einer `list_due_date`-Kategorie, dessen `due_date` auf heute oder davor liegt und das nicht erledigt ist (`done = 0`).
_Avoid_: Überfällig (siehe unten)

**Überfällig**:
Ein fälliges Item, dessen `due_date` strikt vor heute liegt.
_Avoid_: Verspätet, über die Zeit

**Terminiert**:
Ein offenes Item vom Typ `list_due_date`, dessen `due_date` dem gewählten Agenda-Datum entspricht und dessen `due_time != ''` ist. Liegt sein Datum bereits zurück, gilt es stattdessen als Überfällig; eine frühere Uhrzeit ordnet es nicht in den aktuellen Zeitplan ein.
_Avoid_: Fest terminiert, mit Uhrzeit

**Ohne Uhrzeit**:
Ein offenes Item vom Typ `list_due_date`, dessen `due_date` dem gewählten Agenda-Datum entspricht und dessen `due_time` leer ist. Überfällige Items stehen am heutigen Datum in derselben linken Spalte, behalten aber die Bezeichnung „Überfällig“.
_Avoid_: Irgendwann heute, Ganztägig

**Aufteilung der Agenda am heutigen Datum** (gilt für fällige Items):
1. Links „Ohne Uhrzeit“: Überfällig (`due_date < today`) und heutige Items ohne Uhrzeit; Überfälliges zuerst.
2. Rechts „Terminiert“: heutige Items mit Uhrzeit, nach `due_time` aufsteigend.

**`due_time`**:
Optionale Uhrzeit auf Items vom Typ `list_due_date`, additive Spalte `due_time TEXT NOT NULL DEFAULT ''` (leerer String = keine Uhrzeit). Wird nie ohne `due_date` gesetzt.

**Journal**:
Vom System automatisch angelegte, einzelne Kategorie vom Typ `daily_notes` pro Nutzer, sichtbar als eigener Tab. Nicht vom Nutzer umbenannt (YAGNI), nicht löschbar; bei Beschädigung wird sie vom System neu angelegt.
_Avoid_: Tagebuch, Logbuch

**Tagesnotiz**:
Ein datumsgebundenes Item in der Journal-Kategorie, das Text, eine Skizze oder beides enthalten kann. Pro Datum existiert höchstens ein Item; es wird beim ersten Speichern eines dieser Inhalte angelegt, nicht beim bloßen Öffnen.
_Avoid_: Journaleintrag, Tages-Eintrag

**Zeichnung**:
Ein eigenständiges Item in einer Zeichnungen-Kategorie, dessen Inhalt eine bearbeitbare Skizze ist. Das Löschen aller Skizzenelemente leert die Zeichnung, löscht aber nicht das Item.
_Avoid_: Tages-Skizze, Bild

**Zeichnungen-Kategorie**:
Eine vom Nutzer ausdrücklich angelegte Kategorie für Zeichnungen. Sie wird weder als Standardkategorie noch nachträglich für bestehende Nutzer automatisch erzeugt.

**Tages-Skizze**:
Die optionale Skizze einer Tagesnotiz. Sie ist kein eigenständiges Item; wird sie geleert, bleibt die Tagesnotiz ohne Skizze bestehen.
_Avoid_: Zeichnung, Tageszeichnung

**Priorität**:
Optionale Markierung auf Items vom Typ `list_due_date` und `list_quantity`. Werte: `!1` = hoch, `!2` = mittel, `!3` = niedrig. Kein `!` = keine Priorität. Additive Spalte `priority TEXT NOT NULL DEFAULT ''` (leerer String = keine Priorität).
_Avoid_: Wichtigkeit, Dringlichkeit

**Quick-Add**:
Eingabefeld in jeder `list_due_date`- und `list_quantity`-Kategorie sowie in der Tagesansicht, das beim Submit zuerst einen deterministischen Parser laufen lässt (Vokabular siehe ADR-0004). In der Tagesansicht sind die letzte aktive Fälligkeitskategorie und das gewählte Datum die Standardwerte; explizite relative Wörter beziehen sich immer auf Heute und überschreiben den Datumsdefault.
_Avoid_: Schnell-Add, Quick Input

**Magic Bar**:
Bestehendes AI-gestütztes Eingabefeld (Gemini), das als Eskalationsziel für Quick-Add dient und parallel als eigenständiger AI-only-Modus erhalten bleibt.

**Deep-Link**:
Aus der Tagesansicht heraus: Tap auf den Inhalt eines Agenda-Eintrags navigiert in die Quell-Kategorie, scrollt zum Item und blendet es für 1,5 s gelb hinterlegt ein. Die Checkbox hakt den Eintrag dagegen direkt in der Tagesansicht ab.