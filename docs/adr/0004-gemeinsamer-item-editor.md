# Gemeinsamer Item-Editor für Mengen- und Terminlisten

**Status**: accepted

Items der Kategorietypen `list_quantity` (Mengenliste) und `list_due_date` (Terminliste) teilen sich ab sofort einen gemeinsamen Vollbild-Editor (`item-editor.js`). Felder, Validierung und Save-Call sind typabhängig; Rahmen, Topbar, Dirty-Tracking, Konfliktlösung und Speicherlogik sind einheitlich. Beim Antippen eines Eintrags öffnet sich immer dieser Editor — sowohl aus der Listenansicht als auch aus dem Aktionsmenü und aus „Mit Details hinzufügen". Inline-Edit in der Karte entfällt.

## Context

Die App hatte bisher zwei getrennte Editor-Pfade:

- **Mengenliste (`list_quantity`)**: Inline-Bearbeitung in der Karte, eigene Felder (Menge, Barcode), eigene Save-Engine über `handleEditSave` in `items-actions-update.js`. Diese Engine nutzt eine ausgewachsene Draft-/Konflikt-Architektur: `state.editDraft`, `state.editingId`, `wrapDraftForPersistence`, `draft-persistence.js`, `item-content-conflict.js`, 409-Resolution via `rebaseItemDraft`, idempotencyKey, `replaceAttachment`.
- **Terminliste (`list_due_date`)**: Vollbild-Overlay (`#todoEditor`), eigener Save-Pfad in `todo-editor.js`. Ohne Draft-Persistenz, ohne 409-Resolution außer `Object.assign` auf das aktuelle Item, ohne Konflikt-Anzeige. `closeTodoEditor` ruft `await save()` und schluckt Fehler stillschweigend.

Beide Pfade unterscheiden sich in:

- **Öffnen**: Inline in der Karte vs. Vollbild-Overlay,
- **Speichern**: ein Save pro Feld in der Karte vs. ein gemeinsamer Save im Vollbild,
- **Fehlerbehandlung**: ausführliche Konflikt-UI vs. `try { save } catch {}`,
- **Dirty-Tracking**: Server-Snapshot pro Feld (Mengenliste) vs. keins (Terminliste),
- **Listenwechsel**: nur übers Aktionsmenü (beide).

Das ist nicht eine Frage des Geschmacks, sondern eine reale Inkonsistenz, die der Nutzer sieht: zwei Editor-Mental-Modelle, zwei Speicher-Regeln, zwei Fehler-Verhalten.

## Decision

Wir bauen einen gemeinsamen Editor mit folgender Schnittstelle:

```js
openItemEditor({
    mode: 'create' | 'edit',
    itemId?,         // edit
    categoryId,      // create
    defaults?,       // create (z. B. dueDate)
})
```

Das Modul entscheidet intern anhand des Kategorietyps über Felder, Validierung, Speichern, Konflikte und Ansichts-Aktualisierung.

### Feste Eigenschaften des Editors

1. **Vollbild-Overlay**, Markup generalisiert von `#todoEditor` → `#itemEditor`. CSS-Klassen `.todo-editor*` werden zu `.item-editor*`. Inline-Edit in der Mengenlisten-Karte verschwindet.
2. **Topbar**: Abbrechen, „Eintrag bearbeiten" oder „Eintrag erstellen" als Titel, Speichern. Topbar ist gleichberechtigt — kein „X-Button speichert automatisch".
3. **Dirty-Tracking pro Feld** gegen einen Server-Snapshot, der beim Öffnen gespeichert wird. Pristine Felder (nicht angefasst) zählen nicht als dirty.
4. **Abbrechen / Schließen fragt nur wenn ≥ 1 Feld dirty ist.** Bei sauberem Stand wird ohne Rückfrage geschlossen.
5. **Speichern übernimmt alle Änderungen gemeinsam** — ein einziger `add`- oder `update`-Call, identisches Body-Schema für beide Typen.
6. **Konfliktlösung**: die Draft-/409-Logik aus `items-actions-update.js` (`handleEditSave`) wird die einzige Wahrheit. `todo-editor.js`-Fehlerbehandlung wird durch sie ersetzt.
7. **Listenwechsel ist im Editor möglich** (nur Edit-Modus, nur Kategorien desselben Typs). Der Move-Menüpunkt im Aktionsmenü bleibt — er ist derselbe Pfad, redundantes UX ist ok, die Logik ist eine.
8. **Quick Add bleibt ein schneller Submit-Pfad** ohne Editor. „Mit Details hinzufügen" öffnet denselben Editor im Create-Modus.
9. **Move / Pin / Delete bleiben im Aktionsmenü / Move-Sheet**, der Editor hält sich aus diesen Aktionen raus (außer Liste-wechseln im Edit-Modus).
10. **Erledigt-Toggle**: in der Liste eine direkte Sofort-Aktion; im Editor ein Feld, das mit dem gemeinsamen Save mitläuft.

### Felder (typabhängig)

| Feld           | `list_quantity`     | `list_due_date`     |
| -------------- | ------------------- | ------------------- |
| Titel          | ✓                   | ✓                   |
| Liste          | ✓ (Edit, gefiltert) | ✓ (Edit, gefiltert) |
| Menge          | ✓                   | —                   |
| Barcode        | ✓ (unter „Weitere") | —                   |
| Datum          | —                   | ✓                   |
| Uhrzeit        | —                   | ✓                   |
| Status         | —                   | ✓                   |
| Priorität      | ✓                   | ✓                   |
| Notiz          | ✓                   | ✓                   |
| Erledigt       | ✓                   | ✓                   |

## Considered Options

- **Nur die Topbar angleichen, Logik getrennt lassen**: minimaler Diff, aber die Inkonsistenz bleibt. Wir würden den Status-Quo zementieren.
- **DOM vereinheitlichen, Save-Pfade getrennt**: gemeinsamer Look, aber zwei Draft-Engines. Risiko bei zukünftigen Bugfixes (jede Engine hat eigene Edge-Cases).
- **Vollständige Vereinigung der Save-Pfade**: ein Editor, eine Engine. Bedeutet ~150 Zeilen Draft-/Konflikt-Code wandern aus `items-view.js` / `items-actions-update.js` in den Editor. Preis: größerer Refactor. Wert: kein Drift mehr.
- **Nur Look angleichen (a + nichts):** YAGNI-Extrem, aber verwirft die Lösung für ein reales Problem.

Gewählt: **Vollständige Vereinigung.** Die existierende Mengenlisten-Draft-Engine ist die solidere der beiden; sie zu duplizieren wäre der gefährlichere Refactor, sie zu übernehmen der ehrlichere.

## Consequences

- `public/js/item-editor.js` ersetzt `public/js/todo-editor.js`. Exports: `createItemEditorController(...)` mit `openItemCreate`, `openItemEdit`, `closeItemEditor`.
- `state.editingId` und `state.editDraft` (aus `items-view.js`/`items-actions-update.js`) werden vom Editor konsumiert. Inline-Reste der Mengenliste (`handleEditStart`, `createEditDraft`, `wrapEditDraft`, `restorePersistedDraft`) wandern entweder in den Editor oder werden von ihm abgelöst.
- `#itemEditor`-Markup ersetzt `#todoEditor`-Markup in `index.php`. CSS-Klassen werden konsequent umbenannt.
- `openNoteEditorWithNavigation`, `openSketchEditor`, `openJournalWithNavigation` sind nicht betroffen — Notizen, Zeichnungen, Tagesnotizen verwenden weiterhin ihre eigenen Oberflächen.
- Vier bestehende UI-Tests (`tests/ui/todo-time.spec.js`, `tests/ui/flows/02-today-agenda.spec.js`, `08-status-sync.spec.js`, `15-inline-content-conflicts.spec.js`, `tests/ui/search.spec.js`) müssen ihre Selektoren anpassen (`.todo-editor*` → `.item-editor*`, IDs `todoEditor…` → `itemEditor…`) und ihren Pfad durch den Vollbild-Editor nehmen statt durch Inline-Edit.
- `CONTEXT.md` erhält drei neue Glossar-Einträge: **Mengenliste**, **Terminliste**, **Item-Editor**.
- Quick-Add-Textparser bleibt unverändert; nur der Pfad „Mit Details hinzufügen" zeigt jetzt in den gemeinsamen Editor.
- Smoke-Test (`bash scripts/smoke-test.sh`) deckt nur die API-Schicht ab — Editor-Refactor ist überwiegend UI und wird über die UI-Specs geprüft.
