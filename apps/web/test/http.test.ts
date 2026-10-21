import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError, managementRequest, requireJson, scoringRequest } from '../src/lib/http.js';

test('management requests attach bearer authentication without losing caller headers', async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 204 });
  };
  try {
    await managementRequest('http://arrowcast.test/admin', 'secret', { method: 'POST', headers: { 'X-Test': 'yes' }, json: { ok: true } });
    assert.equal(request?.headers.get('Authorization'), 'Bearer secret');
    assert.equal(request?.headers.get('X-Test'), 'yes');
    assert.equal(request?.cache, 'no-store');
    assert.equal(await request?.text(), '{"ok":true}');
  } finally { globalThis.fetch = originalFetch; }
});

test('management requests notify the session owner on 401 only', async () => {
  const originalFetch = globalThis.fetch;
  let unauthorized = 0;
  globalThis.fetch = async () => new Response(null, { status: 401 });
  try {
    await managementRequest('http://arrowcast.test/admin', 'secret', { onUnauthorized: () => { unauthorized += 1; } });
    assert.equal(unauthorized, 1);
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await managementRequest('http://arrowcast.test/admin', 'secret', { onUnauthorized: () => { unauthorized += 1; } });
    assert.equal(unauthorized, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('request errors retain conflict status and decoded server message', async () => {
  await assert.rejects(requireJson(new Response(JSON.stringify({ message: 'stale version' }), {
    status: 409, headers: { 'Content-Type': 'application/json' },
  })), (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === 'stale version');
});

test('non-JSON failures produce a controlled HTTP error', async () => {
  await assert.rejects(requireJson(new Response('bad gateway', { status: 502 })),
    (error: unknown) => error instanceof HttpError && error.status === 502);
});

test('aborts propagate without being normalized', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => await new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  const controller = new AbortController();
  try {
    const pending = scoringRequest('http://arrowcast.test/scoring', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error === controller.signal.reason);
  } finally { globalThis.fetch = originalFetch; }
});

test('scoring requests use cookies and never attach management authorization', async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 204 });
  };
  try {
    await scoringRequest('http://arrowcast.test/scoring');
    assert.equal(request?.credentials, 'same-origin');
    assert.equal(request?.headers.has('Authorization'), false);
  } finally { globalThis.fetch = originalFetch; }
});
