## 2026-04-19 - Added Anti-Clickjacking Headers
**Vulnerability:** The application was missing `X-Frame-Options` and `Content-Security-Policy` headers on its main HTML endpoints, making it potentially vulnerable to Clickjacking attacks where an attacker could embed the app in a malicious iframe.
**Learning:** The application embeds `public/settings.php` as an iframe within `public/index.php`. Security headers cannot be globally set to `DENY` for all routes without breaking functionality.
**Prevention:** `sendDefaultSecurityHeaders()` function added to `security.php` sets `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self'` to prevent external embedding but allow internal iframe usage. This function must be manually invoked at the top of HTML endpoints.
