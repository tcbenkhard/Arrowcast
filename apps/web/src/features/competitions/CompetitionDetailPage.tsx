import type { Competition } from './competition';
import type { Lane } from './lane-configuration';
import { CompetitionLanes } from './CompetitionLanes';
import { Icon } from '../../components/Icon';
import { TrashIcon } from '../../components/TrashIcon';
import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { competitionStatuses } from './status';
import type { CompetitionStatus } from './status';
import { CompetitionStatusBadge } from './CompetitionStatusBadge';
import { CompetitionSyncStatus } from './CompetitionSyncStatus';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CompetitionDetailsModal } from './CompetitionDetailsModal';
import type { Participant } from '../participants/participant';
import { competitionWarnings } from './warnings';
import { shootingLineReduction } from './shooting-lines';
import { CompetitionParticipants } from '../participants/CompetitionParticipants';
import type { LaneQrCode, ScoringStanding } from '@arrowcast/contracts';
import { LaneScoringCodes } from '../scoring/LaneScoringCodes';
import { ScoringSettings } from '../scoring/ScoringSettings';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
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
  const mutationRevision = useRef(0);
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
  const lineReduction =
    validationReady && competition?.status === 'Check-in'
      ? shootingLineReduction(laneSnapshot.data!, participantSnapshot.data!)
      : null;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [changingStatus, setChangingStatus] = useState(false);
  const statusInProgress = useRef(false);
  const [statusError, setStatusError] = useState('');
  const [qrCodes, setQrCodes] = useState<LaneQrCode[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setCompetition(null);
    setDetailsAction(null);
    setDetailsNotice('');
    setQrCodes([]);
    setError('');
    async function load(background = false) {
      if (pending) return;
      pending = true;
      const revision = mutationRevision.current;
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
        if (!controller.signal.aborted)
          setCompetition((current) => {
            if (!background) return result;
            if (
              !current ||
              current.id !== result.id ||
              (result.scoresSyncedAt != null && current.status !== result.status) ||
              mutationRevision.current !== revision
            )
              return current;
            return { ...current, scoresSyncedAt: result.scoresSyncedAt ?? null };
          });
      } catch {
        if (!controller.signal.aborted && !background)
          setError(t('CompetitionDetailPage.could_not_load_competition_details_please_try_again'));
      } finally {
        pending = false;
      }
    }
    void load();
    const refresh = () => void load(true);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
    };
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
    }
    statusInProgress.current = true;
    setChangingStatus(true);
    setStatusError('');
    try {
      if (status === 'Closed') {
        const standingsResponse = await managementRequest(
          `/api/v1/admin/competitions/${encodeURIComponent(competition.id)}/scoring-standings`,
          token,
          { cache: 'no-store' },
        );
        if (standingsResponse.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (!standingsResponse.ok) throw new Error(t('CompetitionDetailPage.could_not_check_rounds_please_try_again'));
        const standings = (await standingsResponse.json()) as ScoringStanding[];
        const hasMissingRounds = standings.some(
          (participant) => participant.checkedIn && participant.enteredRounds < participant.totalRounds,
        );
        const message =
          (hasMissingRounds ? `${t('CompetitionDetailPage.warning_not_all_rounds_submitted').trimStart()}\n\n` : '') +
          t('CompetitionDetailPage.closing_the_competition_will_lock_all_scores_disable_all') +
          t('CompetitionDetailPage.end_competition_56');
        if (!window.confirm(message)) return;
      }
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
      mutationRevision.current++;
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
                      className="secondary icon-only-button"
                      aria-label={t('CompetitionDetailPage.edit')}
                      title={t('CompetitionDetailPage.edit')}
                      disabled={changingStatus}
                      onClick={() => {
                        setDetailsNotice('');
                        setDetailsAction('edit');
                      }}
                    >
                      <Icon name="pencil" />
                    </button>
                  )}
                  <button
                    ref={removeButton}
                    type="button"
                    className="danger icon-only-button"
                    aria-label={t('CompetitionDetailPage.remove')}
                    title={t('CompetitionDetailPage.remove')}
                    disabled={changingStatus}
                    onClick={() => {
                      setDetailsNotice('');
                      setDetailsAction('remove');
                    }}
                  >
                    <TrashIcon />
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
            <CompetitionSyncStatus syncedAt={competition.scoresSyncedAt} />
            {statusError && (
              <p className="error" role="alert">
                {message(statusError)}
              </p>
            )}
            {nextStatus && nextStatus !== 'Scheduled' && (
              <div className="competition-details-actions">
                <button
                  type="button"
                  className="with-icon"
                  disabled={changingStatus || !validationReady}
                  onClick={() => {
                    void changeStatus(nextStatus);
                  }}
                >
                  <Icon name={nextStatus === 'Check-in' ? 'checklist' : nextStatus === 'Active' ? 'play' : 'finish'} />
                  {t(transitionLabels[nextStatus])}
                </button>
              </div>
            )}
            {lineReduction && (
              <p className="competition-info" role="status">
                {t('CompetitionDetailPage.fewer_shooting_lines', lineReduction)}
              </p>
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
                mutationRevision.current++;
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
