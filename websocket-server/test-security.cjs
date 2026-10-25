const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const crypto = require('node:crypto');
const WebSocket = require('ws');

test('WS tickets, Origin, tenant rooms, disabled Yjs and protected notify', { timeout: 15_000 }, async (t) => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const secret = crypto.randomBytes(32).toString('hex');
  const origin = 'https://app.example';
  const child = spawn(process.execPath, [require.resolve('./server.js')], {
    env: { ...process.env, WS_HOST: '127.0.0.1', WS_PORT: String(port), ANKERKLADDE_WS_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    child.kill();
    await once(child, 'exit');
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', data => { if (data.toString().includes('WebSocket server listening')) resolve(); });
  });
  const http = `http://127.0.0.1:${port}`;
  const ws = `ws://127.0.0.1:${port}`;
  const ticket = (sub, exp = Math.floor(Date.now() / 1000) + 60) => {
    const payload = Buffer.from(JSON.stringify({ sub, exp, purpose: 'notifications', origin })).toString('base64url');
    return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
  };
  async function rejects(path, requestOrigin = origin, status = 401) {
    const socket = new WebSocket(ws + path, { origin: requestOrigin });
    const response = await new Promise((resolve, reject) => {
      socket.on('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); socket.terminate(); });
      socket.on('open', () => { socket.terminate(); reject(new Error('Unauthorized upgrade succeeded')); });
      socket.on('error', () => {});
    });
    assert.equal(response, status);
  }
  await rejects('/?uid=2');
  await rejects('/?ticket=forged');
  await rejects(`/?ticket=${ticket(1, 1)}`);
  await rejects(`/?ticket=${ticket(1)}`, 'https://attacker.example');
  await rejects('/yjs/note/2:123', origin, 404);
  assert.equal((await fetch(http + '/notify', { method: 'POST', body: '{}' })).status, 401);
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(http + '/notify', { method: 'POST', headers, body: 'x'.repeat(9000) })).status, 413);
  const clients = [1, 2].map(sub => new WebSocket(`${ws}/?uid=2&ticket=${ticket(sub)}`, { origin }));
  t.after(() => clients.forEach(client => client.terminate()));
  const messages = [[], []];
  clients.forEach((client, index) => client.on('message', data => messages[index].push(JSON.parse(data))));
  await Promise.all(clients.map(client => once(client, 'open')));
  assert.equal((await fetch(http + '/notify', { method: 'POST', headers, body: JSON.stringify({ user_id: 1, action: 'update' }) })).status, 200);
  // A subsequent round trip ensures messages already queued by notify arrive.
  await Promise.all(clients.map(client => new Promise(resolve => { client.once('pong', resolve); client.ping(); })));
  assert.equal(messages[0].filter(message => message.action === 'update').length, 1);
  assert.equal(messages[1].filter(message => message.action === 'update').length, 0);
});
