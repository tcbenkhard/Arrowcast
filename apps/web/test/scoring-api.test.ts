import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import {
  loadScoringContext,
  ScoringContextMismatchError,
  submitLaneScores,
} from '../src/features/scoring/scoring-api.js';
import { HttpError } from '../src/lib/http.js';

const lane = { competitionId: 'competition', laneId: 'lane', grantId: 'grant/one ?' };
const context: ScoringContext = {
  competition: {
    id: lane.competitionId,
    name: 'Competition',
    numberOfRounds: 2,
    arrowsPerRound: 3,
    status: 'Active',
    scoringLocked: false,
  },
  lane: { id: lane.laneId, number: 1 },
  version: 4,
  currentRoundNumber: 1,
  currentParticipantId: 'person',
  completed: false,
  participants: [{ id: 'person', name: 'Archer', targetLetter: 'A' }],
  rounds: [],
};

test('QR exchange encodes the grant and uses scoring cookies without management credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, '/api/v1/scoring/grant%2Fone%20%3F/exchange');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    const headers = new Headers(init?.headers);
    assert.equal(headers.has('Authorization'), false);
    assert.equal(headers.get('X-Arrowcast-Scoring'), '1');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { token: 'qr-secret' });
    return Response.json(context);
  });
  assert.deepEqual(await loadScoringContext(lane, 'qr-secret'), context);
});

test('context refresh does not exchange or retransmit the QR token', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, '/api/v1/scoring/grant%2Fone%20%3F/context');
    assert.equal(init?.body, undefined);
    assert.equal(init?.credentials, 'same-origin');
    return Response.json(context);
  });
  assert.deepEqual(await loadScoringContext(lane), context);
});

test('a context for another competition or lane is rejected', async (t) => {
  for (const result of [
    { ...context, competition: { ...context.competition, id: 'another-competition' } },
    { ...context, lane: { ...context.lane, id: 'another-lane' } },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(result));
    await assert.rejects(
      loadScoringContext(lane),
      (error: unknown) => error instanceof ScoringContextMismatchError && error.status === 403,
    );
  }
});

test('not-started responses retain their code for waiting and retry handling', async (t) => {
  const body = { code: 'SCORING_NOT_STARTED', message: 'Scoring has not started yet.' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status: 409 }));
  await assert.rejects(
    loadScoringContext(lane, 'qr-secret'),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.body !== undefined &&
      JSON.stringify(error.body) === JSON.stringify(body),
  );
});

test('mutation retries preserve the submission ID, expected version, and arrow values', async (t) => {
  const operation: ScoringMutation = {
    submissionId: 'same-operation',
    expectedVersion: context.version,
    participantId: 'person',
    roundNumber: 1,
    arrows: ['10', 'M', null],
    submit: false,
  };
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, '/api/v1/scoring/grant%2Fone%20%3F/scores');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('X-Arrowcast-Scoring'), '1');
    assert.deepEqual(JSON.parse(String(init?.body)), operation);
    attempts += 1;
    if (attempts === 1) throw new TypeError('Connection lost');
    return Response.json({ saved: true });
  });
  await assert.rejects(submitLaneScores(lane.grantId, operation), TypeError);
  await submitLaneScores(lane.grantId, operation);
  assert.equal(attempts, 2);
});

test('mutation conflicts retain server status and message for the synchronization owner', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Lane version changed' }, { status: 409 }));
  await assert.rejects(
    submitLaneScores(lane.grantId, {
      submissionId: 'conflicting-operation',
      expectedVersion: 3,
      participantId: 'person',
      roundNumber: 1,
      arrows: ['10', '9', '8'],
      submit: true,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 409 && error.message === 'Lane version changed',
  );
});
