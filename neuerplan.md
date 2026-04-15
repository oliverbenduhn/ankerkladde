# Ankerkladde: Projekt-Modernisierungs-Plan (2026)

Dieses Dokument fasst die architektonischen Änderungen und die ursprünglichen Ideen zusammen, die im Rahmen des großen Refactorings im April 2026 umgesetzt wurden.

## 1. Architektonische Meilensteine (Erledigt)

### 🧩 Modularisierung (ESM)
Der 3400-Zeilen Monolith `app.js` wurde in ein sauberes Modul-System überführt.
- **Vorteil**: Bessere Wartbarkeit, Isolation von Fehlern, schnellere Ladezeiten durch granulare Updates.
- **Module**: `state.js`, `api.js`, `ui.js`, `theme.js`, `navigation.js`, `items.js`, `router.js`, `swipe.js`, `utils.js`, `scanner.js`, `editor.js`.

### ⚓ Zentrales Asset-Management
Einführung der `public/assets.php` als Single Source of Truth.
- **Icons**: SVG-Icon-Bibliothek zentralisiert (keine Duplikate mehr in JS und PHP).
- **Versioning**: Automatisches Cache-Busting via `filemtime()`. Nie wieder "leere Browser-Caches" erzwingen.

### 🛡️ Sicherheits-Hardening
- **Sanitizer**: Der HTML-Sanitizer in `api.php` wurde auf ein striktes Whitelist-Prinzip umgestellt, um XSS-Angriffe (besonders in Notizen) effektiv zu verhindern.
- **API-Patching**: Umstellung der Einstellungen auf ein Patch-System (nur Änderungen senden), um Race Conditions zwischen mehreren offenen Tabs zu vermeiden.

## 2. UX & Design Upgrades (Erledigt)

### 🌊 Nautisches Design-System
- **8 Themes**: Erweiterung auf 4 helle (Hafenblau, Parchment, Seebrise, Logbuch) und 4 dunkle Themes (Nachtwache, Pier, Tiefsee, Kajüte).
- **Theme-Galerie**: Visuelle Auswahlkacheln in den Einstellungen mit Live-Vorschau-Funktion.

### 📱 Mobile Excellence
- **Swipe-Gesten**: Horizontales Wischen ermöglicht den schnellen Wechsel zwischen Kategorien.
- **Routing**: Integration einer URL-Synchronisation. Der "Zurück-Button" des Browsers/Handys funktioniert nun innerhalb der App-Bereiche.

### 🔍 Suche & Performance
- **Live-Suche**: Wiederherstellung und Optimierung der globalen Suche über alle Kategorien hinweg.
- **CI/CD Fix**: Anpassung der GitHub Actions (Smoke-Tests) an die neue Modul-Infrastruktur.

## 3. Offene Punkte & Zukünftige Ideen

- [ ] **Haptik-Feedback**: Optionale Vibration bei Scans/Aktionen (Einstellungsmenü).
- [ ] **SortableJS Migration**: Überführung der Drag&Drop-Logik in ein eigenes Modul (aktuell noch passiv).
- [ ] **Offline-Feedback**: Visueller Indikator, wenn die App keine Verbindung zum Server hat.
- [ ] **Automatisches Logging**: Zentrales Fehler-Protokoll auf dem Server für Admin-Diagnose.

---
**Status**: Die App ist nun technologisch auf dem modernsten Stand (ES6+, PWA, Modularer Core).
