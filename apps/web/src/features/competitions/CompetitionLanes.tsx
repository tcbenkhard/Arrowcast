import { useCallback, useEffect, useRef, useState } from 'react';
import { message, t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { LaneConfiguration } from './LaneConfiguration';
import { targetCounts, type BulkLaneUpdate, type Lane, type LaneChanges } from './lane-configuration';
import type { CompetitionStatus } from './status';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function CompetitionLanes({
  competitionId,
  token,
  onUnauthorized,
  onChange,
  status,
}: AuthProps & { competitionId: string; onChange: (lanes: Lane[] | null) => void; status: CompetitionStatus }) {
  const readOnly = status !== 'Scheduled';
  const [expanded, setExpanded] = useState(status === 'Scheduled' || status === 'Closed');
  useEffect(() => {
    setExpanded(status === 'Scheduled' || status === 'Closed');
  }, [status]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selectedLanes, setSelectedLanes] = useState<Set<string>>(() => new Set());
  const [bulkUpdate, setBulkUpdate] = useState<BulkLaneUpdate | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const options = {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store' as const,
          signal: controller.signal,
        };
        const [response, typesResponse] = await Promise.all([
          managementRequest(`/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/lanes`, token, options),
          managementRequest('/api/v1/admin/target-types', token, options),
        ]);
        if (controller.signal.aborted) return;
        if (response.status === 401 || typesResponse.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (!response.ok || !typesResponse.ok) throw new Error(t('CompetitionDetailPage.loading_failed'));
        const [result, types] = await Promise.all([
          response.json() as Promise<Lane[]>,
          typesResponse.json() as Promise<string[]>,
        ]);
        if (!controller.signal.aborted) {
          setLanes(result);
          setTargetTypes(types.sort((a, b) => a.localeCompare(b, 'nl', { numeric: true })));
        }
      } catch {
        if (!controller.signal.aborted)
          setError(t('CompetitionDetailPage.could_not_load_lane_configuration_please_try_again'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [competitionId, token, onUnauthorized, retry]);
  useEffect(() => {
    onChange(loading || error ? null : lanes);
  }, [lanes, loading, error, onChange]);
  const changeLane = useCallback((laneId: string, changes: LaneChanges) => {
    setLanes((current) => current.map((lane) => (lane.laneId === laneId ? { ...lane, ...changes } : lane)));
  }, []);
  const allSelected = lanes.length > 0 && selectedLanes.size === lanes.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedLanes.size > 0 && !allSelected;
  }, [selectedLanes, allSelected, loading, error, readOnly]);

  function selectLane(laneId: string, selected: boolean) {
    setSelectedLanes((current) => {
      const next = new Set(current);
      if (selected) next.add(laneId);
      else next.delete(laneId);
      return next;
    });
  }
  function changeSelected(changes: LaneChanges) {
    setBulkUpdate({ laneIds: new Set(selectedLanes), changes });
  }

  return (
    <section className="panel collapsible-panel" aria-labelledby="competition-lanes-title">
      <div className="section-header collapsible-panel-header">
        <h3 id="competition-lanes-title">{t('CompetitionDetailPage.lanes')}</h3>
        <button
          type="button"
          className="panel-toggle"
          aria-label={t('lanes.toggle', {
            action: expanded ? t('CompetitionDetailPage.collapse') : t('CompetitionDetailPage.expand'),
          })}
          aria-expanded={expanded}
          aria-controls="competition-lanes-content"
          onClick={() => setExpanded((value) => !value)}
        >
          <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>
      <div id="competition-lanes-content" className="collapsible-panel-content" hidden={!expanded}>
        {loading ? (
          <p role="status">{t('CompetitionDetailPage.loading_lane_configuration')}</p>
        ) : error ? (
          <>
            <p className="error" role="alert">
              {message(error)}
            </p>
            <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>
              {t('CompetitionDetailPage.try_again')}
            </button>
          </>
        ) : lanes.length === 0 ? (
          <p>{t('CompetitionDetailPage.no_lanes_assigned')}</p>
        ) : (
          <>
            <div className="table-scroll">
              <div className={readOnly ? undefined : 'lane-configuration-layout'}>
                {!readOnly && selectedLanes.size > 0 && (
                  <div
                    className="lane-bulk-controls"
                    role="group"
                    aria-label={t('CompetitionDetailPage.edit_selected_lanes')}
                  >
                    <p>{t('CompetitionDetailPage.apply_to_selection')}</p>
                    <select
                      aria-label={t('CompetitionDetailPage.target_type_for_selected_lanes')}
                      value=""
                      onChange={(event) =>
                        changeSelected({ targetType: (JSON.parse(event.target.value) as string | null) ?? '' })
                      }
                    >
                      <option value="" disabled>
                        {t('CompetitionDetailPage.target_type')}
                      </option>
                      <option value="null">{t('CompetitionDetailPage.not_configured')}</option>
                      {targetTypes.map((type) => (
                        <option key={type} value={JSON.stringify(type)}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('CompetitionDetailPage.number_of_targets_for_selected_lanes')}
                      value=""
                      onChange={(event) => changeSelected({ numberOfTargets: Number(event.target.value) })}
                    >
                      <option value="" disabled>
                        {t('CompetitionDetailPage.number_of_targets')}
                      </option>
                      {targetCounts.map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <table className="lane-configuration-table" aria-label={t('CompetitionDetailPage.lane_configuration')}>
                  <thead>
                    <tr>
                      {!readOnly && (
                        <th scope="col">
                          <label className="lane-selection">
                            <input
                              ref={selectAll}
                              type="checkbox"
                              aria-label={t('selection.allLanes')}
                              checked={allSelected}
                              onChange={(event) =>
                                setSelectedLanes(
                                  event.target.checked ? new Set(lanes.map((lane) => lane.laneId)) : new Set(),
                                )
                              }
                            />
                          </label>
                        </th>
                      )}
                      <th scope="col">{t('CompetitionDetailPage.lane')}</th>
                      <th scope="col">{t('CompetitionDetailPage.distance')}</th>
                      <th scope="col">{t('CompetitionDetailPage.target_type')}</th>
                      <th scope="col">{t('CompetitionDetailPage.number_of_targets')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lanes.map((lane) => (
                      <LaneConfiguration
                        readOnly={readOnly}
                        onChange={changeLane}
                        key={lane.laneId}
                        lane={lane}
                        targetTypes={targetTypes}
                        bulkUpdate={bulkUpdate}
                        selected={selectedLanes.has(lane.laneId)}
                        onSelect={(selected) => selectLane(lane.laneId, selected)}
                        competitionId={competitionId}
                        token={token}
                        onUnauthorized={onUnauthorized}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
