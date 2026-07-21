# Modell-Discovery für KI-Provider

Ergänzt ADR-0009: KI-Provider bieten einen Mechanismus zur Abfrage ihrer verfügbaren Modelle. Das Settings-UI lädt diese Liste explizit auf Knopfdruck und bietet sie als HTML5-`<datalist>` an einem Texteingabefeld an. Der Nutzer kann jederzeit einen Modellnamen tippen, der nicht in der Liste steht; das Dropdown ist reiner Komfort, keine Schranke.

Zwei Endpoints werden genutzt: Google Gemini über `GET https://generativelanguage.googleapis.com/v1beta/models?key=…`, gefiltert auf Modelle mit `supportedGenerationMethods ⊇ "generateContent"`, normalisiert auf die Modell-ID ohne `models/`-Präfix. OpenAI-kompatibel über `GET {basis-url}/models` mit `Authorization: Bearer <key>`, gefiltert auf Objekte mit nicht-leerem `id`. LiteLLM und andere kompatible Endpoints verhalten sich identisch zur OpenAI-Form.

Der Listenlade-Call sitzt in einem eigenen Backend-Endpoint `ai-models.php`, nicht im bestehenden `ai.php`, weil der Listenlade-Aufruf semantisch nichts mit der Magic Bar zu tun hat. Beide Calls sind CSRF-geschützt und nutzen dieselbe Provider-Konfiguration wie `callAiProvider`, sodass sich Header-Aufbau, Timeout und SSRF-Guard nicht duplizieren.

Im UI liegt rechts neben dem bestehenden Knopf „Verbindung testen" ein zweiter Knopf „Modelle laden". Erst lädt der Nutzer (oder hat schon) den Test-Klick gemacht, dann holt er die Modelle. Die Reihenfolge ist deshalb getrennt, weil der Test-Call ohne Modellnamen auskommt (er schickt nur „Hi") und schneller und billiger ist. Ein kombinierter Auto-Reload wäre bequemer, versteckt aber Latenz und Fehler; ein expliziter Knopf lässt den Nutzer entscheiden.

Die Modell-Liste wird im Frontend pro `(provider, basis-url, api-key-hash)` im Modul-State gecached, sodass ein zweiter Klick ohne Änderungen sofort das Dropdown füllt. Ändert sich URL oder Key, wird der Cache ungültig. Es gibt keinen DB-Cache: LiteLLM kann morgen zwanzig neue Modelle anbieten, der Nutzer will das ohne Server-Migration sehen. Cache-TTL ist effektiv „bis Reload oder Input-Änderung".

Bewusst nicht umgesetzt: gemeinsames Modell-Caching über mehrere Nutzer hinweg,悲观 Serving der Discovery-Ergebnisse für Multi-User-Server und automatische Aktualisierung im Hintergrund (alle drei sind YAGNI, solange Ankerkladde eine Single-User-PWA ist).
