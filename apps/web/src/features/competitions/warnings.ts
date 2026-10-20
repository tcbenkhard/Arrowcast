import { t } from '../../i18n';
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
  if (people?.some((person) => !person.targetType?.trim())) warnings.push(t("warnings.all_participants_must_have_a_selected_target"));
  if (people?.some((person) => !person.bowType?.trim())) warnings.push(t("warnings.all_participants_must_have_a_selected_bow_type"));
  for (const lane of lanes ?? []) {
    if (lane.numberOfTargets < 1) warnings.push(t("warnings.lane_must_have_at_least_1_target", { p0: lane.number }));
    if (!lane.targetType?.trim()) warnings.push(t("warnings.lane_must_have_a_selected_target_type", { p0: lane.number }));
  }
  if (!lanes || !people) return warnings;
  const totalTargets = lanes.reduce((total, lane) => total + Math.max(0, lane.numberOfTargets), 0);
  if (people.length > totalTargets * 2) {
    const required = Math.ceil(people.length / 2);
    warnings.push(t('warnings.insufficientTargets', { participants: people.length, required, available: totalTargets }));
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
    if (count > available * 2) warnings.push(t('warnings.insufficientTypeTargets', { type, participants: count, required: Math.ceil(count / 2), available }));
  }
  return warnings;
}
