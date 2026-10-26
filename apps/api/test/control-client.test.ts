import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { sendControlCommand } from '../src/shared/control-client.js';

async function broker(t: TestContext, listener: RequestListener) {
  const socketPath =
    process.platform === 'win32' ? `\\\\.\\pipe\\arrowcast-${randomUUID()}` : join(tmpdir(), `ac-${randomUUID()}.sock`);
  const server = createServer(listener);
  server.listen(socketPath);
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return socketPath;
}

test('control commands preserve broker status and JSON while forwarding settings', async (t) => {
  const received: { path?: string; method?: string; body: string }[] = [];
  const socketPath = await broker(t, (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({ path: request.url, method: request.method, body });
      response.writeHead(request.method === 'POST' ? 202 : 503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ accepted: request.method === 'POST' }));
    });
  });
  const options = { socketPath, timeoutMessage: 'Broker timed out.' };
  assert.deepEqual(await sendControlCommand({ ...options, path: '/status', method: 'GET' }), {
    code: 503,
    body: { accepted: false },
  });
  const settings = { ssid: 'Club Wi-Fi', password: 'with spaces & symbols' };
  assert.deepEqual(
    await sendControlCommand({ ...options, path: '/connect', method: 'POST', body: settings, jsonHeaders: true }),
    {
      code: 202,
      body: { accepted: true },
    },
  );
  assert.deepEqual(received, [
    { path: '/status', method: 'GET', body: '' },
    { path: '/connect', method: 'POST', body: JSON.stringify(settings) },
  ]);
});

test('control commands reject malformed and oversized broker responses', async (t) => {
  const socketPath = await broker(t, (request, response) => {
    response.end(request.url === '/malformed' ? '<html>Broker failed</html>' : JSON.stringify('x'.repeat(65537)));
  });
  const options = { socketPath, method: 'GET' as const, timeoutMessage: 'Broker timed out.' };
  await assert.rejects(sendControlCommand({ ...options, path: '/malformed' }), SyntaxError);
  await assert.rejects(sendControlCommand({ ...options, path: '/oversized' }), /size limit/);
});
