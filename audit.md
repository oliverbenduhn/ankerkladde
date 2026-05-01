# Deep App Audit Report — Ankerkladde

---

## 1) Abgeleitetes App-Ziel & beabsichtigte Ergebnisse

### Abgeleiteter Zweck
Ankerkladde ist eine selbst gehostete, mobile-first Web-App (PWA) für persönliche Produktivität und Haushalt. Sie ermöglicht das Verwalten von Einkaufslisten, Aufgaben, Notizen (Rich-Text), Bildgalerien, Dateisammlungen und Link-Bookmarks — alles in benutzerdefinierten Kategorien. Produktivitätsfunktionen wie Barcode-Scanner, KI-gestützte Eingabe (Gemini) und Offline-Sync via Service Worker differenzieren die App gegenüber einfachen Listen-Apps.

### Wahrscheinliche Benutzertypen
- **Primär**: Technisch versierte Einzelnutzer oder Kleinfamilien, die datenschutzbewusst eine selbst gehostete Alternative zu Google Keep / Any.do suchen
- **Sekundär**: Ein Admin-Nutzer (Betreiber), der Benutzer anlegt und die Produktdatenbank befüllt

### Kern-Workflows (abgeleitet)
1. **Login & Authentifizierung** → Benutzerverwaltung durch Admin, Session-basierter Zugang
2. **Kategorie-Management** → Anlegen, Umbenennen, Sortieren, Verstecken von Kategorien
3. **Einträge erstellen/bearbeiten/löschen** → Per Formular oder via KI (Magic-Button/Gemini)
4. **Datei- und Bildupload** → Direktupload oder Remote-URL-Import in Kategorien
5. **Barcode-Scan → Produkt-Lookup → Artikel hinzufügen**
6. **Offline-Betrieb** → Aktionen in der Queue speichern, bei Wiederverbindung abspielen
7. **Admin-Bereich** → Nutzerverwaltung, Upload-Limits, Produktdatenbank-Import

### Annahmen / Unbekannte
- Die App scheint für eine kleine, bekannte Nutzergruppe konzipiert (kein Self-Registration-Flow sichtbar)
- Es gibt keine E-Mail-Verifikation, kein Passwort-Reset per E-Mail — Annahme: Admin setzt Passwörter manuell zurück
- Deployment-Kontext (Reverse-Proxy, TLS) nicht vollständig aus dem Code ableitbar — Nginx/Caddy-Konfiguration nicht im Repo vorhanden
- Laufzeitverhalten der Offline-Queue bei Race Conditions nicht vollständig verifizierbar ohne Integration-Tests

---

## 2) Produktabsicht & funktionale Fit-Überprüfung

### Workflow-Validierungsergebnisse

#### Kritische Probleme

- **Kein CSRF-Schutz in `ai.php`**
  - Schweregrad: Kritisch
  - Vertrauen: Bestätigt
  - Ort: `public/ai.php`, Zeilen 82–97
  - Beabsichtigtes Ergebnis: Nur authentifizierte, absichtliche POST-Anfragen sollen Einträge per KI anlegen
  - Aktuelles Verhalten: `ai.php` prüft nur `requireAuth()`, aber **kein** CSRF-Token auf dem POST-Pfad
  - Lücke: Jede andere Website kann einen angemeldeten Nutzer durch einen versteckten Form-Submit dazu bringen, beliebige Einträge anzulegen — `userInput` kommt aus dem Request-Body, nicht aus einer gesicherten Quelle
  - Warum es wichtig ist: Angreifer könnten durch CSRF-Angriff unerwünschte Einträge mit KI-generierten Namen anlegen
  - Risiko, wenn nicht behoben: Cross-Site-Request-Forgery auf der einzigen Nicht-API Endpoint-Seite, die Datenbankschreiboperationen durchführt
  - Empfehlung: `requireCsrfToken($data)` am Anfang des POST-Pfads in `ai.php` einfügen (analog `api.php`)
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Ja (Sicherheitsumgehung möglich)

- **`scanned_products` nicht nutzer-isoliert — globale Schreiboperationen ohne Zugriffskontrolle**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Ort: `public/api.php`, Zeilen 2008–2014, 2360–2374; `db.php`, Zeile 428
  - Beabsichtigtes Ergebnis: Produkt-Barcodes sollen als appweiter Cache für Barcode-Lookups dienen
  - Aktuelles Verhalten: Die `scanned_products`-Tabelle hat **kein** `user_id`-Feld. Jeder authentifizierte Nutzer kann beim Hinzufügen/Aktualisieren eines Artikels (mit Barcode) globale Produktnamen überschreiben, die alle anderen Nutzer bei einem Lookup erhalten
  - Lücke: Nutzer A kann Nutzer B's nächsten Barcode-Scan vergiften, indem er einen Artikel mit bösartigem Produktnamen anlegt
  - Warum es wichtig ist: Datenvergiftung, manipulierte Produktnamen für alle Nutzer
  - Risiko, wenn nicht behoben: Beabsichtigte oder versehentliche Datenverschmutzung; kein Audit-Trail
  - Empfehlung: `user_id` in `scanned_products` einführen oder klar dokumentieren, dass dies ein bewusstes, vertrauenswürdiges globales Cache-Design ist, das nur für Single-User-Instanzen gedacht ist
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Teilweise

#### Ergebnisse mit hoher Priorität

- **Brute-Force-Schutz nur session-basiert — umgehbar durch neues Session-Cookie**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Ort: `public/login.php`, Zeilen 39–65
  - Beabsichtigtes Ergebnis: Automatisierte Passwort-Rateversuche sollen verhindert werden
  - Aktuelles Verhalten: Login-Fehlversuche werden ausschließlich in `$_SESSION['login_failures']` gezählt. Ein Angreifer, der den Session-Cookie löscht oder eine neue Session startet, umgeht den Delay vollständig
  - Lücke: Kein IP-basiertes oder credentials-basiertes Throttling
  - Empfehlung: Ergänzend ein zeitbasiertes Rate-Limit pro Username in der Datenbank speichern (z.B. `users.failed_attempts + locked_until`), unabhängig von der Session
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Teilweise

- **`ai.php` validiert `due_date` aus KI-Antwort nicht**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Ort: `public/ai.php`, Zeile 256: `':due_date' => (string) ($item['due_date'] ?? '')`
  - Beabsichtigtes Ergebnis: Nur gültige Datumsstrings `YYYY-MM-DD` werden gespeichert
  - Aktuelles Verhalten: Das von Gemini zurückgegebene `due_date` wird **direkt ohne Validierung** in die Datenbank geschrieben. `normalizeDueDate()` aus `api.php` wird hier nicht verwendet
  - Lücke: Ungültige Werte wie `"morgen"`, `"2024-13-45"` oder beliebige Strings landen in der DB
  - Empfehlung: `normalizeDueDate()` aus `api.php` auch in `ai.php` aufrufen
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Teilweise

- **`ai.php` gibt internen Datenbankfehler-Text an den Client weiter**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Ort: `public/ai.php`, Zeile 276: `echo json_encode(['error' => 'Fehler beim Speichern in der Datenbank: ' . $e->getMessage()]);`
  - Beabsichtigtes Ergebnis: Fehlermeldungen sollten keine internen Details preisgeben
  - Aktuelles Verhalten: Der vollständige Exception-Text (inkl. möglicher DB-Pfade, SQL) wird an den Browser gesendet
  - Empfehlung: Internen Fehler nur `error_log()` übermitteln; dem Client nur `'Serverfehler.'` zurückgeben
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Nein

- **`product_details`-Endpoint gibt rohe Datenbankfelder zurück**
  - Schweregrad: Mittel–Hoch
  - Vertrauen: Bestätigt
  - Ort: `public/api.php`, Zeilen 2854–2857: `'fields' => $row`
  - Beabsichtigtes Ergebnis: Detailansicht eines gescannten Produkts
  - Aktuelles Verhalten: Alle Spalten der `product_catalog_*`-Tabelle (z.B. OpenFoodFacts-Rohdaten mit potenziell hunderten Feldern) werden ungefiltert als JSON-Array zurückgegeben
  - Lücke: Information Leakage — interne Datenbankstruktur, Feldnamen, potenziell große Datenmenge pro Request
  - Empfehlung: Whitelist relevanter Felder statt `$row` direkt zurückzugeben
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Nein

#### Ergebnisse mit mittlerer Priorität

- **`product_normalize_debug`-Endpoint in Produktionsumgebung verfügbar**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Ort: `public/api.php`, Zeilen 2709–2749
  - Beabsichtigtes Ergebnis: Debugging-Werkzeug für Entwickler
  - Aktuelles Verhalten: Jeder authentifizierte Nutzer kann `/api.php?action=product_normalize_debug&barcode=X` aufrufen und sieht rohe Produktdaten, heuristische und KI-normalisierte Ausgaben — kein Admin-Gate
  - Empfehlung: Entweder entfernen oder hinter `requireAdmin()` legen
  - Backend-Änderungen erforderlich: Ja
  - Blockiert beabsichtigtes Ergebnis?: Nein

- **SW-Cache-Liste in `sw.js` nicht synchron mit Datei-Modulstruktur**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Ort: `public/sw.js`, Zeilen 12–55
  - Beabsichtigtes Ergebnis: Vollständiger App-Shell-Cache für Offline-Betrieb
  - Aktuelles Verhalten: Module wie `app-events-forms.js`, `app-events-layout.js`, `app-events-system.js`, `app-events-tools.js`, `items-actions-add.js`, `items-actions-share.js`, `items-actions-update.js`, `items-actions-upload.js`, `items-actions-utils.js`, `kanban-view.js`, `offline-conflicts.js`, `settings.js`, `settings-dnd.js`, `settings-forms.js`, `settings-state.js`, `settings-theme.js`, `settings-ui.js`, `tiptap-init.js`, `todo-editor.js` existieren auf Disk, sind aber nicht alle im SW-Cache-Array gelistet
  - Lücke: Offline-Modus kann im Feld fehlschlagen, wenn benötigte Module nicht gecacht sind
  - Empfehlung: Automatisierte Prüfung (analog `check-ui-sprite.js`-Pattern) für SW-Cache-Liste einführen
  - Backend-Änderungen erforderlich: Nein
  - Blockiert beabsichtigtes Ergebnis?: Teilweise

- **Offline-Queue bei Konflikten: Nutzer-Rückmeldung nicht vollständig verifizierbar**
  - Schweregrad: Mittel
  - Vertrauen: Unverifiziert
  - Ort: `public/js/offline-queue.js`, Zeilen 98–108
  - Beabsichtigtes Ergebnis: Offline-Aktionen sollen zuverlässig synchronisiert werden, Konflikte sichtbar kommuniziert werden
  - Aktuelles Verhalten: Bei 4xx-Antworten wird der Eintrag in `CONFLICTS_KEY` verschoben, aber ob der Nutzer klar informiert wird, ist ohne Laufzeittest nicht vollständig verifizierbar
  - Empfehlung: Konflikt-Badge/Hinweis in UI manuell testen; sicherstellen, dass Konflikte persistent und sichtbar angezeigt werden
  - Backend-Änderungen erforderlich: Nein
  - Blockiert beabsichtigtes Ergebnis?: Unverifiziert

#### Ergebnisse mit niedriger Priorität

- **`due_date`-Einträge aus KI ohne Bezug zum aktuellen Datum**
  - Schweregrad: Niedrig
  - Ort: `public/ai.php`
  - Beabsichtigtes Ergebnis: KI erkennt Datumsangaben wie "morgen" korrekt
  - Aktuelles Verhalten: Das Systemprompt enthält das aktuelle Datum nicht — KI kann relative Datumsangaben nicht zuverlässig auflösen
  - Empfehlung: `date('Y-m-d')` im Prompt als aktuelles Datum mitgeben

---

### Fehlende / unvollständige Funktionen, die den Erfolg blockieren

- **Kein Passwort-Reset-Flow**: Kein E-Mail-basierter Reset. Admin muss manuell ein Passwort setzen. Für Mehrnutzer-Instanzen ein UX-Blocker.
- **Keine Registrierung**: Bewusste Entscheidung, aber kein Onboarding-Pfad für neue Nutzer in der UI selbst dokumentiert.
- **Kein Audit-Log**: Für Admin-Aktionen (Nutzer gelöscht, Passwort zurückgesetzt) gibt es kein Log in der Datenbank.

### Positive Beobachtungen

- **Vollständige CSRF-Implementierung in `api.php`**: Alle mutierenden Actions prüfen das CSRF-Token konsistent, mit einer korrekten Ausnahme für API-Key-Requests.
- **Gute Offline-Architektur**: Die Queue-Logik mit Halt-on-Error und Conflict-Tracking ist ein durchdachtes Muster.
- **KI-Fallback auf Heuristik**: Wenn kein Gemini-Key vorhanden, funktioniert Produkt-Normalisierung heuristisch — elegantes Degradation-Design.

---

## 3) Codequalitätsüberprüfung

### Kritische Probleme

- **`getDatabase()` führt Schema-Migrationen auf jedem PHP-Worker-Start durch**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Bereich: Architektur / Codequalität
  - Ort: `db.php`, Zeilen 137–498
  - Was wir gefunden haben: `getDatabase()` ist eine statisch-gecachte Funktion, die beim ersten Aufruf in einem PHP-Worker-Prozess Dutzende `PRAGMA table_info()`-Abfragen, `ALTER TABLE`-Statements, Migrations-Checks und sogar einen vollständigen Datenbank-zu-Datenbank-Migrationsjob ausführt
  - Warum es wichtig ist: Schema-Checks verlangsamen den ersten Request nach jedem Deploy; Migrations-Logik in einer Business-Funktion ist schwer zu testen
  - Risiko, wenn nicht behoben: Wartbarkeit leidet; transiente Spikes bei gleichzeitigem Worker-Restart nach Deploy
  - Empfehlung: Migrations-Logik in ein eigenständiges CLI-Skript auslagern, das einmalig beim Deploy läuft; `getDatabase()` nur noch für Connection-Setup
  - Backend-Änderungen erforderlich: Ja

### Ergebnisse mit hoher Priorität

- **`api.php` ist mit ~2.900 Zeilen eine Monodatei**
  - Schweregrad: Mittel–Hoch
  - Vertrauen: Bestätigt
  - Bereich: Architektur / Codequalität
  - Ort: `public/api.php`
  - Was wir gefunden haben: Alle ~20 API-Actions inklusive SSRF-Prüfung, HTML-Fetch, Produkt-Normalisierung, KI-Integration, Upload-Validierung und Item-CRUD in einer Datei
  - Warum es wichtig ist: Schwer zu testen, zu reviewen und zu navigieren; ein Fehler kann versehentlich andere Actions beeinflussen
  - Empfehlung: Actions in Controller-Klassen in `src/` auslagern (wie `SettingsController.php` als gutes Vorbild)
  - Backend-Änderungen erforderlich: Ja

- **`admin.php` `downloadFileToPath()` — kein explizites SSL-Verify, FOLLOWLOCATION aktiv, kein SSRF-Check**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Bereich: Sicherheit / Codequalität
  - Ort: `public/admin.php`, Zeilen 86–94
  - Was wir gefunden haben: `CURLOPT_SSL_VERIFYPEER` und `CURLOPT_SSL_VERIFYHOST` sind nicht explizit gesetzt; `CURLOPT_FOLLOWLOCATION => true` ist aktiv; keine SSRF-Prüfung der Download-URL. URLs kommen aus `PRODUCT_FACTS_DATASETS` (hardcoded, vertrauenswürdig), aber die Funktion ist generisch und könnte bei Wiederverwendung SSRF ermöglichen
  - Empfehlung: Explizit `CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2` setzen; Funktion auf vertrauenswürdige URL-Quellen beschränken

- **PASSWORD_BCRYPT ohne expliziten Cost-Faktor**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Bereich: Sicherheit / Codequalität
  - Ort: `public/admin.php` Zeile 253, `src/SettingsController.php` Zeile 261
  - Was wir gefunden haben: `password_hash($pw, PASSWORD_BCRYPT)` ohne `['cost' => X]`-Option — PHP-Default ist 10
  - Empfehlung: `PASSWORD_ARGON2ID` oder zumindest `['cost' => 12]` explizit setzen und in einer Konstante definieren
  - Backend-Änderungen erforderlich: Ja

- **`requestData()` ruft `ensureUtf8()` nicht bei JSON-Body-Requests auf**
  - Schweregrad: Niedrig
  - Vertrauen: Wahrscheinlich
  - Bereich: Codequalität
  - Ort: `public/api.php`, Zeilen 111–124
  - Was wir gefunden haben: Bei `$_POST`-Requests wird `ensureUtf8()` aufgerufen; bei JSON-Body-Requests (`file_get_contents('php://input')`) fehlt diese Normalisierung
  - Empfehlung: Auch den JSON-decoded Array durch `ensureUtf8()` laufen lassen

### Ergebnisse mit mittlerer Priorität

- **`prependItemSortOrder()` ohne umgebende Transaktion im `add`-Action**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Bereich: Datenintegrität
  - Ort: `src/ItemRepository.php`, Zeilen 178–187; `public/api.php`, case `add`
  - Was wir gefunden haben: `prependItemSortOrder()` führt ein `UPDATE ... SET sort_order = sort_order + 1` durch, das außerhalb einer Transaktion liegt — der `add`-Action startet keine explizite Transaktion. Bei gleichzeitigen Anfragen kann die Sort-Order korrumpiert werden
  - Empfehlung: `add`-Action in eine Transaktion einschließen, die `prependItemSortOrder()` + `INSERT` atomisch macht
  - Backend-Änderungen erforderlich: Ja

- **`rebuildSortOrder()` führt N+1 UPDATE-Statements durch**
  - Schweregrad: Niedrig
  - Vertrauen: Bestätigt
  - Bereich: Performance
  - Ort: `src/ItemRepository.php`, Zeilen 27–81
  - Was wir gefunden haben: Pro Item wird ein einzelnes `UPDATE ... WHERE id = :id` ausgeführt. Bei großen Listen tritt dies selten auf, aber im Worst-Case sehr langsam
  - Empfehlung: Für den erwarteten Datenschnitt akzeptabel — dokumentieren oder als bekanntes Tech-Debt erfassen

### Ergebnisse mit niedriger Priorität

- **`formatListItem()` gibt redundante Attachment-Felder zurück**
  - Schweregrad: Niedrig
  - Bereich: API-Design
  - Ort: `public/api.php`, Zeilen 1654–1685
  - Was wir gefunden haben: Attachment-Felder werden sowohl als Top-Level-Felder als auch innerhalb von `attachment: {...}` zurückgegeben
  - Empfehlung: API-Response bereinigen; Top-Level-Duplikate nach Absprache mit Frontend entfernen

### Positive Beobachtungen

- **Konsequente `declare(strict_types=1)`**: Alle PHP-Dateien aktivieren strict types — verhindert unbeabsichtigte Typ-Coercions.
- **Vollständige Parameterisierung aller SQL-Queries**: Keine direkt interpolierten Werte in SQL-Statements gefunden — SQL-Injection vollständig verhindert.
- **Saubere HTML-Sanitisierung für Rich-Text**: `sanitizeRichTextHtml()` mit DOMDocument und Whitelist-Ansatz ist defensiv und korrekt implementiert.
- **Transaktionsmanagement bei kritischen Writes**: Upload, Replace, Delete und Reorder verwenden korrekte `beginTransaction/commit/rollBack`-Blöcke mit Cleanup.
- **Atomare Attachment-Behandlung**: Zwei-Phase-Logik (DB zuerst, dann Datei-Rename) mit Rollback bei Fehler ist solide.

---

## 4) Sicherheitsüberprüfung

### Kritische Probleme

- **Fehlendes CSRF-Token in `ai.php`** (bereits unter Produkt-Fit gelistet)
  - Schweregrad: Kritisch
  - Vertrauen: Bestätigt
  - Bereich: Sicherheit / CSRF
  - Ort: `public/ai.php`, Zeile 82–96
  - Was wir gefunden haben: `POST /ai.php` prüft nur Session-Auth, kein CSRF-Token. Alle anderen mutativen Endpunkte in `api.php` sind korrekt geschützt.
  - Warum es wichtig ist: Ermöglicht Cross-Site-Request-Forgery durch Drittseiten auf angemeldete Nutzer
  - Risiko, wenn nicht behoben: Unautorisisierte Einträge erzeugbar; unerwünschter Gemini-API-Key-Verbrauch
  - Empfehlung: `$data = json_decode(file_get_contents('php://input'), true); requireCsrfToken($data ?? [])` vor dem POST-Handler einfügen
  - Backend-Änderungen erforderlich: Ja

### Ergebnisse mit hoher Priorität

- **Keine HSTS-Header — HTTP-Downgrade-Angriff möglich**
  - Schweregrad: Hoch
  - Vertrauen: Wahrscheinlich (abhängig von Reverse-Proxy-Konfiguration)
  - Bereich: Transport-Sicherheit
  - Ort: `security.php`, `sendHtmlPageSecurityHeaders()` — kein `Strict-Transport-Security`-Header
  - Was wir gefunden haben: Die App setzt HSTS nicht in PHP. Ob Nginx/Caddy HSTS hinzufügt, ist aus dem Repo nicht verifizierbar. Ohne HSTS können Nutzer Opfer von SSL-Stripping werden.
  - Empfehlung: `header('Strict-Transport-Security: max-age=31536000; includeSubDomains')` in `sendHtmlPageSecurityHeaders()` hinzufügen (oder in Webserver-Konfiguration sicherstellen)
  - Backend-Änderungen erforderlich: Vielleicht

- **Gemini-API-Key über `preferences`-Endpoint abrufbar**
  - Schweregrad: Hoch
  - Vertrauen: Bestätigt
  - Bereich: Secrets Management
  - Ort: `public/api.php`, case `preferences` (Zeile 2873); `src/UserRepository.php`, Zeile 85
  - Was wir gefunden haben: `GET /api.php?action=preferences` gibt das vollständige Preferences-JSON zurück, das `gemini_api_key` im Klartext enthält. In einer Einzel-Nutzer-Instanz ist dies unkritisch, in Mehrnutzer-Setups potentiell problematisch
  - Empfehlung: `gemini_api_key` aus der `preferences`-API-Antwort herausfiltern; stattdessen nur `gemini_key_set: true/false` zurückgeben
  - Backend-Änderungen erforderlich: Ja

- **`X-Content-Type-Options: nosniff` fehlt auf HTML-Seiten**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Bereich: Response-Security-Header
  - Ort: `security.php`, `sendHtmlPageSecurityHeaders()`, Zeilen 423–455
  - Was wir gefunden haben: `sendHtmlPageSecurityHeaders()` setzt CSP und X-Frame-Options, aber kein `X-Content-Type-Options: nosniff`. Dieser Header ist auf API- und Media-Endpunkten gesetzt, fehlt aber auf HTML-Seiten.
  - Empfehlung: `header('X-Content-Type-Options: nosniff')` in `sendHtmlPageSecurityHeaders()` hinzufügen
  - Backend-Änderungen erforderlich: Ja

- **Kein `Referrer-Policy`-Header**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Bereich: Datenschutz
  - Ort: `security.php`, `sendHtmlPageSecurityHeaders()`
  - Was wir gefunden haben: Kein `Referrer-Policy`-Header. Der vollständige Referrer-URL (inkl. Item-IDs in Query-Strings) kann an verlinkte externe Seiten übermittelt werden
  - Empfehlung: `header('Referrer-Policy: strict-origin-when-cross-origin')` hinzufügen
  - Backend-Änderungen erforderlich: Ja

### Ergebnisse mit mittlerer Priorität

- **`unsafe-inline` in `script-src` der CSP**
  - Schweregrad: Mittel
  - Vertrauen: Bestätigt
  - Bereich: CSP / XSS-Mitigation
  - Ort: `security.php`, Zeile 429: `$scriptSrc = "'self' 'unsafe-inline'"`
  - Was wir gefunden haben: `unsafe-inline` erlaubt inline `<script>`-Blöcke und Event-Handler-Attribute, was die CSP als XSS-Mitigationsmaßnahme deutlich schwächt
  - Empfehlung: Inline-Scripts in externe Dateien auslagern und Nonces oder Hashes für verbleibende Inline-Scripts verwenden
  - Backend-Änderungen erforderlich: Ja

- **Nutzer-ID im HTML-Quellcode exponiert**
  - Schweregrad: Niedrig–Mittel
  - Vertrauen: Bestätigt
  - Bereich: Information Disclosure
  - Ort: `public/index.php`, Zeile 70: `<meta name="user-id" content="X">`
  - Was wir gefunden haben: Die interne Datenbank-ID des Nutzers wird im HTML-Quellcode exponiert. IDOR-Angriffe sind durch `user_id`-Prüfung in allen Queries verhindert, aber Exposition interner IDs ermöglicht User-Enumeration
  - Empfehlung: Nur beibehalten, wenn vom JS zwingend benötigt; in diesem Fall dokumentieren

### Ergebnisse mit niedriger Priorität

- **Session-Cookie `Secure`-Flag abhängig von korrekter Proxy-Konfiguration**
  - Schweregrad: Niedrig
  - Vertrauen: Wahrscheinlich
  - Bereich: Session-Sicherheit
  - Ort: `security.php`, Zeile 224: `'secure' => isRequestHttps()`
  - Aktuelles Verhalten: Der Code ist korrekt (dynamisch gesetzt). Wenn `EINKAUF_TRUST_PROXY_HEADERS` nicht korrekt konfiguriert ist, kann `isRequestHttps()` hinter einem Proxy `false` zurückgeben — Cookie wäre dann nicht `Secure`
  - Empfehlung: In Deployment-Dokumentation explizit auf Proxy-Trust-Konfiguration hinweisen

### Positive Beobachtungen

- **Vollständige SSRF-Mitigation in `fetchRemoteHtml()` und `downloadRemoteFile()`**: Private IP-Ranges und localhost werden geblockt; DNS-Auflösung wird auf öffentliche IPs geprüft; Redirects werden nicht blind gefolgt.
- **`hash_equals()` für CSRF-Token-Vergleich**: Timing-sicherer Vergleich korrekt implementiert.
- **Attachment-Pfade niemals aus User-Input**: Alle Datei-Pfade werden serverseitig aus DB-Records berechnet — keine Directory-Traversal-Möglichkeit.
- **`enforceCanonicalRequest()` mit 308-Redirect**: Verhindert Host-Header-Manipulation für Produktionsdeployments.
- **SQL-Injection vollständig verhindert**: Alle Queries verwenden prepared statements mit named parameters.
- **`PRAGMA foreign_keys = ON`**: Referenzielle Integrität wird auf DB-Ebene erzwungen.

---

## 5) Querschnittsrisiken & Architekturprobleme

- **Migration im Request-Lifecycle**: `getDatabase()` führt Schema-Migrationen synchron durch. Dieses Muster skaliert nicht und koppelt App-Boot an DB-Schema-Zustand. → Migrations-Skript als Deploy-Step trennen.

- **Kein globales Rate-Limiting auf API-Endpunkten**: `api.php` hat kein Request-Throttling. Ein authentifizierter Nutzer kann theoretisch unbegrenzt viele Items anlegen, Barcodes lookupn oder Gemini-AI-Calls triggern (letzteres kostet den Nutzer-API-Key). Upload-Limits existieren; Item-Count-Limits fehlen. → Ggf. pro-Nutzer-Limits für AI-Calls einführen.

- **Keine `Permissions-Policy`-Header**: Browser-Features wie Kamera (für Barcode-Scanner) und Mikrofon könnten durch `Permissions-Policy`-Header präziser gesteuert werden. → `Permissions-Policy: camera=(), microphone=()` für Seiten ohne Kamera-Feature hinzufügen.

- **`unsafe-inline` in `style-src`**: Neben `script-src` erlaubt auch `style-src: 'self' 'unsafe-inline'` inline Styles. Für Themen-Bootstrapping nötig, schwächt aber CSS-Injection-Schutz. → Als bewusste Entscheidung dokumentieren oder Nonces einführen.

- **`gemini_api_key` in preferences-Endpoint exponiert**: `GET /api.php?action=preferences` gibt den Key im Klartext zurück. → Key-Feld aus API-Antwort herausfiltern.

- **`scanned_products` global ohne Nutzer-Isolation**: In Mehrnutzer-Deployments ist dies ein semantisches Problem. → Dokumentieren als Single-User-Design-Entscheidung oder `user_id` hinzufügen.

---

## 6) Verifizierungsgrenzen

### Bestätigt durch Code-Beweise
- CSRF fehlt in `ai.php`
- `due_date` ohne Validierung in `ai.php`
- Interne Exception-Message in `ai.php`-Fehlerantwort
- `scanned_products` hat kein `user_id`-Feld
- Brute-Force-Schutz ist session-basiert (per Code lesbar)
- `product_normalize_debug` ohne Admin-Gate
- `unsafe-inline` in CSP
- Kein `X-Content-Type-Options` auf HTML-Seiten
- Rohe DB-Felder in `product_details`
- Gemini-Key in `preferences`-Antwort enthalten
- `prependItemSortOrder` außerhalb Transaktion im `add`-Action

### Wahrscheinliche Probleme (aus Mustern abgeleitet)
- HSTS-Header fehlt (kein Webserver-Config im Repo für HSTS verifizierbar)
- Race Condition in `add`-Action (kein explizites Transaktions-Wrap um `prependItemSortOrder` + INSERT)
- Referrer-Header-Leakage zu externen Links
- Session `Secure`-Flag abhängig von korrekter Proxy-Konfiguration

### Unverifizierte Risiken (erfordern Laufzeit/Logs/Staging)
- Tatsächliche Session-Fixation-Resistenz nach Deploy
- Verhalten bei gleichzeitigem Reorder + Add (SQLite WAL hilft, aber Concurrent-Write-Verhalten ungetestet)
- SW-Cache-Vollständigkeit im Offline-Betrieb
- Korrektheit der Offline-Conflict-UI
- `isRequestHttps()` Verhalten hinter verschiedenen Proxy-Konfigurationen

### Für vollständige Validierung benötigt
- Laufender Produktions-Server mit aktiviertem Logging
- Curl-Tests gegen `/api.php?action=preferences` und `/ai.php` als authentifizierter Nutzer
- Mehrnutzer-Test der `scanned_products`-Isolation
- Offline-Szenario-Test mit Service Worker
- Überprüfung der Webserver-Konfiguration auf HSTS und `Referrer-Policy`

---

## 7) Zusammenfassungs-Scorecard

**Produkt-Fit-Score**: **8/10** — Die App deckt ihre definierten Anwendungsfälle solide ab. Kerndifferenzierungsfunktionen (Barcode-Scanner, KI-Eingabe, Offline-Queue) sind funktional implementiert. Kleinere funktionale Lücken (Date-Validierung in AI, Debug-Endpoints) beeinträchtigen das Produkt nicht fundamental.

**Codequalitäts-Score**: **7/10** — Solide Basis mit strict types, prepared statements, gutem Transaktionsmanagement und einer sauberen `src/`-Modularisierung. `api.php` als 2.900-Zeilen-Monolith und die Migration-im-Request-Cycle sind die größten strukturellen Schwächen.

**Sicherheits-Score**: **7/10** — Die kritischen Pfade (SQL-Injection, CSRF in api.php, SSRF, Attachment-Paths) sind gut geschützt. Das fehlende CSRF in `ai.php` ist eine klare Lücke. Fehlende Security-Header (HSTS, Referrer-Policy, nosniff auf HTML) sind ein Manko, das im Betrieb hinter einem konfigurierten Reverse-Proxy abgemildert werden kann.

### Gesamtergebnisse nach Schweregrad
- Kritisch: **1**
- Hoch: **5**
- Mittel: **8**
- Niedrig: **5**

### Gesamtergebnisse nach Vertrauen
- Bestätigt: **13**
- Wahrscheinlich: **4**
- Unverifiziert: **3**

### Top 5 Aktionspunkte (höchste Auswirkung zuerst)

1. **CSRF-Token in `ai.php` einbauen** — eine Zeile, sofort behebbar, verhindert Cross-Site-Angriff auf KI-Funktion
2. **Gemini-API-Key aus `preferences`-API-Antwort herausfiltern** — verhindert unbeabsichtigte Key-Exposition gegenüber Clients
3. **`due_date` in `ai.php` durch `normalizeDueDate()` validieren** — verhindert ungültige Datumswerte in der DB
4. **Exception-Message in `ai.php` nicht an Client senden** — verhindert interne Informations-Leakage
5. **`X-Content-Type-Options: nosniff`, `Referrer-Policy` und `Strict-Transport-Security` in `sendHtmlPageSecurityHeaders()` hinzufügen** — fehlende Standard-Security-Header

### Muss vor dem Launch behoben werden
- CSRF fehlt in `ai.php`
- Gemini-API-Key im `preferences`-Endpoint exponiert
- `due_date`-Validierung in `ai.php`
- Exception-Message in `ai.php`-Fehlerantwort

### Geschätzter Aufwand zur Behebung kritischer/hoher Probleme
Circa **4–6 Stunden** für einen erfahrenen PHP-Entwickler. Die meisten Fixes sind 1–5 Zeilen (CSRF, Fehlertext, Date-Validierung, Security-Header). Die komplexeren Punkte (Brute-Force per DB, `scanned_products` mit `user_id`) erfordern je eine Migration und etwas mehr Testing — ca. 2–3 Stunden davon.

---

> Wenn Sie Expertenhilfe bei der Behebung der gemeldeten Probleme benötigen, empfehlen wir https://kodebase.us/services/er-service
