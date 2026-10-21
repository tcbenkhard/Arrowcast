import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAverageScore, calculateRoundTotal, isValidRound } from '../src/index.js';

test('calculates totals while treating misses and unentered arrows as zero', () => {
  assert.equal(calculateRoundTotal(['10', '9', 'M', null, '1']), 20);
});

test('validates configured round length and score symbols', () => {
  assert.equal(isValidRound(['10', 'M', null], 3, false), true);
  assert.equal(isValidRound(['10', 'M', null], 3, true), false);
  assert.equal(isValidRound(['10', '11'], 2, false), false);
  assert.equal(isValidRound(['10'], 2, false), false);
});

test('calculates averages per entered arrow', () => {
  assert.equal(calculateAverageScore(54, 2, 3), 9);
  assert.equal(calculateAverageScore(0, 0, 3), 0);
});
