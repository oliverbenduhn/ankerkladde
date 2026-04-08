# Zettel Uploads Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Datum:** 2026-04-08
**Status:** Approved

**Goal:** Zettel-Items in der oeffentlichen App koennen genau ein Attachment tragen. Bilder und allgemeine Dateien lassen sich hochladen, anzeigen bzw. herunterladen, ohne den bestehenden Item-Flow fachlich einzuschraenken.

**Scope:** Diese Planung beschreibt nur das freigegebene Konzept fuer Uploads. Bilder erhalten validierte Uploads mit Vorschau und Download. Dateien erhalten Upload und Download ohne fachliche Typ-Limits und ohne App-seitige Groessenlimits. Die technische Obergrenze liegt bei 5 GB und wird ueber die Infrastruktur vorgegeben, nicht ueber die App.

**Architecture:** Binaerdaten werden im `data/`-Verzeichnis gespeichert. Attachment-Metadaten liegen in SQLite. Backend-seitig werden dedizierte Endpunkte fuer Upload, Listenabfrage und Media-Auslieferung bereitgestellt. Das Frontend erweitert die bestehenden Item-Ansichten fuer Images und Files. Infrastruktur-Anpassungen fuer grosse Uploads werden separat auf Host `web` umgesetzt.

---

## Freigegebene Produktentscheidung

- Die Funktion ist fuer die oeffentliche App bestimmt.
- Pro Item ist genau ein Attachment erlaubt.
- Es gibt zwei Attachment-Klassen: Bild und Datei.
- Bilder erhalten validierte Uploads, Vorschau und Download.
- Dateien erhalten Upload und Download ohne fachliche Typ-Limits.
- Die App erzwingt keine eigene Dateigroessenbegrenzung.
- Die technische Obergrenze fuer Uploads betraegt 5 GB und wird durch die Infrastruktur gesetzt.

---

## Datenmodell und Persistenz

### Task 1: Attachment-Daten ablegen

**Files:**
- Modify: SQLite-Schema und zugehoerige DB-Migrationen
- Use: `data/` als physischer Storage-Ort fuer Uploads

- [ ] Attachment-Metadaten in SQLite speichern.
- [ ] Pro Attachment mindestens Item-Zuordnung, Originalname, Medientyp, Dateigroesse, Speicherpfad und Zeitstempel vorhalten.
- [ ] Die eigentlichen Dateien im `data/`-Verzeichnis ablegen.
- [ ] Sicherstellen, dass pro Item nur ein Attachment existieren kann.

### Task 2: Dateitypen sauber trennen

**Decision:**
- Bilder werden separat als Bild-Attachments behandelt, damit Validierung, Vorschau und UI gezielt gesteuert werden koennen.
- Dateien bleiben fachlich offen; es gibt keine App-seitige Allowlist fuer Dateiendungen oder MIME-Typen.

---

## Backend und Endpunkte

### Task 3: Upload-Endpunkt bereitstellen

**Requirements:**
- Ein Upload-Endpunkt nimmt genau ein Attachment fuer ein Item entgegen.
- Beim Ersetzen eines bestehenden Attachments wird das alte Attachment sauber entfernt bzw. ueberschrieben.
- Bild-Uploads werden validiert.
- Fuer Datei-Uploads gibt es keine fachlichen Typ-Limits.
- Die App setzt keine eigene Groessenobergrenze; relevante technische Limits kommen ausschliesslich aus der Infrastruktur.

### Task 4: Listen- und Media-Endpunkte erweitern

**Requirements:**
- Die Listenabfrage liefert Attachment-Metadaten mit aus, damit das Frontend Bilder und Dateien direkt rendern kann.
- Ein Media-Endpunkt liefert gespeicherte Attachments fuer Vorschau und Download aus.
- Downloads muessen sowohl fuer Bilder als auch fuer allgemeine Dateien verfuegbar sein.

**Endpoint-Gruppen:**
- Upload-Endpunkt
- List-Endpunkt
- Media-Endpunkt

---

## Frontend

### Task 5: Item-UI fuer Bilder erweitern

**Requirements:**
- In der Item-Ansicht Upload-Moeglichkeit fuer Bilder anbieten.
- Nach erfolgreichem Upload eine Vorschau anzeigen.
- Fuer Bilder einen Download anbieten.
- Validierungsfehler fuer Bilder verstaendlich anzeigen.

### Task 6: Item-UI fuer Dateien erweitern

**Requirements:**
- In der Item-Ansicht Upload-Moeglichkeit fuer allgemeine Dateien anbieten.
- Dateiname und Download-Aktion sichtbar machen.
- Keine fachliche Einschraenkung auf bestimmte Dateitypen im Frontend.
- Keine App-seitige Dateigroessenpruefung im Frontend einbauen.

### Task 7: Ein-Attachment-Regel sichtbar machen

**Requirements:**
- Das Frontend muss klar abbilden, dass pro Item genau ein Attachment verwaltet wird.
- Bestehende Attachments muessen fuer Nutzer erkennbar ersetzbar sein.

---

## Tests

### Task 8: Smoke-Tests abdecken

- [ ] Smoke-Tests fuer Bild-Upload, Bild-Vorschau und Bild-Download vorsehen.
- [ ] Smoke-Tests fuer Datei-Upload und Datei-Download vorsehen.
- [ ] Smoke-Tests fuer Attachment-Anzeige in der Listenansicht vorsehen.
- [ ] Smoke-Tests fuer die Ein-Attachment-Regel vorsehen.

---

## Infrastruktur

### Task 9: Upload-Limits auf Host `web`

**Requirements:**
- Infrastruktur-Anpassungen werden getrennt vom App-Code umgesetzt.
- Host `web` traegt die technische Verantwortung fuer Uploads bis 5 GB.
- Relevante Webserver-/Runtime-Limits muessen so gesetzt werden, dass die App selbst keine zusaetzlichen Groessenlimits definieren muss.

---

## Nicht-Ziele

- Keine fachliche Einschraenkung allgemeiner Dateien auf bestimmte Formate.
- Keine App-seitige Groessenlimit-Logik unterhalb der Infrastrukturgrenze.
- Kein Multi-Attachment-Modell pro Item.

---

## Verifikation

1. Bild an Item hochladen, Validierung pruefen, Vorschau sehen, Download ausfuehren.
2. Allgemeine Datei an Item hochladen und wieder herunterladen.
3. Listenansicht pruefen: Attachment-Metadaten sind vorhanden und korrekt dargestellt.
4. Neues Attachment auf dasselbe Item laden und bestaetigen, dass nur ein Attachment verbleibt.
5. Infrastruktur auf Host `web` getrennt pruefen: Uploads bis zur technischen Obergrenze von 5 GB werden serverseitig akzeptiert.
