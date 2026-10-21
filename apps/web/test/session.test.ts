import assert from 'node:assert/strict';
import test from 'node:test';
import { readAdminToken, writeAdminToken } from '../src/features/auth/session.js';

test('admin token storage preserves the existing per-tab key', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  writeAdminToken('token', storage);
  assert.equal(readAdminToken(storage), 'token');
  writeAdminToken(null, storage);
  assert.equal(readAdminToken(storage), null);
});

test('admin token storage degrades safely when storage is unavailable', () => {
  const unavailable = {
    getItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(readAdminToken(unavailable), null);
});
