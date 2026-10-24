const net = require('node:net');
const { spawn } = require('node:child_process');

async function main() {
  const env = { ...process.env };
  if (!env.PLAYWRIGHT_PORT && !env.PLAYWRIGHT_BASE_URL) {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    env.PLAYWRIGHT_PORT = String(server.address().port);
    await new Promise((resolve) => server.close(resolve));
  }
  // The PHP server checks the selected port again before touching test data.
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
    env, stdio: 'inherit',
  });
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
