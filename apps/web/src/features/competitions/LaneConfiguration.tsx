import { message, t } from '../../i18n';
import { targetCounts, type BulkLaneUpdate, type Lane, type LaneChanges } from './lane-configuration';
import { useLaneConfiguration } from './useLaneConfiguration';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}

export function LaneConfiguration({
  lane,
  targetTypes,
  bulkUpdate,
  selected,
  onSelect,
  competitionId,
  token,
  onUnauthorized,
  onChange,
  readOnly,
}: AuthProps & {
  readOnly: boolean;
  onChange: (laneId: string, changes: LaneChanges) => void;
  lane: Lane;
  targetTypes: string[];
  bulkUpdate: BulkLaneUpdate | null;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  competitionId: string;
}) {
  const { draft, pending, error, change, retry } = useLaneConfiguration({
    lane,
    bulkUpdate,
    competitionId,
    token,
    onUnauthorized,
    onChange,
  });
  return (
    <tr
      aria-label={t('CompetitionDetailPage.lane_configuration_95', { p0: lane.number })}
      aria-busy={pending}
      className={!readOnly && selected ? 'lane-selected' : undefined}
    >
      {!readOnly && (
        <td>
          <input
            className="lane-select-checkbox"
            type="checkbox"
            aria-label={t('CompetitionDetailPage.select_lane', { p0: lane.number })}
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
        </td>
      )}
      <th scope="row">
        {t('CompetitionDetailPage.lane')} {lane.number}
      </th>
      <td className="lane-distance">
        {lane.distanceMeters} {t('CompetitionDetailPage.m')}
      </td>
      <td>
        {readOnly ? (
          draft.targetType || t('CompetitionDetailPage.not_configured')
        ) : (
          <select
            aria-label={t('CompetitionDetailPage.target_type')}
            id={`target-type-${lane.laneId}`}
            value={draft.targetType}
            onChange={(event) => change({ targetType: event.target.value })}
          >
            <option value="">{t('CompetitionDetailPage.not_configured')}</option>
            {draft.targetType && !targetTypes.includes(draft.targetType) && (
              <option value={draft.targetType}>{draft.targetType}</option>
            )}
            {targetTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        {readOnly ? (
          draft.numberOfTargets
        ) : (
          <select
            aria-label={t('CompetitionDetailPage.number_of_targets')}
            id={`target-count-${lane.laneId}`}
            value={draft.numberOfTargets}
            aria-describedby={error ? `lane-error-${lane.laneId}` : undefined}
            onChange={(event) => change({ numberOfTargets: Number(event.target.value) })}
          >
            {!targetCounts.includes(draft.numberOfTargets) && (
              <option value={draft.numberOfTargets} disabled>
                {draft.numberOfTargets} {t('CompetitionDetailPage.choose_12')}
              </option>
            )}
            {targetCounts.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        )}
        {error && (
          <div className="lane-save-error">
            <p id={`lane-error-${lane.laneId}`} className="error" role="alert">
              {message(error)}
            </p>
            <button type="button" className="secondary retry-button" disabled={readOnly} onClick={retry}>
              {t('CompetitionDetailPage.try_again')}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
