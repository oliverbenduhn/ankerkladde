const WebSocket = require('ws');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.WS_PORT || 3000;
const BIND_HOST = process.env.WS_HOST || '0.0.0.0';
const WS_SECRET = (process.env.ANKERKLADDE_WS_SECRET || '').trim();
const MAX_NOTIFY_BODY_BYTES = 8 * 1024;

function timingSafeTextEqual(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyTicket(ticket, origin) {
    if (!WS_SECRET || typeof ticket !== 'string') return null;
    const [payloadPart, signaturePart, extra] = ticket.split('.');
    if (!payloadPart || !signaturePart || extra !== undefined) return null;
    const expected = crypto.createHmac('sha256', WS_SECRET).update(payloadPart).digest('base64url');
    if (!timingSafeTextEqual(signaturePart, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
        if (payload.purpose !== 'notifications' || !Number.isInteger(payload.sub) || payload.sub < 1) return null;
        if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
        if (typeof payload.origin !== 'string' || payload.origin !== origin) return null;
        return payload;
    } catch {
        return null;
    }
}

function isAuthorizedNotifyRequest(req) {
    const header = req.headers.authorization || '';
    return WS_SECRET !== '' && timingSafeTextEqual(header, `Bearer ${WS_SECRET}`);
}

// Map of userId -> Set of WebSocket connections for that user
const userRooms = new Map();

// Version monitoring
let currentVersion = null;
const VERSION_FILE = path.join(__dirname, '../public/version.php');

// Read version from PHP file
function readVersion() {
    try {
        const content = fs.readFileSync(VERSION_FILE, 'utf-8');
        const match = content.match(/return\s+'([^']+)'/);
        return match ? match[1] : null;
    } catch (e) {
        console.error(`Failed to read version file: ${e.message}`);
        return null;
    }
}

// Initialize version on startup
currentVersion = readVersion();
console.log(`[Startup] Current version: ${currentVersion}`);

// Function to broadcast version update to all clients
function broadcastVersionUpdate(version) {
    const message = JSON.stringify({ action: 'version_update', version });
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            count++;
        }
    });
    console.log(`[${new Date().toISOString()}] Broadcasted version update (${version}) to ${count} clients.`);
}

// Monitor version changes every 5 seconds
setInterval(() => {
    const newVersion = readVersion();
    if (newVersion && newVersion !== currentVersion) {
        console.log(`[${new Date().toISOString()}] Version changed: ${currentVersion} -> ${newVersion}`);
        currentVersion = newVersion;
        broadcastVersionUpdate(newVersion);
    }
}, 5000);

// Create HTTP server for incoming notifications (from PHP)
const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/notify') {
        if (!isAuthorizedNotifyRequest(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        let body = '';
        let tooLarge = false;
        req.setTimeout(5000, () => req.destroy());
        req.on('data', chunk => {
            if (tooLarge) return;
            body += chunk.toString();
            if (Buffer.byteLength(body) > MAX_NOTIFY_BODY_BYTES) {
                tooLarge = true;
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload too large' }));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (tooLarge) return;
            try {
                let data = { action: 'update' };
                if (body) {
                    data = JSON.parse(body);
                }

                // If user_id is specified, broadcast only to that user's clients
                // Otherwise broadcast to all generic notification clients (backward compatibility)
                let count = 0;
                if (data.user_id) {
                    const userClients = userRooms.get(String(data.user_id));
                    if (userClients) {
                        userClients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify(data));
                                count++;
                            }
                        });
                    }
                } else {
                    // Fallback: broadcast to all connected websocket clients
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(data));
                            count++;
                        }
                    });
                }

                console.log(`[${new Date().toISOString()}] Broadcasted update to ${count} clients.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, clients: count }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Create WebSocket server for generic notifications (noServer: true to handle upgrade manually)
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;

    // Authenticate the short-lived ticket issued by PHP.
    let userId = null;
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const payload = verifyTicket(url.searchParams.get('ticket'), req.headers.origin);
        userId = payload ? String(payload.sub) : null;
    } catch (e) {
        console.warn(`[${new Date().toISOString()}] Failed to parse URL: ${e.message}`);
    }

    if (userId) {
        // Register in user-specific room
        if (!userRooms.has(userId)) {
            userRooms.set(userId, new Set());
        }
        userRooms.get(userId).add(ws);
        console.log(`[${new Date().toISOString()}] Client connected from ${ip} for user ${userId}`);
    } else {
        ws.close(1008, 'Unauthorized');
        return;
    }

    // Send initial connection success message (optional)
    ws.send(JSON.stringify({ action: 'connected' }));

    ws.on('close', () => {
        if (userId && userRooms.has(userId)) {
            userRooms.get(userId).delete(ws);
            // Clean up empty user rooms
            if (userRooms.get(userId).size === 0) {
                userRooms.delete(userId);
            }
            console.log(`[${new Date().toISOString()}] Client disconnected (user ${userId})`);
        } else {
            console.log(`[${new Date().toISOString()}] Notification client disconnected`);
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

// Manually handle WebSocket upgrade based on URL path
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Yjs is not used by the current frontend. Keep this attack surface closed
    // until room ownership can be verified against the application database.
    if (url.pathname.startsWith('/yjs/note/')) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
    } else if (url.pathname === '/' || url.pathname === '/ws' || url.pathname === '/ws/') {
        if (!verifyTicket(url.searchParams.get('ticket'), request.headers.origin)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, BIND_HOST, () => {
    if (!WS_SECRET) {
        console.error('ANKERKLADDE_WS_SECRET is required; all clients will be rejected.');
    }
    console.log(`WebSocket server listening on ${BIND_HOST}:${PORT}`);
});
