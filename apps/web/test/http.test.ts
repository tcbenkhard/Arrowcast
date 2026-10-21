import assert from 'node:assert/strict';
import test from 'node:test';
import { managementRequest, scoringRequest } from '../src/lib/http.js';

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
