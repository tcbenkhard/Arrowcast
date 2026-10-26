import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ParticipantImportJob } from '../src/modules/participants/import-job.js';

test('a persistence failure leaves the import retryable and hides storage error details from polling', async () => {
  const failure = new Error('Private database details');
  const errors: unknown[] = [];
  let saves = 0;
  const job = new ParticipantImportJob({
    canImport: async () => true,
    scrape: async () => ({ season: '2026-2027', pages: 1, participants: [], clubs: [] }),
    save: () => {
      if (++saves === 1) throw failure;
    },
    onError: (error) => errors.push(error),
  });
  assert.deepEqual(await job.start(), { outcome: 'started' });
  await job.waitForCompletion();
  const failed = await job.status();
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result, null);
  assert.ok(failed.error);
  assert.ok(!failed.error.includes(failure.message));
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(await job.start(), { outcome: 'started' });
  await job.waitForCompletion();
  const completed = await job.status();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.error, null);
  assert.deepEqual(completed.result, { season: '2026-2027', participants: 0, clubs: 0 });
  assert.equal(saves, 2);
});
