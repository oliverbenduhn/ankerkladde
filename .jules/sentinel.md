# Sentinel Security Journal — Ankerkladde

## 2026-04-19 - Fehlender Brute-Force-Schutz im Login

**Vulnerability:** `public/login.php` rief `password_verify()` ohne jede Verzögerung oder Versuchszählung auf. Ein Angreifer konnte unbegrenzt Passwörter ausprobieren (nur durch CSRF-Token und Session-Binding leicht gebremst, aber Script-gesteuerte Session-Cookies sind trivial).

**Learning:** Die App nutzt SQLite ohne persistente Cache-Schicht (kein Redis, kein Memcached). Deshalb ist ein sessionbasierter Fehlversuchs-Counter mit exponentiellem `usleep()`-Delay die passende Lösung — kein zusätzlicher Datenbankstatus nötig, kein neues Deployment-Dependency.

**Prevention:** Login-Formulare immer mit Delay oder Lockout absichern. Für diese App: `$_SESSION['login_failures']` zählen, ab Versuch 6 exponentiellen Delay (2^(n-5) Sekunden, max. 30 s) einsetzen. Implementiert in v4.2.14.

---

## 2026-04-19 - Fehlende Content-Security-Policy und X-Frame-Options auf HTML-Seiten

**Vulnerability:** Alle HTML-Seiten (`index.php`, `login.php`, `settings.php`, `admin.php`, `barcode.php`) sendeten keine `Content-Security-Policy`- und keine `X-Frame-Options`-Header. Dadurch war Clickjacking möglich und Browser-seitige XSS-Mitigationen fehlten vollständig.

**Learning:** Die App hat Inline-Skripte (`renderThemeBootScript()`, Magic-Bar, Settings-Theme-Picker) und lädt TipTap-ESM-Module von `https://esm.sh` — nur in `index.php`. Deshalb braucht die CSP ein zweistufiges Design: Standardpolicy für alle Seiten, erweiterte Policy (mit `https://esm.sh`) nur für `index.php`.

**Prevention:** Zentrale Funktion `sendHtmlPageSecurityHeaders(bool $allowEsmSh = false)` in `security.php` — direkt nach `enforceCanonicalRequest()` in jeder HTML-Seite aufrufen. `'unsafe-inline'` ist nötig wegen Inline-Skripten; für zukünftige Seiten ohne Inline-Skripte könnten Nonces eingesetzt werden.

---

## Architektur-Notizen (für künftige Audits)

- **CSRF:** Korrekt implementiert. GET-Anfragen (fetch_metadata, product_details etc.) sind Auth-gesichert, CSRF nur auf schreibende Aktionen. API-Key-Auth überspringt CSRF korrekt.
- **Attachment-Pfade:** Werden ausschließlich aus DB-Einträgen abgeleitet — kein Path-Traversal-Risiko durch User-Input.
- **SQL-Injection:** Alle DB-Zugriffe nutzen PDO Prepared Statements — kein Handlungsbedarf.
- **XSS:** Alle Ausgaben in HTML-Seiten konsequent durch `htmlspecialchars()` geschützt. Rich-Text-Content wird über `sanitizeRichTextHtml()` mit DOMDocument gefiltert.
- **SSRF:** `fetch_metadata`-Endpunkt schützt sich durch `isAllowedRemoteUrl()` mit IP-Prüfung und DNS-Auflösung gegen Private-Range-Adressen. SSL-Verifikation ist aktiv (`CURLOPT_SSL_VERIFYPEER => true`).
- **Security-Header:** Alle HTML-Seiten (`index.php`, `login.php`, `settings.php`, `admin.php`, `barcode.php`) senden `Content-Security-Policy` und `X-Frame-Options: DENY` via zentrale Funktion `sendHtmlPageSecurityHeaders()` in `security.php`. Behoben in v4.2.15.
