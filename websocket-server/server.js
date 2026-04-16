const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.WS_PORT || 3000;
const BIND_HOST = process.env.WS_HOST || '0.0.0.0';

// Create HTTP server for incoming notifications (from PHP)
const server = http.createServer((req, res) => {
    // Basic CORS for development (if accessed directly)
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'POST' && req.url === '/notify') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                let data = { action: 'update' };
                if (body) {
                    data = JSON.parse(body);
                }
                
                // Broadcast to all connected websocket clients
                let count = 0;
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                        count++;
                    }
                });
                
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
    console.log(`[${new Date().toISOString()}] Client connected from ${ip} for generic updates`);
    
    // Send initial connection success message (optional)
    ws.send(JSON.stringify({ action: 'connected' }));

    ws.on('close', () => {
        console.log(`[${new Date().toISOString()}] Notification client disconnected`);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

const { setupWSConnection } = require('y-websocket/bin/utils');

// Manually handle WebSocket upgrade based on URL path
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    // Route for Yjs collaboration rooms: e.g. /yjs/note/123
    if (url.pathname.startsWith('/yjs/note/')) {
        const docName = url.pathname.split('/yjs/note/')[1];
        if (!docName) {
            socket.destroy();
            return;
        }

        // We can create an ephemeral websocket server just to pass the connection to y-websocket
        const yWss = new WebSocket.Server({ noServer: true });
        yWss.on('connection', (ws, req) => {
            console.log(`[${new Date().toISOString()}] Yjs client connected to room: ${docName}`);
            setupWSConnection(ws, req, { docName });
        });

        yWss.handleUpgrade(request, socket, head, (ws) => {
            yWss.emit('connection', ws, request);
        });
    } else {
        // All other paths (like /ws/ or root) go to generic notification server
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
});

server.listen(PORT, BIND_HOST, () => {
    console.log(`WebSocket server listening on ${BIND_HOST}:${PORT}`);
});
