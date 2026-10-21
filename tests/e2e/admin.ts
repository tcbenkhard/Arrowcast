import { createHmac } from 'node:crypto';

export const testJwtSecret = 'isolated-e2e-secret-with-at-least-32-bytes';

// Feature tests use the isolated server's credentials; auth.spec.ts exercises real login.
// This keeps unrelated tests from exhausting the real login rate limiter.
export function testAdminToken(username = 'admin') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub: username,
      role: 'admin',
      iss: 'arrowcast',
      aud: 'arrowcast-admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', testJwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
