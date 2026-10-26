import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { t } from '../../i18n';
import type { Range } from '../ranges/range';

/** Configures the same lane/distance selection for creating and editing a competition. */
export function LaneAssignments({
  range,
  assignments,
  onChange,
  idPrefix,
  disabled = false,
  children,
}: {
  range: Range;
  assignments: Record<string, number>;
  onChange: Dispatch<SetStateAction<Record<string, number>>>;
  idPrefix: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <fieldset className="competition-lanes" disabled={disabled}>
      <legend>{t('CompetitionDetailsModal.lanes_and_distances')}</legend>
      <p className="muted">
        {t('CompetitionDetailsModal.choose_a_distance_to_include_a_lane_leave_unused')}
        {children}
      </p>
      <div className="distance-list" role="group" aria-label={t('CompetitionDetailsModal.set_distance_for_all_lanes')}>
        <span>{t('CompetitionDetailsModal.set_all_lanes_to')}</span>
        {range.supportedDistancesMeters.map((distance) => (
          <button
            key={distance}
            type="button"
            className="distance-link"
            aria-label={t('CompetitionDetailsModal.set_all_lanes_to_m', { p0: distance })}
            onClick={() => onChange(Object.fromEntries(range.lanes.map((lane) => [lane.id, distance])))}
          >
            {distance} {t('CompetitionDetailPage.m')}
          </button>
        ))}
      </div>
      {range.lanes.map((lane) => (
        <div className="lane-assignment" key={lane.id}>
          <label htmlFor={`${idPrefix}-${lane.id}`}>
            {t('CompetitionDetailPage.lane')} {lane.number}
          </label>
          <select
            id={`${idPrefix}-${lane.id}`}
            value={assignments[lane.id] ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              onChange((current) => {
                const next = { ...current };
                if (value) next[lane.id] = Number(value);
                else delete next[lane.id];
                return next;
              });
            }}
          >
            <option value="">{t('CompetitionDetailsModal.not_assigned')}</option>
            {range.supportedDistancesMeters.map((distance) => (
              <option key={distance} value={distance}>
                {distance} {t('CompetitionDetailPage.m')}
              </option>
            ))}
          </select>
        </div>
      ))}
    </fieldset>
  );
}
