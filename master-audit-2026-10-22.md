<!-- Hallmark · pre-emit critique: P5 H5 E5 S5 R4 V4 -->

# Master-Audit — Ankerkladde

**Audit-Datum:** 2026-10-22
**Scope:** PHP-/SQLite-Backend, Vanilla-ESM-Frontend, PWA/Service Worker, WebSocket-/Yjs-Dienst, Browser-Erweiterung, MCP-Server, Datenmodell, Kern-Workflows und UI/UX.
**Bewertung:** 0 kritisch · 7 hoch · 6 mittel · 5 niedrig · 3 Vorschläge

## Umsetzungsstand der hohen Risiken (2026-10-22)

- **Behoben:** authentisierte, kurzlebige WebSocket-Tickets; geschützter `/notify`-Endpoint; ungenutzte Yjs-Upgrades geschlossen.
- **Behoben:** AI-Endpunkte werden auf öffentliche HTTPS-Adressen beschränkt, DNS-geprüft und per cURL-Pinning gegen Rebinding abgesichert; private Ziele erfordern einen expliziten Betreiber-Opt-in.
- **Behoben:** TipTap, React und Excalidraw werden reproduzierbar lokal gebündelt und vollständig über den Service Worker vorgecached.
- **Behoben:** Login-Limits werden persistent in SQLite pro Nutzerkennung und IP-Präfix geführt und sind nicht mehr durch Cookie-Wechsel rücksetzbar.
- **Behoben:** Schemaänderungen laufen standardmäßig nur noch über `php scripts/migrate.php`; der Webpfad prüft ausschließlich die Schema-Version und bricht bei Rückstand kontrolliert ab.
- **Behoben (2026-10-24):** `api.php` ist auf HTTP-/Auth-Wiring und eine explizite Dispatch-Tabelle reduziert. Anwendungsfälle und Sicherheits-/Normalisierungshilfen liegen in eigenen Modulen unter `src/Api/`; eine Ownership-Prüfung verhindert neue Actions/SQL im Einstieg.
- **Behoben (2026-10-24):** Reservierung, Mutation und finale Idempotenz-Antwort committen gemeinsam. Innere Transaktionen sind Savepoints; fehlgeschlagene Antwortschreibvorgänge und Worker-Abbrüche rollen die Mutation zurück. Remote-Downloads halten während der Vorbereitung keine Schreibsperre. Bestehende Anhang-Dateien werden erst nach dem äußeren Commit bereinigt.

## Umsetzungsstand der mittleren Risiken (2026-10-23)

- **Behoben:** `/notify` verlangt ein Shared Secret, begrenzt Bodies auf 8 KiB und setzt Request-Timeouts; offene CORS-Header wurden entfernt.
- **Behoben:** Eigene API-Schlüssel liegen nur noch als SHA-256-Digest plus nicht sensibles Präfix vor und werden nur einmal angezeigt. AI-Provider-Schlüssel werden mit libsodium und einem außerhalb der SQLite-Datei liegenden Instanzschlüssel verschlüsselt; Schema-Migration 8 schützt Altbestände.
- **Behoben (2026-10-24):** Komponenten-Styles verwenden semantische Farbrollen; Statusflächen berücksichtigen die aktuelle Oberfläche, dunkle Themes überschreiben Statusfarben. Farbliterale sind auf Token-/Theme-Dateien beschränkt und werden automatisch geprüft. `style.css` bestimmt nur die Importreihenfolge der Komponenten unter `public/styles/`.
- **Behoben:** Mobile zeigt vier vorhersehbare Primäraktionen; seltenere Werkzeuge liegen beschriftet im zugänglichen „Mehr“-Menü statt in einer horizontalen Icon-Suchleiste.
- **Behoben:** Deutsche und englische Übersetzungsschlüssel sind vollständig identisch und werden durch `npm run test:i18n` geprüft. Quick-Add-AI sowie Produktscanner-Markup nutzen Übersetzungsschlüssel.
- **Behoben:** Die Service-Worker-Installation cached die kritische App-Shell atomar und aktiviert eine neue Version nicht mehr nach unvollständigem Precache.

## Restmaßnahmen und Nachprüfung (2026-10-24)

- **Behoben:** Alle fünf niedrigen Funde: freie Testports im npm-Wrapper, expliziter Vergleich von PHP-/SW-Version, datensparsame Storage-Diagnosen mit Parsefehler-Recovery, Entfernung der fünf veralteten Scratch-Skripte und Sketch-Reopen passend zur Deep-Link-Route. Die lokale Reuse-Konfiguration ist git-ignoriert; die Voraussetzung eines laufenden Servers ist dokumentiert.
- **Umgesetzt:** Negative WebSocket-Vertragstests für fehlende/gefälschte/abgelaufene Tickets, fremden Origin, wirkungslose fremde UID, Nutzerkanaltrennung, gesperrtes Yjs und Notify-Authentisierung/-Größenlimit. Tickets sind zusätzlich an den App-Origin gebunden und werden bereits vor dem Upgrade geprüft.
- **Umgesetzt:** Fehler-Injektion beim Idempotenz-Antwortschreiben mit nachgewiesenem vollständigem Rollback und anschließendem Retry/Replay; unabhängiger Worker-Abbruchtest und Savepoint-Prüfungen.
- **Nachprüfung korrigiert:** Der alte Service-Worker-Catch aktivierte trotz fehlgeschlagenem Precache weiterhin die neue Version. Dieser Pfad wirft jetzt den Fehler weiter. Ein geprüftes Manifest enthält sämtliche JS-/Komponenten-CSS-Dateien; auch Unterverzeichnis-Installationen, Editor-Chunks, Schriften und Icon-Endpunkte werden offline bedient.
- **Nachprüfung korrigiert:** Provider-Secrets wurden trotz sicherem `preferences`-Endpoint weiterhin über `categories_list` und den initialen HTML-Preferences-Block ausgeliefert. Beide verwenden jetzt dieselbe zentrale Redaction; ein HTTP-Smoke-Test prüft zusätzlich die Einstellungsseite.
- **Nachprüfung korrigiert:** Ein offener Login-SELECT-Cursor konnte bei parallelem Schreiben einen SQLite-Snapshot-Konflikt auslösen. Der Cursor wird vor Passwortprüfung und Rate-Limit-Update geschlossen.
- **Nachprüfung korrigiert:** Das Verschieben einer Kategorie bestimmt beide Tauschpartner jetzt unter `BEGIN IMMEDIATE`; konkurrierende Schreibzugriffe können keinen alten Lese-Snapshot mehr in einen fehlschlagenden Schreibversuch verwandeln.
- **Nachprüfung korrigiert:** Desktop-Headerwerkzeuge innerhalb eines geschlossenen `details` waren verborgen. Der Zustand wird jetzt beim Start und bei Breitenwechseln korrekt gesetzt.
- **Nachprüfung korrigiert:** Excalidraws öffentliche Asset-Basis enthielt das Verzeichnis `excalidraw-assets/` doppelt. Außerdem enthielten Drafts nicht serialisierbaren Laufzeitstatus (`collaborators`), der beim Wiederöffnen abstürzte. Die Basis ist korrigiert; gespeichert werden nur die upstream vorgesehenen App-State-Felder. Offline-Schließen ist möglich, wenn der Entwurf erfolgreich im Tab gespeichert wurde.
- **Architektur-Vorschläge umgesetzt:** API-/CSS-Ownership ist dokumentiert und automatisiert geprüft; siehe `docs/architecture-boundaries.md`. Neue Komponenten erhalten eigene Styles, neue Actions eigene Anwendungsfallmodule.
- **UX-/i18n-Verträge ergänzt:** Ein englischer Ablauf wechselt die Sprache über die Einstellungen, prüft benannte Primäraktionen, sichtbare Werkzeugbeschriftungen im mobilen Mehr-Menü und eine englische Validierungsantwort.
- **Test-Isolation ergänzt:** Die Worker-Fixture stellt neben Daten und Präferenzen auch die Sprache aus dem unveränderlichen Template wieder her; der Isolationstest verändert und prüft sie ausdrücklich. Ein englischer Test kann damit keine folgenden deutschen Abläufe umstellen.
- **Externe Validierung:** Moderierte Erstnutzer-Tests und produktionsseitige Proxy-/Firewall-/Backup-Prüfungen können durch Repository-Tests nicht ersetzt werden. Diese bleiben Betriebs-/Nutzungsnachweise, keine behaupteten erledigten Codekorrekturen.

Die folgenden Fundbeschreibungen dokumentieren den ursprünglichen Stand vom 22.10.;
die obigen Umsetzungsstände haben für den aktuellen Code Vorrang.

### Abschließende Verifikation — v5.4.18

- Vollständiger Playwright-Lauf mit vier Workern auf Desktop und Mobile:
  **126 bestanden, 10 planmäßig übersprungen, keine Fehler** (2,8 Minuten).
- Bestanden: PHP-Syntaxprüfung, Smoke-Test einschließlich Idempotenz-Fehlerinjektion
  und Secret-Redaction, DB-Migration, Revision/CAS, Tombstones/Undo, Quick-Add,
  AI-Migration und AI-Endpunktprüfung, Transaktions-/Worker-Abbruchtests,
  WebSocket-Sicherheitsverträge, Service-Worker-Verträge, Unit-, Asset-,
  Versions-, Übersetzungs-, Secret-Storage-, Design- und Architekturprüfungen.
- Der UI-Lauf umfasst den kalten Offline-Start beider Editoren, sichere
  Draft-Wiederöffnung, spätere Synchronisation und die gestaltete Offline-Ersatzseite.

## Executive Summary

Ankerkladde besitzt für eine frameworkfreie Anwendung eine ungewöhnlich starke funktionale Basis: Benutzer- und Mandantentrennung in den primären SQL-Pfaden, CSRF-Schutz, revisionsbasierte Konfliktbehandlung, idempotente Mutationen, Undo-Löschungen, Offline-Entwürfe und breite End-to-End-Tests sind erkennbar bewusst gebaut. Die ausgeführten Backend- und Smoke-Tests waren grün; die auf einen freien Port umgelegte Playwright-Suite bestätigte die zentralen Desktop- und Mobile-Journeys während des Audits.

Die größten verbleibenden Risiken liegen nicht im gewöhnlichen CRUD, sondern an Systemgrenzen: Der separat laufende WebSocket-Dienst authentisiert weder Nutzerkanäle noch Yjs-Räume, die angebliche SSRF-Sperre der frei konfigurierbaren AI-Basis-URL prüft nur das URL-Schema, und der Offline-Vertrag wird bei Rich-Text- und Zeicheneditoren durch Laufzeitimporte von fremden CDNs gebrochen. Zusätzlich sind Schema-Migration, Routing und Hilfslogik in einem 4.074-Zeilen-API-Skript beziehungsweise im Request-Boot gebündelt. Das erschwert sichere Änderungen und macht Fehler unter Last wahrscheinlicher.

Im UI ist die responsive Mechanik solide, aber die Hauptwerkzeugleiste ist visuell überladen und stark icon-basiert. Das Designsystem wird formal gestempelt, die CSS-Implementierung widerspricht diesem Stempel jedoch durch 145 direkte Farbwerte/Fallbacks außerhalb einer konsistenten Token-Schicht.

## Methodik und Nachweise

- Struktur- und Abhängigkeitsanalyse aller produktiven PHP-, JS-, CSS- und Node-Komponenten.
- Trace der Journeys Login, Kategorien, Quick Add, Item-CRUD, Anhänge, Notizen, Tagesansicht, Suche, Offline-Queue, Konfliktauflösung, Einstellungen und Live-Refresh.
- Statische Prüfung von Authentisierung, Autorisierung, CSRF, SSRF, Uploads, Transaktionen, Mandantentrennung, Service Worker, WebSocket und Rendering.
- Visuelle Prüfung der Desktop-/Mobile-Screenshots sowie Abgleich mit `design.md` und dem Hallmark-Audit.
- Ausgeführt und bestanden: PHP-Lint über alle PHP-Dateien, `npm run test:unit`, `npm run test:assets`, `npm run test:cache-versions`, `php scripts/test-security.php`, `bash scripts/test-db-migration.sh`, `bash scripts/smoke-test.sh`, Quick-Add- und AI-Migrationstests.
- Die Standard-UI-Ausführung scheiterte zunächst an einem belegten Port 4173. Mit `PLAYWRIGHT_PORT=43921 PLAYWRIGHT_WORKERS=4 npm run test:ui` wurden 119 Tests bestanden; 1 Test schlug fehl, 10 wurden projektbedingt übersprungen und 2 nach dem seriellen Fehler nicht mehr ausgeführt. Der Fehler ist unten als Testdesign-Problem dokumentiert. Der belegte Standard-Port ist ein eigener Infrastrukturpunkt.

# Funde nach Schweregrad

## 🚨 Hoch – WebSocket-Kanäle und Yjs-Räume sind nicht authentisiert
- **Kategorie:** Sicherheit / Mandantentrennung / Architektur
- **Betroffene Datei(en) / Komponente(n):** `websocket-server/server.js` (Zeilen 56–106, 111–165, 167–187), `public/js/app-init.js` (Zeilen 102–117)
- **Problembeschreibung:** Der Browser übermittelt die numerische Nutzer-ID als frei änderbaren Query-Parameter `?uid=...`. Der Node-Dienst übernimmt diesen Wert ohne Session-, Token- oder Origin-Prüfung und ordnet die Verbindung direkt dem gewünschten Raum zu. Auch `/yjs/note/{docName}` akzeptiert jeden frei gewählten Dokumentnamen. `/notify` ist ebenfalls ohne Geheimnis erreichbar und sendet bei fehlender `user_id` an alle Clients. Die Upgrade-Pfade akzeptieren außerdem jede sonstige URL als Notification-WebSocket.
- **Auswirkung:** Ein externer Client kann fremde Nutzerkanäle abonnieren, Updates vortäuschen und – sobald Yjs produktiv verbunden wird – fremden kollaborativen Dokumenträumen beitreten. Der aktuelle Notification-Payload enthält überwiegend Ereignisse statt Fachdaten; dennoch ist die Mandantengrenze an dieser Systemkante nicht vorhanden und zukünftige Payload-Erweiterungen würden unmittelbar zu einem Datenleck.
- **Lösungsvorschlag:** Kurzlebiges, serverseitig signiertes WS-Ticket mit `user_id`, Zweck, Raum und Ablaufzeit über einen authentisierten PHP-Endpunkt ausstellen. Beim Upgrade Signatur, Ablaufzeit, Origin und Raumzugehörigkeit prüfen; Yjs-Räume als `{userId}:{itemId}` bilden und den Besitz des Items serverseitig verifizieren. `/notify` ausschließlich intern binden oder mit Shared Secret/mTLS schützen. Unbekannte Upgrade-Pfade mit `socket.destroy()` ablehnen.

## 🚨 Hoch – AI-Basis-URL erlaubt SSRF trotz angeblichem Guard
- **Kategorie:** Sicherheit / SSRF
- **Betroffene Datei(en) / Komponente(n):** `src/AiClient.php` (Zeilen 140–155, 158–205, 334–380), `src/SettingsController.php` (Zeilen 509–539)
- **Problembeschreibung:** `validateAiBaseUrl()` akzeptiert pauschal jede `https://`-URL und prüft weder Hostauflösung noch private, Loopback-, Link-Local- oder Cloud-Metadata-Netze. DNS-Rebinding und interne HTTPS-Dienste werden nicht abgefangen. Ausgerechnet `http://localhost` und `http://127.0.0.1` werden explizit erlaubt. Danach sendet cURL Requests einschließlich eines nutzerkonfigurierten Bearer-Tokens an `/models` beziehungsweise `/chat/completions`.
- **Auswirkung:** Jeder normale Nutzer kann den Server als Request-Proxy in interne Netze verwenden, interne Dienste ansprechen und Antwort-/Statusinformationen auslesen. In Container-/Cloud-Umgebungen sind auch Management- und Metadatenziele relevant.
- **Lösungsvorschlag:** Für Mehrnutzerbetrieb eine Provider-Allowlist bevorzugen. Andernfalls Host normalisieren, DNS vor jedem Request auflösen, alle A/AAAA-Adressen gegen private/reservierte Netze sperren, Redirects deaktiviert lassen und den tatsächlich verbundenen Peer verifizieren. Lokale URLs nur über eine explizite Admin-Konfiguration erlauben, nicht pro Nutzer.

## 🚨 Hoch – Rich-Text- und Zeicheneditor brechen den Offline-/PWA-Vertrag
- **Kategorie:** Prozess-Lücke / Offline-Fähigkeit / Abhängigkeiten
- **Betroffene Datei(en) / Komponente(n):** `public/js/tiptap-init.js` (Zeilen 1–5), `public/js/sketch-editor.js` (Zeilen 13–16), `public/sw.js` (Zeilen 13–61, 170–207)
- **Problembeschreibung:** TipTap, React und Excalidraw werden zur Laufzeit von `esm.sh` beziehungsweise `unpkg.com` importiert. Der Service Worker ignoriert Cross-Origin-Requests explizit (`url.origin !== self.location.origin`) und kann diese Bibliotheken daher nicht für einen kalten Offline-Start bereitstellen. Gleichzeitig werden nur die lokalen Wrapper vorgecached.
- **Auswirkung:** Die App kann offline starten, aber Notizen und Zeichnungen lassen sich auf einem neuen Gerät, nach Cache-Löschung oder nach einem nicht vollständig geladenen Online-Besuch nicht öffnen. Damit ist die zentrale PWA-Aussage funktional nur teilweise wahr. CDN-Ausfall oder Supply-Chain-Änderungen blockieren Kerneditoren.
- **Lösungsvorschlag:** Abhängigkeiten versioniert lokal ausliefern oder in einen reproduzierbaren Vendor-Build bündeln und in `APP_SHELL_ASSET_URLS` aufnehmen. Danach einen echten Cold-Offline-E2E-Test hinzufügen: Browserprofil ohne HTTP-Cache, einmal installieren/synchronisieren, Netzwerk trennen, Notiz und Zeichnung öffnen/bearbeiten.

## 🚨 Hoch – Login-Rate-Limit ist durch neue Session vollständig umgehbar
- **Kategorie:** Sicherheit / Authentisierung
- **Betroffene Datei(en) / Komponente(n):** `public/login.php` (Zeilen 31–65, 67–105)
- **Problembeschreibung:** Fehlversuche werden ausschließlich in `$_SESSION['login_failures']` gezählt. Ein Angreifer verwirft den Cookie oder startet pro Versuch eine neue Session und bleibt dadurch dauerhaft unter der Freigrenze. Der Kommentar, automatisiertes Raten werde damit „unpraktisch“, ist sachlich falsch.
- **Auswirkung:** Online-Passwortangriffe gegen bekannte Nutzernamen bleiben praktisch ungedrosselt; zusätzlich erzeugt jeder Versuch neue Sessiondateien.
- **Lösungsvorschlag:** Persistentes, zeitfensterbasiertes Limit pro normalisiertem Nutzernamen plus IP-Präfix einführen, mit konstantem Antwortverhalten für existente/nicht existente Nutzer. Reverse-Proxy-IP nur nach vertrauenswürdiger Proxy-Konfiguration verwenden. Optional globales Burst-Limit am Webserver ergänzen.

## 🚨 Hoch – Schemaerkennung und Migration laufen im normalen Request-Pfad
- **Kategorie:** Architektur / Performance / Verfügbarkeit
- **Betroffene Datei(en) / Komponente(n):** `db.php` (Zeilen 456–700 und weitere Migrationen bis Dateiende)
- **Problembeschreibung:** `getDatabase()` öffnet nicht nur die Verbindung, sondern setzt WAL/PRAGMAs, prüft Tabellen und Spalten wiederholt über `PRAGMA table_info`, erstellt Tabellen/Indizes/Trigger und führt bedingte Datenmigrationen aus. Diese Funktion läuft beim ersten DB-Zugriff jedes PHP-Requests und vermischt Boot, Migration und Repository-Infrastruktur.
- **Auswirkung:** Zusätzliche Latenz auf jedem Request, unnötige Schema-Locks und schwer vorhersehbare Konkurrenz während Deployments. Eine teure oder fehlschlagende Migration legt die komplette Anwendung im Traffic-Pfad lahm. Horizontale Instanzen könnten dieselbe Migration parallel starten.
- **Lösungsvorschlag:** Versionierte, einmalige Migrationen in einen CLI-/Deploy-Schritt verschieben (`schema_migrations` mit monotoner Version). `getDatabase()` auf Verbindungsaufbau und PRAGMAs begrenzen. Startup-Healthcheck soll nur melden, wenn Migrationen fehlen, nicht sie unter Nutzertraffic ausführen.

## 🚨 Hoch – Zentraler API-Controller ist ein 4.074-Zeilen-Änderungs-Hotspot
- **Kategorie:** Architektur / Wartbarkeit / Fehleranfälligkeit
- **Betroffene Datei(en) / Komponente(n):** `public/api.php` (Zeilen 1–4074), insbesondere Dispatch Zeilen 2280–4060
- **Problembeschreibung:** HTTP-Transport, Idempotenz, WebSocket-Benachrichtigung, HTML-Sanitizing, SSRF-Schutz, Upload-/Remote-Download, Produktnormalisierung, Formatierung und etwa 30 Actions liegen in einer Datei. Parallel existieren bereits Repository-/Handler-Klassen, werden aber nur punktuell genutzt. Dadurch sind Abstraktionsgrenzen inkonsistent.
- **Auswirkung:** Änderungen an einem Workflow laden immer den gesamten Sicherheits- und Transaktionskontext mit. Reviews werden unzuverlässiger, Testbarkeit sinkt und versehentliche Unterschiede zwischen `add`, `update`, `quick_add`, `journal_save` und Sketch-Pfaden werden wahrscheinlicher.
- **Lösungsvorschlag:** Ohne Big-Bang schrittweise nach Use Case extrahieren: `RequestAuthenticator`, `IdempotencyService`, `RemoteFetchService`, `ItemController`, `JournalController`, `AttachmentController`, `ProductController`. Jeder Schritt behält den bestehenden Endpoint-Vertrag und bekommt zuerst Contract-/Integrationstests.

## 🚨 Hoch – Mutations-Erfolg und Idempotenz-Response werden nicht atomar abgeschlossen
- **Kategorie:** Race Condition / Fehlerbehandlung / Datenkonsistenz
- **Betroffene Datei(en) / Komponente(n):** `public/api.php` (Zeilen 51–103, 274–347, 4061–4073)
- **Problembeschreibung:** Die Fachmutation wird in den jeweiligen Actions committed; erst beim späteren `respond()` wird die gespeicherte Idempotenz-Antwort aktualisiert. Scheitert dieses UPDATE oder der DB-Zugriff nach erfolgreichem Commit, liefert der globale Handler 500, während die Mutation bereits dauerhaft ist und der Reservierungssatz bis zu drei Stunden auf Status 0 stehen kann.
- **Auswirkung:** Der Nutzer sieht einen Fehlschlag, obwohl Daten verändert wurden. Ein Retry erhält 409 „in Bearbeitung“ statt der ursprünglichen Antwort. Das ist genau der Fall, den Idempotenz eigentlich transparent lösen soll.
- **Lösungsvorschlag:** Mutation und finale Idempotenz-Antwort in derselben DB-Transaktion schreiben oder ein explizites Outbox-/Operation-Result-Muster verwenden. Fehlerantworten dürfen eine bereits committete Mutation nicht als allgemeinen 500 maskieren. Einen Integrationstest für „Commit erfolgreich, Response-Cache-Write schlägt fehl“ ergänzen.

## ⚠️ Mittel – Notification-Endpunkt hat weder Authentisierung noch Größenlimit
- **Kategorie:** Sicherheit / DoS / Ressourcenmanagement
- **Betroffene Datei(en) / Komponente(n):** `websocket-server/server.js` (Zeilen 56–106)
- **Problembeschreibung:** Der HTTP-Server hängt jeden eingehenden Chunk unbegrenzt an einen String. Es gibt kein Body-Limit, keinen Timeout, keine Content-Type-Prüfung und keine Authentisierung. CORS ist pauschal `*`.
- **Auswirkung:** Bei externer Erreichbarkeit sind Speicherverbrauch durch große/angehaltene Bodies und beliebige Broadcasts möglich. Selbst intern vergrößert die offene Schnittstelle den Blast Radius eines kompromittierten Containers.
- **Lösungsvorschlag:** Server nur im internen Netz binden, Shared Secret prüfen, maximal wenige KiB akzeptieren, Request-/Header-Timeouts setzen, JSON-Schema validieren und CORS entfernen.

## ⚠️ Mittel – API- und AI-Schlüssel werden reversibel im Klartext gespeichert
- **Kategorie:** Secrets Management
- **Betroffene Datei(en) / Komponente(n):** `db.php` (Zeilen 612–648), `src/UserRepository.php` (Zeilen 85–110, 147–175), `public/settings.php` (Zeilen 542–568)
- **Problembeschreibung:** Nutzer-API-Keys und externe AI-Provider-Keys liegen direkt in `users.api_key` beziehungsweise `preferences_json`. Der API-Key muss zur Authentisierung nicht wieder auslesbar sein; dennoch wird er im Klartext verglichen und in den Einstellungen vollständig angezeigt.
- **Auswirkung:** Eine gelesene SQLite-Datei, ein Backup oder ein DB-Leak kompromittiert sofort Browser-Erweiterungszugänge und externe Providerkonten aller Nutzer.
- **Lösungsvorschlag:** Eigene API-Keys nur einmal anzeigen und danach mit HMAC/Argon2-verifizierbarem Hash plus Prefix speichern. Provider-Secrets mit einem außerhalb der DB gehaltenen Instanzschlüssel verschlüsseln; im UI ausschließlich „gesetzt“ und letzte Zeichen anzeigen. Rotation und Backup-Dokumentation ergänzen.

## ⚠️ Mittel – Designsystem-Stempel widerspricht der ausgelieferten CSS-Realität
- **Kategorie:** UI-Inkonsistenz / Designsystem / Hallmark „stamp lies“
- **Betroffene Datei(en) / Komponente(n):** `public/style.css` (Zeilen 1–36 sowie zahlreiche direkte Farbwerte, z. B. 1082–1122, 1172, 1706–1723, 5598–5953), `design.md`
- **Problembeschreibung:** Der Kopf behauptet `tokens: pass (48)` und `design-system: design.md`. Tatsächlich enthält die Datei 145 Hex-/RGB-/OKLCH-Vorkommen, viele davon in Komponentenregeln statt ausschließlich im Tokenblock. Status-Chips, Scanner, Admin, Toasts und Produktbadges erfinden eigene Paletten und Fallbacks. Die primären Root-Tokens sind zudem alte Aliasnamen (`--bg`, `--surface`, `--accent`) mit anderen Werten als die in `design.md` gesperrten Rollen.
- **Auswirkung:** Theme-Wechsel können unvollständige oder kontrastarme Mischzustände erzeugen; Änderungen erfordern globale Suche statt Tokenanpassung. Der Audit-Stempel vermittelt falsche Sicherheit.
- **Lösungsvorschlag:** Stempel bis zur Bereinigung ehrlich auf `tokens: FAIL` setzen. Semantische Rollen für Erfolg/Warnung/Gefahr/Overlay/Scanner/Nutri-Grade definieren, alle Komponentenwerte dorthin heben und Themes nur Rollen überschreiben lassen. Automatischen Lint-Check gegen Farbliterale außerhalb deklarierter Tokenblöcke ergänzen.

## ⚠️ Mittel – Hauptnavigation ist auf Mobile eine horizontale Icon-Suchaufgabe
- **Kategorie:** UX / Responsive Design / Informationsarchitektur
- **Betroffene Datei(en) / Komponente(n):** `public/index.php` (Zeilen 155–177), `public/style.css` (Header-/Mobile-Regeln), Screenshots `mobile-02-einkauf.png` und `desktop-01-einkauf.png`
- **Problembeschreibung:** Bis zu neun gleichgewichtete, ausschließlich ikonische Werkzeuge sitzen zusätzlich zur Marken-/Moduszeile im Header. Auf Mobile läuft die Reihe sichtbar über den rechten Rand und weitere Aktionen werden nur durch horizontales Erkunden erreichbar. Mehrere Symbole (z. B. Modus, Layout, Tabs, Scanner, Journal, Magic) sind ohne Label semantisch schwer unterscheidbar. Die vorhandenen ARIA-Labels helfen Screenreadern, nicht sehenden Touch-Nutzern.
- **Auswirkung:** Kernaktionen haben geringe Auffindbarkeit, versehentliche Bedienung wird wahrscheinlicher und neue Funktionen verschärfen das Problem linear. Das UI wirkt trotz guter Touch-Ziele wie eine Werkzeugpalette ohne Priorisierung.
- **Lösungsvorschlag:** Häufigkeit und Kontext nutzen: maximal 3–4 kontextuelle Primäraktionen sichtbar, seltene Aktionen in ein beschriftetes Overflow-/Command-Menü; aktive Zustände mit Text oder persistentem Tooltip erklären. Horizontalen Scrollbereich mit deutlichem affordance versehen oder vermeiden. Nutzertest mit Erstnutzern statt nur Erreichbarkeitstest.

## ⚠️ Mittel – Internationalisierung fällt sichtbar auf Deutsch zurück
- **Kategorie:** UI-Inkonsistenz / Lokalisierung
- **Betroffene Datei(en) / Komponente(n):** `lang/de.json`, `lang/en.json`, `i18n.php` (Zeilen 63–99), `public/index.php` (Zeile 233), `public/barcode.php` (Zeilen 59–71), mehrere JS-Statusmeldungen
- **Problembeschreibung:** Englisch hat mindestens vier Schlüssel weniger (`error.item_revision_conflict`, `error.revision_invalid`, `error.revision_required`, `msg.item_conflict_remote_update`). Das Merge-Verhalten `en + de` kaschiert dies durch deutsche Fallbacks. Zusätzlich stehen sichtbare Strings wie „Mit AI klären“ und der gesamte Barcode-Seitenkopf direkt im Markup; diverse Konflikt-/Fehlermeldungen sind ebenfalls hartcodiert.
- **Auswirkung:** Englische Nutzer erhalten gemischtsprachige kritische Fehler- und Konfliktdialoge. Neue Strings können Tests bestehen, obwohl die Übersetzung fehlt.
- **Lösungsvorschlag:** CI-Prüfung auf identische Schlüsselsets einführen, sichtbare Literaltexte in `t()` überführen und einen Playwright-Smoke-Flow komplett mit englischem Nutzer ausführen. Fallback in Entwicklung loggen oder dort hart fehlschlagen.

## ⚠️ Mittel – Service-Worker-Installation meldet Erfolg trotz unvollständigem App-Shell-Cache
- **Kategorie:** Fehlerbehandlung / Offline-Fähigkeit
- **Betroffene Datei(en) / Komponente(n):** `public/sw.js` (Zeilen 110–126)
- **Problembeschreibung:** `Promise.allSettled(cache.add(...))` verwirft sämtliche individuellen Fehler und loggt immer „Precache complete“. Selbst `offline.html` darf fehlen; anschließend wird trotzdem `skipWaiting()` ausgeführt.
- **Auswirkung:** Eine neue Version kann den alten, funktionierenden Worker ersetzen, obwohl zentrale Assets nicht im Cache liegen. Der Fehler wird erst beim Offline-Einsatz sichtbar und ist diagnostisch nicht unterscheidbar.
- **Lösungsvorschlag:** Kritische Minimalmenge (`offline.html`, CSS, Entry-Module, Icon) mit `Promise.all` atomar cachen; optionale Assets separat mit protokollierter Fehlerliste. Aktivierung nur nach erfolgreichem Kerncache, plus Offline-Installations-E2E-Test.

## ▫️ Niedrig – Standard-UI-Testlauf kollidiert hart mit Port 4173
- **Kategorie:** QA / Testinfrastruktur
- **Betroffene Datei(en) / Komponente(n):** `playwright.config.cjs` (Portermittlung und `reuseExistingServer: false`), `playwright.reuse.cjs`
- **Problembeschreibung:** `npm run test:ui` bricht sofort ab, wenn 4173 belegt ist. Die Reuse-Konfiguration erwartet dagegen hart Port 4210 und startet keinen Server; ohne manuelles Setup endet auch sie früh.
- **Auswirkung:** Lokale und parallele CI-Läufe sind unnötig fragil; Entwickler könnten die UI-Suite deshalb überspringen.
- **Lösungsvorschlag:** Einen freien Port im Test-Wrapper reservieren oder pro CI-Job explizit setzen. Reuse-Skript als dokumentierten Zwei-Schritt-Befehl ausführen oder entfernen. Fehlermeldung soll PID/Port und empfohlenen Befehl nennen.

## ▫️ Niedrig – Versionsquellen sind sichtbar auseinander gelaufen
- **Kategorie:** Inkonsistenz / Release-Prozess
- **Betroffene Datei(en) / Komponente(n):** `public/sw.js` (Zeile 3: `v5.4.2`), Testausgabe von `scripts/check-js-cache-versions.php`/`public/version.php` (`5.4.10`)
- **Problembeschreibung:** Der Service Worker besitzt weiterhin eine manuelle Versionskonstante, während die App-Version separat in PHP geführt wird. Der vorhandene Cache-Versionstest meldet interne Importversionen als konsistent, deckt diese Abweichung aber offenbar nicht ab.
- **Auswirkung:** Deployments können alten App-Shell-Cache behalten oder unerwartete Controller-Wechsel auslösen; Diagnose und reproduzierbare Releases werden erschwert.
- **Lösungsvorschlag:** `sw.js` beim Deploy aus `public/version.php` generieren oder Version als ausgeliefertes Manifest injizieren. Den Check explizit beide Quellen vergleichen lassen.

## ▫️ Niedrig – Produktionscode enthält stumme Catch-Blöcke
- **Kategorie:** Fehlerbehandlung / Observability
- **Betroffene Datei(en) / Komponente(n):** `browser-extension/content.js` (Zeile 79), `public/js/settings-state.js` (Zeile 27), Inline-Bootscripts in `public/theme.php` und `public/index.php`
- **Problembeschreibung:** Mehrere Fehler werden vollständig verschluckt. Bei korruptem Local-/Session-Storage oder unerwarteten Browserfehlern existiert weder Telemetrie noch ein gezielter Recovery-Pfad.
- **Auswirkung:** Nutzer sehen zurückgesetzte Präferenzen oder fehlendes Verhalten, während Support und QA keine Ursache erkennen können.
- **Lösungsvorschlag:** Erwartbare Parsefehler gezielt behandeln, betroffenen Key isoliert zurücksetzen und in Development beziehungsweise über eine datensparsame Diagnoseoberfläche melden. Keine vollständigen Payloads mit Nutzerdaten loggen.

## ▫️ Niedrig – Repository enthält veraltete Scratch-Skripte mit absoluten Entwicklerpfaden
- **Kategorie:** Toter Code / Repository-Hygiene
- **Betroffene Datei(en) / Komponente(n):** `scratch/refactor.py`, `scratch/split_settings.py`, `scratch/add_conflict_ui.py`, weitere `scratch/*`
- **Problembeschreibung:** Hilfsskripte referenzieren unter anderem `/home/oliver/Dokumente/ankerkladde` und schreiben Dateien außerhalb des aktuellen Worktrees. Sie sind weder dokumentiert noch in Tests eingebunden.
- **Auswirkung:** Versehentliches Ausführen kann die falsche Kopie verändern; neue Mitwirkende können Zweck und Aktualität nicht beurteilen.
- **Lösungsvorschlag:** Entfernen/archivieren oder in robuste, dokumentierte Repo-Skripte mit relativem Root und Dry-Run umwandeln.

## ▫️ Niedrig – Sketch-Konflikttest verwechselt korrektes Deep-Link-Reopen mit geschlossenem Editor
- **Kategorie:** QA / Testdesign
- **Betroffene Datei(en) / Komponente(n):** `tests/ui/flows/13-sketch-conflicts.spec.js` (Zeilen 41–45, 99–116), `public/js/navigation.js` (Sketch-Routen)
- **Problembeschreibung:** Nach „Server-Skizze übernehmen“ ruft der Test erneut `openDrawing()` auf. Diese Hilfsfunktion lädt zuerst die Seite neu und klickt danach die Item-Karte. Die URL enthält jedoch weiterhin die Sketch-Route; der Reload öffnet den Editor bereits korrekt per Deep Link. Der nachfolgende Karten-Klick wird deshalb vom sichtbaren Excalidraw-Canvas abgefangen und läuft in den Timeout. Ergebnis des Audit-Laufs: 119 bestanden, 1 fehlgeschlagen, 10 übersprungen, 2 wegen der seriellen Suite nicht ausgeführt.
- **Auswirkung:** Die Suite meldet einen Produktfehler, obwohl der konkrete Fehler aus widersprüchlichen Testannahmen entsteht; zwei weitere Sketch-Nachweise laufen danach gar nicht mehr.
- **Lösungsvorschlag:** `openDrawing()` zuerst prüfen lassen, ob `.sketch-editor-overlay` bereits sichtbar ist, und nur andernfalls Kategorie/Item klicken. Alternativ vor dem Reload explizit auf die Listenroute navigieren. Danach die drei seriellen Sketch-Tests erneut isoliert und in der Gesamtsuite ausführen.

## 💡 Vorschlag – Sicherheits- und Architekturgrenzen als Contract-Tests festschreiben
- **Kategorie:** QA / Prävention
- **Betroffene Datei(en) / Komponente(n):** `tests/`, `websocket-server/`, `src/AiClient.php`
- **Problembeschreibung:** Die existierenden Tests sind stark bei UI-Konflikten, prüfen aber nicht WS-Authentisierung, interne SSRF-Ziele, Secret-Redaction oder atomare Idempotenzfehler.
- **Auswirkung:** Gerade die risikoreichsten Systemgrenzen können regressieren, obwohl 100+ UI-Tests grün bleiben.
- **Lösungsvorschlag:** Negative Contract-Tests ergänzen: fremde UID/Yjs-Räume = 401/403; private/Link-Local/DNS-Rebinding-Ziele = abgelehnt; Secrets fehlen in HTML/API/Logs; simuliertes Idempotenz-Finalisierungsversagen bleibt retrybar.

## 💡 Vorschlag – API- und CSS-Dateigröße mit Architektur-Budgets begrenzen
- **Kategorie:** Architektur / Wartbarkeit
- **Betroffene Datei(en) / Komponente(n):** `public/api.php`, `public/style.css`
- **Problembeschreibung:** Mit 4.074 beziehungsweise 7.516 Zeilen sind beide Dateien faktische Monolithen. Die Größe allein ist kein Bug, zeigt hier aber reale vermischte Verantwortlichkeiten.
- **Auswirkung:** Jede Erweiterung erhöht Reviewkosten und Kopplung; Agenten und Menschen übersehen leichter Seiteneffekte.
- **Lösungsvorschlag:** Kein pauschales Zeilenlimit, sondern Ownership-Budgets: neue API-Actions nur noch in Use-Case-Modulen, neue UI-Komponenten in komponentennahen Stylesheets; gemeinsame Tokens und Utilities zentral lassen.

## 💡 Vorschlag – UX-Tests um Verständlichkeit statt nur Erreichbarkeit erweitern
- **Kategorie:** UX / QA
- **Betroffene Datei(en) / Komponente(n):** `tests/ui/flows/05-mobile-critical.spec.js`, `tests/ui/flows/23-responsive-widths.spec.js`
- **Problembeschreibung:** Die Tests belegen Touch-Zielgröße, Overlay-Schließbarkeit und fehlenden horizontalen Body-Overflow. Sie können nicht erkennen, ob Nutzer die neun Headericons verstehen oder eine Funktion ohne Vorwissen finden.
- **Auswirkung:** Formal responsive UI kann praktisch schwer bedienbar bleiben.
- **Lösungsvorschlag:** Für Primäraktionen sichtbare/beschriftete Namen und eindeutige aktive Zustände als DOM-Contracts testen; ergänzend moderierte Kurztests mit Aufgaben „Neue Notiz“, „Barcode scannen“, „Ansicht wechseln“ durchführen.

## Priorisierte Maßnahmen

1. WebSocket-/Yjs-Authentisierung und internes `/notify` absichern.
2. AI-SSRF-Schutz auf Ziel-IP-Ebene beziehungsweise Provider-Allowlist umstellen.
3. TipTap/Excalidraw lokal ausliefern und Cold-Offline testen.
4. Persistentes Login-Rate-Limit einführen.
5. Migrationen aus dem Request-Pfad lösen.
6. Idempotenzabschluss atomar machen.
7. Danach API/CSS schrittweise modularisieren und Header-Navigation vereinfachen.

## Positive Beobachtungen

- Primäre CRUD-Queries prüfen überwiegend `user_id`; Attachment-Streaming leitet Pfade aus DB-Datensätzen ab und erzwingt Mandantenbesitz.
- CSRF ist auf mutativen Sessionpfaden systematisch vorhanden; API-Key-Aufrufe werden bewusst getrennt behandelt.
- Revision/CAS, stabile Idempotency-Keys, Offline-Drafts, Konfliktansichten und Undo-Tombstones adressieren reale Mehrtab-/Netzwerkfehler statt nur Happy Paths.
- Uploads validieren Größe, MIME-Typ und serverseitige Dateinamen; Dateien liegen außerhalb des Webroots.
- Sicherheitsheader wurden gegenüber älteren Auditständen verbessert: `nosniff`, Referrer-Policy und bedingtes HSTS sind vorhanden.
- Mobile Breiten 320/375/414/768 px, Tastatur-Schließbarkeit und 44-px-Ziele sind explizit getestet.

## Verifizierungsgrenzen

- Kein aktiver Angriff gegen eine Produktionsinstanz wurde durchgeführt.
- Reverse-Proxy-, Firewall-, Backup- und Host-Hardening außerhalb der Repo-Konfiguration konnten nicht verifiziert werden.
- Farbkontrast wurde anhand Code/Screenshots beurteilt, nicht mit einer vollständigen Messmatrix aller Themes und Zustände.
- Die Playwright-Suite wurde auf einen freien Port verlegt. Ergebnis: 119 bestanden, 1 fehlgeschlagen, 10 übersprungen, 2 nicht ausgeführt; der Fehlschlag ist als eigener QA-Fund dokumentiert. Dies ist keine Behauptung über externe Produktionsdaten.
