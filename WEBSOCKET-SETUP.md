# Installation & Funktionsweise: Echtzeit-Synchronisation

Die App wurde erfolgreich erweitert, um Listenänderungen sofort und automatisch auf alle verbundenen Browser zu übertragen. Dafür sorgt ein neuer Node.js-basierter WebSocket-Server zusammen mit Proxy-Regeln im Apache-Webserver.

## Was wurde geändert?

1. **Neuer Websocket-Server (`websocket-server/`)**: Ein schlankes Node.js-Skript (`server.js`), das eingehende Broadcast-Benachrichtigungen via HTTP entgegennimmt und an alle offenen Browser-Verbindungen per WebSocket (`ws://`) durchreicht.
2. **Backend-Trigger (`public/api.php`)**: Wann immer ein Nutzer etwas ändert (POST, PUT, DELETE von Artikeln etc.), sendet PHP asynchron (ohne den Nutzer warten zu lassen) per cURL einen kurzen `update`-Befehl an den Websocket-Server.
3. **Frontend-Abonnement (`public/js/app-init.js`)**: Beim Start der App baut das JavaScript automatisch eine durchgehende Verbindung zu `/ws/` auf. Sobald die `update`-Nachricht reinflattert, löst die App eine butterweiche Aktualisierung aus (`loadItems()` und `loadCategories()`), ohne die Seite neu laden zu müssen.

---

> [!IMPORTANT]
> **Für die Docker-Umgebung (Lokale Entwicklung / Server mit DockerCompose)**
> Um die Änderungen aktiv werden zu lassen, müssen Sie das bestehende Image neu bauen und hochfahren:
> ```bash
> docker compose build
> docker compose up -d
> ```

---

## Inbetriebnahme auf Ihrem Alpine Linux Server (ohne Docker)

Da Sie auf Ihrem Alpine-Server kein Docker nutzen, fungiert das System nach dem klassischen LAMP/LEMP-Prinzip. So schalten Sie dort die Echtzeitfunktion ein:

### 1. WebSocket Server starten
Wechseln Sie in das neue Verzeichnis und installieren Sie die Abhängigkeiten:
```bash
cd /pfad/zu/ankerkladde/websocket-server
npm install --omit=dev
```
Anschließend starten Sie den Server. Am besten nutzen Sie dafür **pm2**, damit der Prozess dauerhaft im Hintergrund aktiv bleibt (selbst nach einem Neustart):
```bash
# PM2 global installieren falls nicht vorhanden:
npm install -g pm2

# Server starten
pm2 start server.js --name ankerkladde-ws
pm2 save
pm2 startup
```
*Der Server lauscht nun standardmäßig auf Port 3000.*

### 2. Nginx / Apache Konfigurieren
Damit die Frontend-Browser den WebSocket (auf `wss://[Ihre-Domain]/ws/`) erreichen können, müssen Sie einen Reverse-Proxy auf den Node-Server einrichten. 

**Beispiel für Nginx:**
```nginx
location /ws/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
}
```

**Beispiel für Apache (mod_proxy & mod_proxy_wstunnel):**
```apache
ProxyPass /ws/ ws://127.0.0.1:3000/
ProxyPassReverse /ws/ ws://127.0.0.1:3000/
```

### 3. API-Url anpassen (optional)
Das PHP-Skript versucht standardmäßig dem Node.js-Server über `http://127.0.0.1:3000/notify` die Benachrichtigungen zuzusenden. Sollte Ihr Node.js-Server auf einem anderen Host/Port laufen, können Sie einfach die Umgebungsvariable `WS_NOTIFY_URL` im PHP-FPM oder in einer `.user.ini` im Ordner `public/` setzen:
```ini
env[WS_NOTIFY_URL] = "http://127.0.0.1:3000/notify"
```
