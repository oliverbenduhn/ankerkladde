# Parchment-Ideen für Ankerkladde

Übernahme-Kandidaten aus dem Video „I Made the Productivity App I Always Wanted"
(Parchment, https://www.youtube.com/watch?v=cgG9abre3wM), priorisiert nach Nutzen pro Aufwand.

## 1. „Heute"-Ansicht als Agenda

Eine kategorieübergreifende Startansicht, die alle heute fälligen und überfälligen Items
aus sämtlichen `list_due_date`-Kategorien einsammelt.

- Die Daten existieren bereits (`items.due_date`), es fehlt nur die Sicht, die den **Tag**
  statt die **Liste** in den Mittelpunkt stellt: „Was steht heute an?" auf einen Blick,
  ohne durch Kategorien zu klicken.
- Überfällige Einträge mit aufnehmen und als solche kennzeichnen.
- Jeder Eintrag verlinkt zurück in seine Kategorie (Parchments Deep-Link-Idee: Tap auf
  einen Agenda-Eintrag springt zum Item in seiner Liste).
- Das ist der Hebel unter allen Ideen: macht aus „mehreren Listen" ein
  „mein Tag in einer App".

## 2. Zweiteilung „irgendwann heute" vs. „terminiert"

Parchments beste konzeptionelle Einsicht: Aufgaben ohne Uhrzeit und Aufgaben mit fester
Uhrzeit sind nicht gleich wichtig und gehören getrennt dargestellt.

- Beispiel aus dem Video: „Mülltonne rausstellen" (irgendwann am Sonntag) vs.
  „wichtige Mail um 8:00 senden" (fester Zeitpunkt). Andere Apps sortieren
  Ganztages-Einträge nach oben und schneiden die terminierten unten ab — genau falsch.
- Voraussetzung: `due_date` bekommt eine **optionale Uhrzeit** (additive Migration,
  passt zum bestehenden Migrationsstil in `db.php`).
- Darstellung in der Heute-Ansicht: terminierte Einträge prominent (chronologisch),
  „heute irgendwann" als eigener Block daneben/darunter.

## 3. Tagesnotiz mit Gestern/Heute/Morgen-Navigation

Ein Notiz-Kategorietyp, der pro Datum genau **eine** Notiz führt und beim Öffnen
automatisch auf heute steht. TipTap ist bereits vorhanden.

- Workflow aus dem Video: abends eine Notiz an das Morgen-Ich hinterlassen
  (offene Enden, Verdachtsmomente, „hier weitermachen"), morgens öffnet die App
  direkt darauf. Übergabe-/Logbuch-Feature mit wenig Aufwand.
- UI: Buttons **Gestern / Heute / Morgen** plus Datepicker; Tap auf das angezeigte
  Datum springt immer zurück zu heute.
- Nutzbar als Tageslog, Meeting-Notizen, Journal — bewusst nicht festgelegt.

## 4. Lokale Natural-Language-Eingabe (ohne KI)

Parchments Quick-Add ist rein **deterministisch** geparst — kein API-Key nötig.
Ergänzung zur Magic Bar, die auch ohne Gemini-Key funktioniert.

- Syntax: `/` wechselt Kategorie/Liste, `!1`–`!3` setzt Priorität,
  Datumsphrasen wie „morgen 8:00" werden erkannt.
  Beispiel: `Zahnarzt anrufen morgen /privat !2` → fertig.
- Ohne `!` wird keine Priorität gesetzt (Default).
- Priorität als Item-Feld gibt es noch nicht → kleine additive Migration.
- Passt zur Projektlinie: so wenig Funktionen wie möglich vom AI-Key abhängig machen.

## 5. Badge-API fürs PWA-Icon

Parchments Lock-Screen-Widget zeigt „noch X offen heute". PWAs haben keine Widgets,
aber es gibt einen guten Ersatz:

- **Badging API**: Zahl der offenen Heute-Todos als Badge auf dem installierten
  App-Icon (`navigator.setAppBadge(n)`), sehr billig zu haben.
- Ergänzend `shortcuts` im Web-App-Manifest („Heute", „Neue Notiz") für den
  Longpress aufs Icon.

---

Empfohlene Reihenfolge: **1 → 3 → 4 → 2 → 5**.
Bewusst nicht übernommen: Kalender-Integration (kein Systemkalender im Web,
ICS-Abos wären ein großes Fass), Handschrift/PencilKit (kein sinnvolles
Web-Äquivalent), globaler Hotkey (deckt die Browser-Extension besser ab).
