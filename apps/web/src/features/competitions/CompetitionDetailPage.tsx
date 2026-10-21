import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { competitionStatuses } from './status';
import type { CompetitionStatus } from './status';
import { CompetitionStatusBadge } from './CompetitionStatusBadge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CompetitionDetailsModal } from './CompetitionDetailsModal';
import type { Participant } from '../participants/CompetitionParticipants';
import { competitionWarnings } from './warnings';
import { CompetitionParticipants } from '../participants/CompetitionParticipants';
import type { LaneQrCode } from '@arrowcast/contracts';
import { LaneScoringCodes } from '../scoring/LaneScoringCodes';
import { ScoringSettings } from '../scoring/ScoringSettings';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
export interface Competition {
  id: string;
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  status: CompetitionStatus;
  numberOfRounds: number;
  arrowsPerRound: number;
  scoringLocked: boolean;
  defaultTargetType: string | null;
  range: { id: string; name: string };
}
interface Lane {
  laneId: string;
  number: number;
  distanceMeters: number;
  targetType: string | null;
  numberOfTargets: number;
}
interface LaneChanges {
  targetType?: string;
  numberOfTargets?: number;
}
interface BulkLaneUpdate {
  laneIds: Set<string>;
  changes: LaneChanges;
}
const targetCounts = [1, 2];
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';
const transitionLabels = {
  'Check-in': 'CompetitionDetailPage.start_checkin',
  Active: 'CompetitionDetailPage.start_competition',
  Closed: 'CompetitionDetailPage.end_competition',
} as const;

export function CompetitionDetailPage({ token, onUnauthorized }: AuthProps) {
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const [detailsAction, setDetailsAction] = useState<'edit' | 'remove' | null>(null);
  const [detailsNotice, setDetailsNotice] = useState('');
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const editButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const restoreDetailsFocus = useRef<'edit' | 'remove' | null>(null);
  function closeDetailsModal() {
    restoreDetailsFocus.current = detailsAction;
    setDetailsAction(null);
  }
  useEffect(() => {
    if (!detailsAction && restoreDetailsFocus.current) {
      (restoreDetailsFocus.current === 'edit' ? editButton : removeButton).current?.focus();
      restoreDetailsFocus.current = null;
    }
  }, [detailsAction]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [laneSnapshot, setLaneSnapshot] = useState<{ id: string | undefined; data: Lane[] | null }>();
  const [participantSnapshot, setParticipantSnapshot] = useState<{
    id: string | undefined;
    data: Participant[] | null;
  }>();
  const onLanesChange = useCallback(
    (data: Lane[] | null) => setLaneSnapshot({ id: competitionId, data }),
    [competitionId],
  );
  const onParticipantsChange = useCallback(
    (data: Participant[] | null) => setParticipantSnapshot({ id: competitionId, data }),
    [competitionId],
  );
  const warnings = competitionWarnings(
    laneSnapshot?.id === competitionId ? laneSnapshot?.data : null,
    participantSnapshot?.id === competitionId ? participantSnapshot?.data : null,
  );
  const validationReady =
    laneSnapshot?.id === competitionId &&
    laneSnapshot?.data != null &&
    participantSnapshot?.id === competitionId &&
    participantSnapshot?.data != null;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [changingStatus, setChangingStatus] = useState(false);
  const statusInProgress = useRef(false);
  const [statusError, setStatusError] = useState('');
  const [qrCodes, setQrCodes] = useState<LaneQrCode[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setCompetition(null);
    setDetailsAction(null);
    setDetailsNotice('');
    setQrCodes([]);
    setError('');
    void (async () => {
      try {
        const response = await managementRequest(
          `/api/v1/admin/competitions/${encodeURIComponent(competitionId!)}`,
          token,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (response.status === 404) {
          setError(t('CompetitionDetailPage.competition_not_found'));
          return;
        }
        if (!response.ok) throw new Error(t('CompetitionDetailPage.loading_failed'));
        const result = (await response.json()) as Competition;
        if (!controller.signal.aborted) setCompetition(result);
      } catch {
        if (!controller.signal.aborted)
          setError(t('CompetitionDetailPage.could_not_load_competition_details_please_try_again'));
      }
    })();
    return () => controller.abort();
  }, [competitionId, token, onUnauthorized, retry]);

  const nextStatus = competition ? competitionStatuses[competitionStatuses.indexOf(competition.status) + 1] : undefined;
  async function changeStatus(status: CompetitionStatus) {
    if (!competition || statusInProgress.current) return;
    const currentIndex = competitionStatuses.indexOf(competition.status);
    const targetIndex = competitionStatuses.indexOf(status);
    if (targetIndex === currentIndex || targetIndex > currentIndex + 1) return;
    if (targetIndex > currentIndex) {
      if (!validationReady) return;
      if (warnings.length > 0) {
        window.alert(t('CompetitionDetailPage.all_warnings_must_be_resolved_before_transitioning_to_the'));
        return;
      }
      if (status === 'Active') {
        const hasUncheckedParticipants = participantSnapshot?.data?.some((participant) => !participant.checkedIn);
        const message =
          t('CompetitionDetailPage.starting_the_competition_will_lock_the_competition_participants') +
          (hasUncheckedParticipants ? t('CompetitionDetailPage.warning_not_all_participants_are_checked_in') : '') +
          t('CompetitionDetailPage.start_competition_54');
        if (!window.confirm(message)) return;
      }
      if (status === 'Closed') {
        const message =
          t('CompetitionDetailPage.closing_the_competition_will_lock_all_scores_disable_all') +
          t('CompetitionDetailPage.end_competition_56');
        if (!window.confirm(message)) return;
      }
    }
    statusInProgress.current = true;
    setChangingStatus(true);
    setStatusError('');
    try {
      const response = await managementRequest(
        `/api/v1/admin/competitions/${encodeURIComponent(competition.id)}/status`,
        token,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? t('CompetitionDetailPage.could_not_update_status_please_try_again'));
      }
      const result = (await response.json()) as Competition & { qrCodes?: LaneQrCode[] };
      setCompetition(result);
      if (result.qrCodes) setQrCodes(result.qrCodes);
      if (status !== 'Check-in' && status !== 'Active') setQrCodes([]);
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : t('CompetitionDetailPage.could_not_update_status_please_try_again'),
      );
    } finally {
      statusInProgress.current = false;
      setChangingStatus(false);
    }
  }

  return (
    <>
      {error ? (
        <section className="panel">
          <p className="error" role="alert">
            {message(error)}
          </p>
          <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </section>
      ) : !competition ? (
        <p role="status">{t('CompetitionDetailPage.loading_competition_details')}</p>
      ) : (
        <>
          <section
            className="competition-flow-strip"
            aria-label={t('CompetitionDetailPage.competition_flow')}
            aria-busy={changingStatus}
          >
            <div className="competition-flow-scroll">
              <ol className="competition-flow" aria-label={t('CompetitionDetailPage.competition_flow')}>
                {competitionStatuses.map((status, index) => {
                  const current = status === competition.status;
                  const completed = index < competitionStatuses.indexOf(competition.status);
                  return (
                    <li
                      key={status}
                      aria-current={current ? 'step' : undefined}
                      className={completed ? 'completed' : undefined}
                    >
                      {completed ? (
                        <button
                          type="button"
                          className="competition-flow-back"
                          aria-label={t('CompetitionDetailPage.move_back_to', { p0: t(`status.${status}`) })}
                          disabled={changingStatus}
                          onClick={() => {
                            void changeStatus(status);
                          }}
                        >
                          <span className="competition-flow-number" aria-hidden="true">
                            {'\u2713'}
                          </span>
                          <span className="competition-flow-label">{t(`status.${status}`)}</span>
                        </button>
                      ) : (
                        <>
                          <span className="competition-flow-number" aria-hidden="true">
                            {index + 1}
                          </span>
                          <span className="competition-flow-label">{t(`status.${status}`)}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
          <div aria-live="polite">
            {warnings.length > 0 && (
              <section className="competition-warnings" aria-labelledby="competition-warnings-title">
                <h3 id="competition-warnings-title">{t('CompetitionDetailPage.competition_warnings')}</h3>
                <ul>
                  {warnings.map((warning) => (
                    <li key={message(warning)}>{message(warning)}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <section className="panel" aria-labelledby="competition-details-title" aria-busy={changingStatus}>
            <div className="section-header competition-details-header">
              <h3 id="competition-details-title">{t('CompetitionDetailPage.details')}</h3>
              {(competition.status === 'Scheduled' || competition.status === 'Closed') && (
                <div className="competition-details-toolbar">
                  {competition.status === 'Scheduled' && (
                    <button
                      ref={editButton}
                      type="button"
                      className="secondary"
                      disabled={changingStatus}
                      onClick={() => {
                        setDetailsNotice('');
                        setDetailsAction('edit');
                      }}
                    >
                      {t('CompetitionDetailPage.edit')}
                    </button>
                  )}
                  <button
                    ref={removeButton}
                    type="button"
                    className="danger"
                    disabled={changingStatus}
                    onClick={() => {
                      setDetailsNotice('');
                      setDetailsAction('remove');
                    }}
                  >
                    {t('CompetitionDetailPage.remove')}
                  </button>
                </div>
              )}
            </div>
            {detailsNotice && (
              <p className="success" role="status">
                {message(detailsNotice)}
              </p>
            )}
            <dl className="competition-details">
              <div>
                <dt>{t('CompetitionDetailPage.name')}</dt>
                <dd>{competition.name}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.date')}</dt>
                <dd>
                  <time dateTime={competition.date}>{competition.date}</time>
                </dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.starting_time')}</dt>
                <dd>{competition.startingTime}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.ending_time')}</dt>
                <dd>{competition.endingTime}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.default_target')}</dt>
                <dd>{competition.defaultTargetType ?? t('CompetitionDetailPage.none')}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.range')}</dt>
                <dd>{competition.range.name}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.status')}</dt>
                <dd>
                  <CompetitionStatusBadge status={competition.status} />
                </dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.rounds')}</dt>
                <dd>{competition.numberOfRounds}</dd>
              </div>
              <div>
                <dt>{t('CompetitionDetailPage.arrows_per_round')}</dt>
                <dd>{competition.arrowsPerRound}</dd>
              </div>
            </dl>
            {statusError && (
              <p className="error" role="alert">
                {message(statusError)}
              </p>
            )}
            {nextStatus && nextStatus !== 'Scheduled' && (
              <div className="competition-details-actions">
                <button
                  type="button"
                  disabled={changingStatus || !validationReady}
                  onClick={() => {
                    void changeStatus(nextStatus);
                  }}
                >
                  {t(transitionLabels[nextStatus])}
                </button>
              </div>
            )}
          </section>
          {detailsAction && (
            <CompetitionDetailsModal
              key={`${competition.id}-${detailsAction}`}
              mode={detailsAction}
              competition={competition}
              token={token}
              onUnauthorized={onUnauthorized}
              onClose={closeDetailsModal}
              onSaved={(updated) => {
                setLaneSnapshot(undefined);
                setParticipantSnapshot(undefined);
                setConfigurationRevision((value) => value + 1);
                setCompetition(updated);
                closeDetailsModal();
                setDetailsNotice(t('CompetitionDetailPage.competition_details_saved'));
              }}
              onRemoved={() => {
                void navigate('/admin/competitions');
              }}
            />
          )}
          <ScoringSettings
            key={`scoring-settings-${competition.id}`}
            competition={competition}
            token={token}
            onUnauthorized={onUnauthorized}
            onChange={(settings) => setCompetition((current) => (current ? { ...current, ...settings } : current))}
          />
          {(competition.status === 'Check-in' || competition.status === 'Active') && (
            <LaneScoringCodes
              key={`scoring-codes-${competition.id}`}
              competitionId={competition.id}
              name={competition.name}
              status={competition.status}
              codes={qrCodes}
              onCodesChange={setQrCodes}
              token={token}
              onUnauthorized={onUnauthorized}
            />
          )}
          <CompetitionLanes
            status={competition.status}
            onChange={onLanesChange}
            key={`${competition.id}-${competition.range.id}-${configurationRevision}`}
            competitionId={competition.id}
            token={token}
            onUnauthorized={onUnauthorized}
          />
          <CompetitionParticipants
            defaultTargetType={competition.defaultTargetType}
            onChange={onParticipantsChange}
            status={competition.status}
            lanes={laneSnapshot?.data ?? []}
            key={`participants-${competition.id}-${competition.range.id}-${competition.status}-${configurationRevision}`}
            competitionId={competition.id}
            token={token}
            onUnauthorized={onUnauthorized}
          />
        </>
      )}
    </>
  );
}

function CompetitionLanes({
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
            <div className="table-scroll">
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
          </>
        )}
      </div>
    </section>
  );
}

function LaneConfiguration({
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
  const [draft, setDraft] = useState({ targetType: lane.targetType ?? '', numberOfTargets: lane.numberOfTargets ?? 1 });
  const latestDraft = useRef(draft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const saves = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(
    (next: typeof draft) => {
      const version = ++revision.current;
      setPending(true);
      setError('');
      // Start immediately; serialize subsequent changes to preserve their order.
      // Queued writes finish even if the user navigates away.
      saves.current = saves.current.then(async () => {
        try {
          const response = await managementRequest(
            `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/lanes/${encodeURIComponent(lane.laneId)}`,
            token,
            {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetType: next.targetType || null, numberOfTargets: next.numberOfTargets }),
            },
          );
          if (response.status === 401) {
            if (mounted.current) onUnauthorized(t(expiredMessage));
            return;
          }
          if (!response.ok && mounted.current && version === revision.current) {
            setError(t('CompetitionDetailPage.could_not_save_lane_configuration_your_changes_have_been'));
          }
        } catch {
          if (mounted.current && version === revision.current) {
            setError(t('CompetitionDetailPage.could_not_reach_the_server_your_changes_have_been'));
          }
        } finally {
          if (mounted.current && version === revision.current) setPending(false);
        }
      });
    },
    [competitionId, lane.laneId, token, onUnauthorized],
  );

  const change = useCallback(
    (next: typeof draft) => {
      latestDraft.current = next;
      setDraft(next);
      onChange(lane.laneId, next);
      save(next);
    },
    [save, lane.laneId, onChange],
  );

  useEffect(() => {
    if (bulkUpdate?.laneIds.has(lane.laneId)) change({ ...latestDraft.current, ...bulkUpdate.changes });
  }, [bulkUpdate, lane.laneId, change]);

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
            onChange={(event) => change({ ...latestDraft.current, targetType: event.target.value })}
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
            onChange={(event) => change({ ...latestDraft.current, numberOfTargets: Number(event.target.value) })}
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
            <button
              type="button"
              className="secondary retry-button"
              disabled={readOnly}
              onClick={() => save(latestDraft.current)}
            >
              {t('CompetitionDetailPage.try_again')}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
