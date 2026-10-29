import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCompetitions, type CompetitionSummary } from '../src/features/competitions/competition.js';

const competition = (id: string, overrides: Partial<CompetitionSummary> = {}): CompetitionSummary => ({
  id,
  name: id,
  status: 'Scheduled',
  date: '2026-10-26',
  startingTime: '10:00',
  endingTime: '12:00',
  range: { id: 'range', name: 'Range' },
  ...overrides,
});

test('competitions prioritize current activity before their calendar date', () => {
  const values = [
    competition('closed', { status: 'Closed', date: '2026-01-01' }),
    competition('scheduled'),
    competition('check-in', { status: 'Check-in' }),
    competition('active', { status: 'Active', date: '2026-12-01' }),
  ];
  assert.deepEqual(
    values.sort(compareCompetitions).map((value) => value.id),
    ['active', 'check-in', 'scheduled', 'closed'],
  );
});

test('competitions with the same status sort by newest date, ascending time, and finally stable identity', () => {
  const values = [
    competition('later-date', { date: '2026-10-27' }),
    competition('b'),
    competition('later-time', { startingTime: '11:00' }),
    competition('a'),
  ];
  assert.deepEqual(
    values.sort(compareCompetitions).map((value) => value.id),
    ['later-date', 'a', 'b', 'later-time'],
  );
});
