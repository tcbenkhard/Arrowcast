import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { competitionLanes, competitionParticipants, lanes } from '../../db/schema.js';

export const letters = ['A', 'B', 'C', 'D'] as const;
type Letter = typeof letters[number];
interface Lane { laneId: string; number: number; numberOfTargets: number; targetType: string | null }
interface Person { participantId: string; targetType: string | null; laneId: string | null; targetLetter: Letter | null }
interface Spot { laneId: string; targetLetter: Letter; targetType: string | null; position: number; line: number }
export class AssignmentError extends Error {}

// First minimize the number of shooting lines, retaining every existing place.
// Within that limit, balance the lines and fill the most widely separated places.
export function planAssignments(laneList: Lane[], people: Person[]) {
  const spots: Spot[] = laneList.flatMap((lane) => letters.flatMap((targetLetter, line) =>
    line % 2 < lane.numberOfTargets ? [{ laneId: lane.laneId, targetLetter, line,
      targetType: lane.targetType, position: lane.number * 2 + line % 2 }] : []));
  const occupied = new Set<string>();
  const key = (spot: { laneId: string; targetLetter: string }) => `${spot.laneId}/${spot.targetLetter}`;
  const fixed: Spot[] = [];
  for (const person of people) {
    if (!person.laneId || !person.targetLetter) continue;
    const spot = spots.find((s) => s.laneId === person.laneId && s.targetLetter === person.targetLetter);
    if (!spot || spot.targetType !== person.targetType || occupied.has(key(spot))) {
      throw new AssignmentError('An existing assignment no longer matches the lane configuration. Restore the configuration or reassign checked-in participants.');
    }
    occupied.add(key(spot)); fixed.push(spot);
  }
  const pending = people.filter((person) => !person.laneId).sort((a, b) => a.participantId.localeCompare(b.participantId));
  const demand = new Map<string | null, number>();
  for (const person of pending) demand.set(person.targetType, (demand.get(person.targetType) ?? 0) + 1);
  const lineOptions = Array.from({ length: 15 }, (_, i) => letters.flatMap((_, line) => (i + 1) & (1 << line) ? [line] : []))
    .sort((a, b) => a.length - b.length || a.join('').localeCompare(b.join('')));
  const allowedLines = lineOptions.find((option) => fixed.every((s) => option.includes(s.line))
    && [...demand].every(([type, count]) => type != null && spots.filter((s) =>
      option.includes(s.line) && s.targetType === type && !occupied.has(key(s))).length >= count));
  if (!allowedLines) throw new AssignmentError('Not enough matching targets to assign all participants (maximum two shooters per target).');
  const placed = [...fixed];
  const result: { participantId: string; laneId: string; targetLetter: Letter }[] = [];
  for (const person of pending) {
    const available = spots.filter((s) => allowedLines.includes(s.line) && s.targetType === person.targetType && !occupied.has(key(s)));
    const lineLoad = (line: number) => placed.filter((s) => s.line === line).length;
    const distance = (spot: Spot) => Math.min(...placed.filter((s) => s.line === spot.line).map((s) => Math.abs(s.position - spot.position)));
    available.sort((a, b) => lineLoad(a.line) - lineLoad(b.line)
      || (distance(b) > distance(a) ? 1 : distance(b) < distance(a) ? -1 : 0)
      || a.line - b.line || a.position - b.position);
    const spot = available[0]!;
    occupied.add(key(spot)); placed.push(spot);
    result.push({ participantId: person.participantId, laneId: spot.laneId, targetLetter: spot.targetLetter });
  }
  // For each line and target type, maximize the nearest-neighbor distance.
  // A greedy feasibility scan is exact for ordered positions with fixed places:
  // discard positions too close to fixed shooters, then take the earliest fit.
  // Repeating the groups also improves mixed target layouts.
  for (let pass = 0; pass < 4; pass++) {
    for (const line of allowedLines) {
      for (const type of demand.keys()) {
        const indexes = result.flatMap((_, i) => placed[fixed.length + i]!.line === line
          && placed[fixed.length + i]!.targetType === type ? [i] : []);
        if (!indexes.length) continue;
        const moving = new Set(indexes.map((i) => placed[fixed.length + i]!));
        const anchors = placed.filter((s) => s.line === line && !moving.has(s));
        const candidates = spots.filter((s) => s.line === line && s.targetType === type
          && (!occupied.has(key(s)) || moving.has(s))).sort((a, b) => a.position - b.position);
        const fit = (gap: number) => {
          if (anchors.some((a, i) => anchors.slice(i + 1).some((b) => Math.abs(a.position - b.position) < gap))) return [];
          const chosen: Spot[] = [];
          for (const candidate of candidates) {
            if (anchors.every((a) => Math.abs(a.position - candidate.position) >= gap)
              && (!chosen.length || candidate.position - chosen[chosen.length - 1]!.position >= gap)) chosen.push(candidate);
          }
          return chosen;
        };
        let low = 0;
        let high = Math.max(0, ...spots.map((s) => s.position)) + 1;
        while (low + 1 < high) {
          const middle = Math.floor((low + high) / 2);
          if (fit(middle).length >= indexes.length) low = middle; else high = middle;
        }
        const chosen = fit(low).slice(0, indexes.length);
        // Use the far end too when this preserves the optimal minimum gap.
        if (chosen.length > 1) {
          const last = candidates[candidates.length - 1]!;
          if (last.position - chosen[chosen.length - 2]!.position >= low
            && anchors.every((a) => Math.abs(a.position - last.position) >= low)) chosen[chosen.length - 1] = last;
        }
        for (const spot of moving) occupied.delete(key(spot));
        indexes.forEach((index, i) => {
          const spot = chosen[i]!;
          placed[fixed.length + index] = spot;
          occupied.add(key(spot));
          result[index] = { participantId: result[index]!.participantId, laneId: spot.laneId, targetLetter: spot.targetLetter };
        });
      }
    }
  }
  return result;
}

export function assignParticipants(db: Pick<AppDatabase, 'select' | 'update'>, competitionId: string, reassign = false) {
  const selection = eq(competitionParticipants.competitionId, competitionId);
  const people = db.select().from(competitionParticipants).where(selection).all();
  const laneList = db.select({ laneId: lanes.id, number: lanes.number, targetType: competitionLanes.targetType,
    numberOfTargets: competitionLanes.numberOfTargets }).from(competitionLanes)
    .innerJoin(lanes, eq(lanes.id, competitionLanes.laneId)).where(eq(competitionLanes.competitionId, competitionId)).orderBy(lanes.number).all();
  const plan = planAssignments(laneList, reassign
    ? people.filter((p) => p.checkedIn).map((p) => ({ ...p, laneId: null, targetLetter: null })) : people);
  if (reassign) db.update(competitionParticipants).set({ laneId: null, targetLetter: null }).where(selection).run();
  for (const { participantId, ...place } of plan) {
    db.update(competitionParticipants).set(place).where(and(selection, eq(competitionParticipants.participantId, participantId))).run();
  }
}
