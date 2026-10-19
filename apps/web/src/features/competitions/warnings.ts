interface Lane {
  number: number;
  targetType: string | null;
  numberOfTargets: number;
}
interface Participant {
  bowType?: string | null;
  targetType?: string | null;
}

export function competitionWarnings(lanes: Lane[] | null | undefined, people: Participant[] | null | undefined): string[] {
  const warnings: string[] = [];
  if (people?.some((person) => !person.targetType?.trim())) warnings.push('All participants must have a selected target.');
  if (people?.some((person) => !person.bowType?.trim())) warnings.push('All participants must have a selected bow type.');
  for (const lane of lanes ?? []) {
    if (lane.numberOfTargets < 1) warnings.push(`Lane ${lane.number} must have at least 1 target.`);
    if (!lane.targetType?.trim()) warnings.push(`Lane ${lane.number} must have a selected target type.`);
  }
  if (!lanes || !people) return warnings;
  const totalTargets = lanes.reduce((total, lane) => total + Math.max(0, lane.numberOfTargets), 0);
  if (people.length > totalTargets * 2) {
    const required = Math.ceil(people.length / 2);
    warnings.push(`Not enough targets: ${people.length} participant${people.length === 1 ? '' : 's'} need at least ${required} target${required === 1 ? '' : 's'}, but ${totalTargets} configured (maximum 2 participants per target).`);
  }
  const targets = new Map<string, number>();
  for (const lane of lanes) {
    if (lane.targetType?.trim()) targets.set(lane.targetType, (targets.get(lane.targetType) ?? 0) + Math.max(0, lane.numberOfTargets));
  }
  const demand = new Map<string, number>();
  for (const person of people) {
    if (person.targetType?.trim()) demand.set(person.targetType, (demand.get(person.targetType) ?? 0) + 1);
  }
  for (const [type, count] of demand) {
    const available = targets.get(type) ?? 0;
    if (count > available * 2) warnings.push(`${type}: ${count} participant${count === 1 ? '' : 's'} need at least ${Math.ceil(count / 2)} target${Math.ceil(count / 2) === 1 ? '' : 's'}, but ${available} configured (maximum 2 participants per target).`);
  }
  return warnings;
}
