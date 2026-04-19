---
name: Ankerkladde Security Architecture
description: Überblick über implementierte Sicherheitsmechanismen und bekannte Lücken (Stand 2026-04-19)
type: project
---

CSRF korrekt implementiert: GET-Requests sind Auth-gesichert, CSRF nur auf schreibende POST-Aktionen. API-Key-Auth überspringt CSRF korrekt (isApiKeyAuthRequest()).

SQL: Alle DB-Zugriffe über PDO Prepared Statements — kein Injection-Risiko erkennbar.

XSS: Alle HTML-Ausgaben durch htmlspecialchars() geschützt. Rich-Text-Inhalte durch sanitizeRichTextHtml() (DOMDocument-basiert) bereinigt.

Attachment-Pfade: Ausschließlich aus DB-Einträgen abgeleitet (getAttachmentAbsolutePath) — kein Path-Traversal durch User-Input möglich.

SSRF (fetch_metadata-Endpunkt): Schutz durch isAllowedRemoteUrl() mit DNS-Auflösung und Private-Range-Prüfung. SSL-Verifikation aktiv.

Offene Lücken:
- Fehlende Security-Header (CSP, X-Frame-Options) auf HTML-Seiten (index.php, login.php, settings.php, admin.php) — Medium-Priorität, noch nicht behoben (Stand 2026-04-19).

**Why:** SQLite-Backend ohne Cache-Schicht (kein Redis/Memcached) schränkt Lösungsoptionen für Rate-Limiting ein.
**How to apply:** Bei neuen Endpunkten auf Brute-Force-Vektoren prüfen. Header-Lücke als nächstes Audit-Ziel vormerken.
