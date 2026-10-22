interface Lane {
  laneId: string;
  targetType: string | null;
  numberOfTargets: number;
}

interface Participant {
  checkedIn?: boolean;
  laneId?: string | null;
  targetLetter?: string | null;
  targetType?: string | null;
}

export function shootingLineReduction(lanes: Lane[], people: Participant[]) {
  if (!people.some((person) => !person.checkedIn)) return null;
  const present = people.filter((person) => person.checkedIn);
  if (!present.length) return null;
  const letters = ['A', 'B', 'C', 'D'];
  if (present.some((person) => !person.laneId || !letters.includes(person.targetLetter ?? '') || !person.targetType))
    return null;
  const current = new Set(present.map((person) => person.targetLetter)).size;
  const demand = new Map<string, number>();
  for (const person of present) demand.set(person.targetType!, (demand.get(person.targetType!) ?? 0) + 1);
  let minimum = current;
  // Check all combinations: one-target lanes support A/C, two-target lanes A/B/C/D.
  // Each target type must have enough places within the same combination of lines.
  for (let mask = 1; mask < 16; mask++) {
    const lines = letters.flatMap((_, index) => (mask & (1 << index) ? [index] : []));
    if (lines.length >= minimum) continue;
    const fits = [...demand].every(([type, count]) => {
      const capacity = lanes
        .filter((lane) => lane.targetType === type)
        .reduce((total, lane) => total + lines.filter((line) => line % 2 < lane.numberOfTargets).length, 0);
      return capacity >= count;
    });
    if (fits) minimum = lines.length;
  }
  return minimum < current ? { current, minimum } : null;
}
