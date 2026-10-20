import { t } from '@arrowcast/contracts/i18n';
import { and, eq, getTableColumns } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { competitionLanes, competitionParticipants, lanes, participants } from '../../db/schema.js';

export const letters = ['A', 'B', 'C', 'D'] as const;
type Letter = typeof letters[number];
interface Lane { laneId: string; number: number; numberOfTargets: number; targetType: string | null }
interface Person { participantId: string; clubNumber?: string | null; targetType: string | null; laneId: string | null; targetLetter: Letter | null }
interface Spot { laneId: string; targetLetter: Letter; targetType: string | null; position: number; line: number }
export class AssignmentError extends Error {}

// First minimize the number of shooting lines, retaining every existing place.
// Within that limit, balance the lines, then mix clubs and prefer spaced places.
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
      throw new AssignmentError(t("assignments.an_existing_assignment_no_longer_matches_the_lane_configuration"));
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
  if (!allowedLines) throw new AssignmentError(t("assignments.not_enough_matching_targets_to_assign_all_participants_maximum"));
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
  mixClubs(spots, people, pending, fixed, placed, result, allowedLines);
  return result;
}

// Min-cost flow minimizes pairs of clubmates sharing a lane, including fixed
// assignments. Keep the planned line loads, preferring the spaced-out places
// whenever they permit the same amount of club mixing.
function mixClubs(spots: Spot[], people: Person[], pending: Person[], fixed: Spot[], placed: Spot[],
  result: { participantId: string; laneId: string; targetLetter: Letter }[], allowedLines: number[]) {
  if (!people.some((p) => p.clubNumber)) return;
  const key = (s: { laneId: string; targetLetter: string }) => `${s.laneId}/${s.targetLetter}`;
  const occupied = new Set(fixed.map(key));
  for (const type of new Set(pending.map((p) => p.targetType))) {
    const indexes = pending.flatMap((p, i) => p.targetType === type ? [i] : []);
    const groups = new Map<string, number[]>();
    for (const i of indexes) {
      const person = pending[i]!;
      // Missing club data must not make unrelated participants clubmates.
      const club = person.clubNumber ? `club:${person.clubNumber}` : `person:${person.participantId}`;
      groups.set(club, [...(groups.get(club) ?? []), i]);
    }
    type Edge = { to: number; reverse: number; capacity: number; cost: number };
    const graph: Edge[][] = [];
    const node = () => { graph.push([]); return graph.length - 1; };
    const edge = (from: number, to: number, capacity: number, cost = 0) => {
      const forward = { to, reverse: graph[to]!.length, capacity, cost };
      graph[from]!.push(forward);
      graph[to]!.push({ to: from, reverse: graph[from]!.length - 1, capacity: 0, cost: -cost });
      return forward;
    };
    const source = node();
    const sink = node();
    const lineNodes = new Map(allowedLines.map((line) => [line, node()]));
    for (const [line, id] of lineNodes) {
      edge(id, sink, indexes.filter((i) => placed[fixed.length + i]!.line === line).length);
    }
    const preferred = new Set(indexes.map((i) => key(result[i]!)));
    const candidates = spots.filter((s) => s.targetType === type && allowedLines.includes(s.line) && !occupied.has(key(s)));
    const laneNodes = new Map([...new Set(candidates.map((s) => s.laneId))].map((id) => [id, node()]));
    const places = candidates.map((spot) => ({ spot,
      edge: edge(laneNodes.get(spot.laneId)!, lineNodes.get(spot.line)!, 1, preferred.has(key(spot)) ? 0 : 1) }));
    const clubLanes: { indexes: number[]; laneId: string; edges: Edge[] }[] = [];
    for (const members of groups.values()) {
      const clubNode = node();
      edge(source, clubNode, members.length);
      const club = pending[members[0]!]!.clubNumber;
      for (const [laneId, laneNode] of laneNodes) {
        const existing = club ? people.filter((p) => p.laneId === laneId && p.clubNumber === club).length : 0;
        const capacity = Math.min(members.length, candidates.filter((s) => s.laneId === laneId).length);
        const edges = Array.from({ length: capacity }, (_, i) =>
          edge(clubNode, laneNode, 1, (existing + i) * (indexes.length + 1)));
        clubLanes.push({ indexes: members, laneId, edges });
      }
    }
    for (let flow = 0; flow < indexes.length; flow++) {
      // Residual reverse edges let later placements repair earlier choices.
      const distance = graph.map(() => Infinity);
      const previous: { from: number; edge: Edge }[] = [];
      distance[source] = 0;
      const queue = [source];
      const queued = new Set(queue);
      for (let head = 0; head < queue.length; head++) {
        const from = queue[head]!;
        queued.delete(from);
        for (const e of graph[from]!) {
          if (e.capacity && distance[e.to]! > distance[from]! + e.cost) {
            distance[e.to] = distance[from]! + e.cost;
            previous[e.to] = { from, edge: e };
            if (!queued.has(e.to)) { queue.push(e.to); queued.add(e.to); }
          }
        }
      }
      if (!previous[sink]) throw new AssignmentError(t("assignments.not_enough_matching_targets_to_mix_clubs"));
      for (let id = sink; id !== source;) {
        const step = previous[id]!;
        step.edge.capacity--;
        graph[id]![step.edge.reverse]!.capacity++;
        id = step.from;
      }
    }
    const available = places.filter((p) => p.edge.capacity === 0).map((p) => p.spot);
    const remaining = new Set(indexes);
    for (const allocation of clubLanes) {
      const count = allocation.edges.filter((e) => e.capacity === 0).length;
      for (let i = 0; i < count; i++) {
        const index = allocation.indexes.find((j) => remaining.has(j) && result[j]!.laneId === allocation.laneId)
          ?? allocation.indexes.find((j) => remaining.has(j))!;
        const spotIndex = available.findIndex((s) => s.laneId === allocation.laneId && s.targetLetter === result[index]!.targetLetter);
        const spot = available.splice(spotIndex >= 0 ? spotIndex : available.findIndex((s) => s.laneId === allocation.laneId), 1)[0]!;
        result[index] = { participantId: pending[index]!.participantId, laneId: spot.laneId, targetLetter: spot.targetLetter };
        remaining.delete(index);
      }
    }
  }
}

export function assignParticipants(db: Pick<AppDatabase, 'select' | 'update'>, competitionId: string, reassign = false) {
  const selection = eq(competitionParticipants.competitionId, competitionId);
  const people = db.select({ ...getTableColumns(competitionParticipants), clubNumber: participants.clubNumber })
    .from(competitionParticipants).innerJoin(participants, eq(participants.id, competitionParticipants.participantId)).where(selection).all();
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
