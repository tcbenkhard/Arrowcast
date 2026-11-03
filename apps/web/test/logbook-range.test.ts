import assert from 'node:assert/strict';
import test from 'node:test';
import { logbookRange } from '../src/features/logbook/time-range';

test('logbook periods use local calendar boundaries and Monday weeks', () => {
  const now = new Date(2026, 10, 3, 14);
  for (const [period, start, end] of [
    ['thisWeek', new Date(2026, 10, 2), new Date(2026, 10, 9)],
    ['lastWeek', new Date(2026, 9, 26), new Date(2026, 10, 2)],
    ['thisMonth', new Date(2026, 10, 1), new Date(2026, 11, 1)],
    ['lastMonth', new Date(2026, 9, 1), new Date(2026, 10, 1)],
    ['absolute', new Date(2026, 9, 25), new Date(2026, 9, 26)],
  ] as const) {
    const query = new URLSearchParams(logbookRange(period, '2026-10-25', '2026-10-25', now));
    assert.equal(Number(query.get('from')), start.getTime());
    assert.equal(Number(query.get('to')), end.getTime());
  }
  assert.equal(logbookRange('all', '', '', now), '');
});
