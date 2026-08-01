# Design — Ankerkladde

Ein gesperrtes Designsystem für die gesamte App. Jede Seitenüberarbeitung liest
diese Datei zuerst. Das System wird erweitert oder geändert, nicht pro Seite neu
erfunden.

## Genre

Editorial — taktil, arbeitsnah und ruhig. Die App fühlt sich wie eine gut
benutzte Kladde an, ohne Papier zu imitieren.

## Makrostruktur-Familien

- Marketing- und Einstiegsseiten: **Split Studio**; Text und konkrete Handlung
  stehen in einem ungleichen Diptychon.
- App-Seiten: **Workbench**; Werkzeuge bleiben kompakt, der Arbeitsinhalt erhält
  den größten Teil des Viewports.
- Inhaltsseiten: **Long Document**; eine ruhige Lesespalte ohne Kartenraster.

## Theme

- `--color-paper` oklch(96% 0.014 78)
- `--color-paper-2` oklch(93% 0.016 76)
- `--color-paper-3` oklch(89% 0.018 74)
- `--color-ink` oklch(22% 0.028 248)
- `--color-ink-2` oklch(34% 0.032 244)
- `--color-rule` oklch(78% 0.025 232)
- `--color-rule-2` oklch(85% 0.019 226)
- `--color-accent` oklch(44% 0.12 242)
- `--color-accent-ink` oklch(97% 0.012 78)
- `--color-focus` oklch(56% 0.19 242)

Die vorhandenen auswählbaren Themes dürfen diese Farbrollen ersetzen. Form,
Typografie, Dichte, Zustände und Komponentenstimme bleiben dabei identisch.

## Typografie

- Display: Iowan Old Style / Palatino, Gewicht 700, Stil normal
- Body: native UI-Sans, Gewicht 400
- Mono: native UI-Monospace, Gewicht 500
- Display-Tracking: -0.035em
- Type-Scale-Anker: `--text-display = clamp(2.5rem, 4vw + 1rem, 4.75rem)`

Die native Paarung ist bewusst offline-fähig und bewahrt den bestehenden
PWA-Vertrag. Überschriften sind niemals kursiv.

## Spacing

4-Punkt-Skala aus `tokens.css`. Neue Regeln verwenden benannte Tokens statt
roher Abstände.

## Motion

- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`
- Muster: unmittelbare Zustandswechsel; kurze Transform-/Opacity-Rückmeldung
- Reduced Motion: keine räumliche Bewegung, maximal 150 ms

## Microinteractions

- Erfolg bleibt still, wenn das Ergebnis sichtbar ist.
- Hover-Hinweise erscheinen nach 800 ms, Fokus-Hinweise sofort.
- Fokus-Ringe erscheinen ohne Animation.
- Reversible Aktionen bevorzugen Rückgängig statt Bestätigungsdialog.

## CTA-Stimme

- Primär: kompakte tintenfarbene Fläche, 8 px Radius, konkretes Verb
- Sekundär: ruhiger Text- oder Outline-Button
- Icon-Aktionen: 44 px Zielgröße, höchstens 36 px sichtbare Fläche

## Seitenspezifische Freiheiten

- App-Seiten verwenden keine dekorative Anreicherung; die Funktion trägt die Seite.
- Login darf das Markenbild als zweite Diptychon-Hälfte einsetzen.
- Inhaltsseiten bleiben typografisch und verwenden keine Kartencontainer.

## Was alle Seiten teilen müssen

- Wortmarke und Anker-Logo
- Typografie, Dichte und Button-Geometrie
- Fokus-, Fehler-, Lade- und Disabled-Zustände
- Hafenblau als Standard-Signal; Theme-Varianten ersetzen nur Farbrollen
- Ein kompakter, arbeitsnaher Header statt einer Marketing-Navigation

## Was Seiten unterscheiden darf

- Seitentypische Makrostruktur innerhalb der oben gesperrten Familien
- Dichte von Tabellen, Listen und Editoren
- Sichtbare Werkzeuggruppen gemäß Aufgabe und Bildschirmbreite

## Exports

### tokens.css

Die vollständige Quelle liegt in `tokens.css`. Kernrollen:

```css
:root {
  --color-paper: oklch(96% 0.014 78);
  --color-paper-2: oklch(93% 0.016 76);
  --color-paper-3: oklch(89% 0.018 74);
  --color-ink: oklch(22% 0.028 248);
  --color-ink-2: oklch(34% 0.032 244);
  --color-rule: oklch(78% 0.025 232);
  --color-rule-2: oklch(85% 0.019 226);
  --color-muted: oklch(48% 0.026 240);
  --color-neutral: oklch(40% 0.03 242);
  --color-accent: oklch(44% 0.12 242);
  --color-accent-ink: oklch(97% 0.012 78);
  --color-focus: oklch(56% 0.19 242);
  --font-display: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, ui-serif, serif;
  --font-body: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-outlier: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper: oklch(96% 0.014 78);
  --color-paper-2: oklch(93% 0.016 76);
  --color-ink: oklch(22% 0.028 248);
  --color-accent: oklch(44% 0.12 242);
  --font-display: "Iowan Old Style", ui-serif, serif;
  --font-body: ui-sans-serif, system-ui, sans-serif;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --text-md: 1.125rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(96% 0.014 78)", "$type": "color" },
    "ink": { "$value": "oklch(22% 0.028 248)", "$type": "color" },
    "accent": { "$value": "oklch(44% 0.12 242)", "$type": "color" },
    "focus": { "$value": "oklch(56% 0.19 242)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Iowan Old Style, Palatino Linotype, ui-serif, serif", "$type": "fontFamily" },
    "body": { "$value": "ui-sans-serif, system-ui, sans-serif", "$type": "fontFamily" }
  },
  "space": {
    "md": { "$value": "1rem", "$type": "dimension" },
    "lg": { "$value": "1.5rem", "$type": "dimension" }
  },
  "duration": {
    "micro": { "$value": "120ms", "$type": "duration" },
    "short": { "$value": "220ms", "$type": "duration" }
  }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 96% 0.014 78;
  --foreground: 22% 0.028 248;
  --card: 93% 0.016 76;
  --card-foreground: 22% 0.028 248;
  --primary: 44% 0.12 242;
  --primary-foreground: 97% 0.012 78;
  --secondary: 89% 0.018 74;
  --secondary-foreground: 34% 0.032 244;
  --muted: 78% 0.025 232;
  --muted-foreground: 48% 0.026 240;
  --border: 78% 0.025 232;
  --input: 78% 0.025 232;
  --ring: 56% 0.19 242;
  --radius: 10px;
}
```
