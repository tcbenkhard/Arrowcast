import assert from 'node:assert/strict';
import test from 'node:test';
import { shootingLineReduction } from '../src/features/competitions/shooting-lines.js';

const lane = (laneId: string, targetType = '40 cm', numberOfTargets = 1) => ({ laneId, targetType, numberOfTargets });
const person = (targetLetter: string, laneId = '1', targetType = '40 cm', checkedIn = true) => ({
  targetLetter,
  laneId,
  targetType,
  checkedIn,
});
const absent = person('C', '2', '40 cm', false);

test('absences allow checked-in participants on A and C to share one line', () => {
  const lanes = [lane('1'), lane('2')];
  const present = [person('A'), person('C', '2')];
  assert.equal(shootingLineReduction(lanes, present), null);
  assert.deepEqual(shootingLineReduction(lanes, [...present, absent]), { current: 2, minimum: 1 });
  assert.equal(shootingLineReduction(lanes, [person('A'), person('A', '2'), absent]), null);
});

test('a target type bottleneck prevents a reduction despite spare places on other lanes', () => {
  const people = [person('A'), person('C'), absent];
  assert.equal(shootingLineReduction([lane('1'), lane('2', '60 cm', 2)], people), null);
});

test('one-target lanes require A/C while two-target lanes support all four lines', () => {
  const lanes = [lane('1'), lane('2', '60 cm', 2)];
  const people = [person('A'), person('C'), person('B', '2', '60 cm'), person('D', '2', '60 cm'), absent];
  assert.deepEqual(shootingLineReduction(lanes, people), { current: 4, minimum: 2 });
  assert.deepEqual(
    shootingLineReduction([lane('1', '40 cm', 2)], [person('A'), person('B'), person('C'), person('D'), absent]),
    null,
  );
});

test('no recommendation is shown for empty or incomplete check-in data', () => {
  assert.equal(shootingLineReduction([lane('1')], [absent]), null);
  assert.equal(shootingLineReduction([lane('1')], [person('A'), { checkedIn: true }, absent]), null);
  assert.equal(shootingLineReduction([], [person('A'), person('C'), absent]), null);
});
