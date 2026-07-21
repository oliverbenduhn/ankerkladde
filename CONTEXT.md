# Ankerkladde

Mobile-freundliche PHP+SQLite-Webapp für Listen, Aufgaben, Notizen, Bilder, Dateien und Links.

## Language

**Tagesansicht**:
Eine datumszentrierte Ansicht, die die kategorieübergreifende Agenda und die Tagesnotiz für dasselbe gewählte Datum zusammenführt; wählbar sind heute, gestern, morgen und freie Daten. Am tatsächlichen heutigen Datum schließt die Agenda Überfälliges ein, für jedes andere Datum ausschließlich Items mit genau diesem Datum.
_Avoid_: Heute-Sicht, Dashboard, Inbox

**Heute**:
Der aktuelle Kalendertag in `Europe/Berlin`, serverseitig bestimmt. Agenda, Überfälligkeit, Badge und Quick-Add verwenden gemeinsam dieses Datum statt der Gerätezeitzone.
_Avoid_: lokales Gerätedatum

**Fällig**:
Ein Item in einer `list_due_date`-Kategorie, dessen `due_date` auf heute oder davor liegt und das nicht erledigt ist (`done = 0`).
_Avoid_: Überfällig (siehe unten)

**Überfällig**:
Ein fälliges Item, dessen `due_date` strikt vor heute liegt.
_Avoid_: Verspätet, über die Zeit

**Terminiert**:
Ein offenes Item vom Typ `list_due_date`, dessen `due_date` dem gewählten Agenda-Datum entspricht und dessen `due_time != ''` ist. Liegt sein Datum bereits zurück, gilt es stattdessen als Überfällig; eine frühere Uhrzeit ordnet es nicht in den aktuellen Zeitplan ein.
_Avoid_: Fest terminiert, mit Uhrzeit

**Ohne Uhrzeit**:
Ein offenes Item vom Typ `list_due_date`, dessen `due_date` dem gewählten Agenda-Datum entspricht und dessen `due_time` leer ist. Überfällige Items stehen am heutigen Datum in derselben linken Spalte, behalten aber die Bezeichnung „Überfällig“.
_Avoid_: Irgendwann heute, Ganztägig

**Aufteilung der Agenda am heutigen Datum** (gilt für fällige Items):
1. Links „Ohne Uhrzeit“: Überfällig (`due_date < today`) und heutige Items ohne Uhrzeit; Überfälliges zuerst.
2. Rechts „Terminiert“: heutige Items mit Uhrzeit, nach `due_time` aufsteigend.

**`due_time`**:
Optionale Uhrzeit auf Items vom Typ `list_due_date`, additive Spalte `due_time TEXT NOT NULL DEFAULT ''` (leerer String = keine Uhrzeit). Wird nie ohne `due_date` gesetzt.

**Journal**:
Vom System automatisch angelegte, einzelne Kategorie vom Typ `daily_notes` pro Nutzer, sichtbar als eigener Tab. Nicht vom Nutzer umbenannt (YAGNI), nicht löschbar; bei Beschädigung wird sie vom System neu angelegt.
_Avoid_: Tagebuch, Logbuch

**Tagesnotiz**:
Ein datumsgebundenes Item in der Journal-Kategorie, das Text, eine Skizze oder beides enthalten kann. Pro Datum existiert höchstens ein Item; es wird beim ersten Speichern eines dieser Inhalte angelegt, nicht beim bloßen Öffnen.
_Avoid_: Journaleintrag, Tages-Eintrag

**Zeichnung**:
Ein eigenständiges Item in einer Zeichnungen-Kategorie, dessen Inhalt eine bearbeitbare Skizze ist. Das Löschen aller Skizzenelemente leert die Zeichnung, löscht aber nicht das Item.
_Avoid_: Tages-Skizze, Bild

**Zeichnungen-Kategorie**:
Eine vom Nutzer ausdrücklich angelegte Kategorie für Zeichnungen. Sie wird weder als Standardkategorie noch nachträglich für bestehende Nutzer automatisch erzeugt.

**Tages-Skizze**:
Die optionale Skizze einer Tagesnotiz. Sie ist kein eigenständiges Item; wird sie geleert, bleibt die Tagesnotiz ohne Skizze bestehen.
_Avoid_: Zeichnung, Tageszeichnung

**Priorität**:
Optionale Markierung auf Items vom Typ `list_due_date` und `list_quantity`. Werte: `!1` = hoch, `!2` = mittel, `!3` = niedrig. Kein `!` = keine Priorität. Additive Spalte `priority TEXT NOT NULL DEFAULT ''` (leerer String = keine Priorität).
_Avoid_: Wichtigkeit, Dringlichkeit

**Quick-Add**:
Eingabefeld in jeder `list_due_date`- und `list_quantity`-Kategorie sowie in der Tagesansicht, das beim Submit zuerst einen deterministischen Parser laufen lässt (Vokabular siehe ADR-0004). In der Tagesansicht sind die letzte aktive Fälligkeitskategorie und das gewählte Datum die Standardwerte; explizite relative Wörter beziehen sich immer auf Heute und überschreiben den Datumsdefault.
_Avoid_: Schnell-Add, Quick Input

**Magic Bar**:
Bestehendes AI-gestütztes Eingabefeld, das als Eskalationsziel für Quick-Add dient und parallel als eigenständiger AI-only-Modus erhalten bleibt. Spricht den aktiven KI-Provider an.

**KI-Provider**:
Auswahl des Backend-Dienstes, an den die Magic Bar ihre Anfragen sendet. Zwei Werte: `gemini` (hartcodierte Google-Gemini-API, eigene Modell-Whitelist) und `openai_compatible` (OpenAI-Chat-Completions-API mit vom Nutzer gewählter Basis-URL und freiem Modellnamen).
_Avoid_: KI-Anbieter, AI-Backend

**OpenAI-kompatibler Endpoint**:
Ein HTTP-Endpunkt, der die OpenAI-Chat-Completions-API (`POST {basis-url}/chat/completions` mit `Authorization: Bearer <key>`, Request-Body `{"model": ..., "messages": [...]}`, Response-Body `choices[0].message.content`) implementiert. Optional antwortet er auch auf `GET {basis-url}/models` mit `{"data":[{"id":"..."}]}` zur Modell-Discovery. Wird im Provider `openai_compatible` angesprochen. Beispiele: `https://api.openai.com/v1` (OpenAI direkt), `https://openrouter.ai/api/v1` (OpenRouter), `https://litellm.obxy.de/v1` (LiteLLM-Proxy), `http://localhost:11434/v1` (lokal betriebener Ollama-Server). Basis-URL muss `https://` sein oder `http://localhost` bzw. `http://127.0.0.1`; API-Key ist optional.
_Avoid_: OpenAI-Endpoint, Chat-Completions-URL

**Modell-Discovery**:
Expliziter Knopf im Settings-UI, der die beim aktiven KI-Provider verfügbaren Modelle vom Endpoint abruft und als HTML5-`<datalist>` an einem Texteingabefeld anbietet. Gemini: `GET .../v1beta/models`, gefiltert auf Modelle mit `generateContent`-Unterstützung; Modell-ID wird auf den Teil nach `models/` normalisiert. OpenAI-kompatibel: `GET {basis-url}/models`, alle Einträge mit nicht-leerem `id`. Die Liste wird im Frontend pro `(provider, basis-url, api-key-hash)` gecached und bei Eingabeänderung verworfen. Das Texteingabefeld bleibt ein Freitextfeld: der Nutzer kann jederzeit einen Modellnamen tippen, der nicht in der vom Endpoint gelieferten Liste steht; die Liste ist Komfort, keine Schranke.
_Avoid_: Auto-Discovery, Modell-Dropdown

**Deep-Link**:
Aus der Tagesansicht heraus: Tap auf den Inhalt eines Agenda-Eintrags navigiert in die Quell-Kategorie, scrollt zum Item und blendet es für 1,5 s gelb hinterlegt ein. Die Checkbox hakt den Eintrag dagegen direkt in der Tagesansicht ab.

**Einstellungsansicht**:
Die innerhalb der Haupt-App geöffnete Oberfläche für App-, Kategorie- und Kontoeinstellungen. Beim Schließen kehrt der Nutzer in exakt den zuvor sichtbaren App-Zustand zurück.
_Avoid_: Settings-Seite, Settings-iframe