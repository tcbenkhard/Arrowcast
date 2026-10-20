import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loginAdmin } from './helpers.js';
import { t, translateMessage } from '@arrowcast/contracts/i18n';

test('language preferences are validated, saved per user, and do not revoke sessions', async (context) => {
  const app = buildApp({ jwtSecret: 'language-test-secret-with-at-least-32-bytes', databasePath: ':memory:' });
  context.after(() => app.close());
  const login = await loginAdmin(app);
  const headers = { authorization: `Bearer ${login.json().token}` };
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/me/language', payload: { language: 'en' } })).statusCode, 401);
  for (const payload of [{}, { language: 'de' }, { language: null }, { language: 'en', username: 'other' }]) {
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/me/language', headers, payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers })).json().language, 'nl');
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/me/language', headers, payload: { language: 'en' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers })).json().language, 'en');

  const created = await app.inject({ method: 'POST', url: '/api/v1/admin/users', headers,
    payload: { username: 'manager', name: 'Manager', password: 'initial-password', role: 'competition_manager', language: 'nl' } });
  assert.equal(created.statusCode, 201);
  const managerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'manager', password: 'initial-password' } });
  const onboarded = await app.inject({ method: 'POST', url: '/api/v1/admin/password',
    headers: { authorization: `Bearer ${managerLogin.json().token}` }, payload: { currentPassword: 'initial-password', newPassword: 'manager-password' } });
  const managerHeaders = { authorization: `Bearer ${onboarded.json().token}` };
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/admin/me/language', headers: managerHeaders, payload: { language: 'en' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers: managerHeaders })).json().language, 'en');
  const edited = await app.inject({ method: 'PUT', url: '/api/v1/admin/users/manager', headers,
    payload: { username: 'manager', name: 'Manager', role: 'competition_manager', language: 'nl' } });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().sessionRevoked, false);
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers: managerHeaders })).json().language, 'nl');
  assert.equal((await app.inject({ url: '/api/v1/admin/me', headers })).json().language, 'en');
});

test('both catalogues have complete translations and matching interpolation parameters', () => {
  const en = JSON.parse(readFileSync(new URL('../../../packages/contracts/src/locales/en.json', import.meta.url), 'utf8'));
  const nl = JSON.parse(readFileSync(new URL('../../../packages/contracts/src/locales/nl.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(nl).sort());
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim() && nl[key].trim(), key);
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(params(en[key]), params(nl[key]), key);
  }
  assert.equal(t('scoring.roundProgress', { round: 2, rounds: 10, arrows: 3 }, 'nl'), 'Ronde 2 van 10 · 3 pijlen');
  assert.equal(translateMessage('User "Ada" saved.', 'nl'), 'Gebruiker "Ada" opgeslagen.');
  assert.equal(translateMessage('Regel 4: onbekend boogtype "Example".', 'en'), 'Row 4: unknown bow type "Example".');
});
