import type { ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { LanguageSelect } from '../../components/LanguageSelect';
import { message, t } from '../../i18n';
import { HttpError, requireJson, scoringRequest } from '../../lib/http';

const headers = { 'Content-Type': 'application/json', 'X-Arrowcast-Scoring': '1' };
const buttons = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'M'];
const arrowValue = (symbol: string | null) => (symbol === 'M' || symbol === null ? 0 : Number(symbol));
function submissionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues is also available when a venue serves scoring over LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ScoringPage() {
  const { competitionId, laneId, grantId } = useParams();
  return (
    <ScoringLane
      key={`${competitionId}/${laneId}/${grantId}`}
      competitionId={competitionId!}
      laneId={laneId!}
      grantId={grantId!}
    />
  );
}

function ScoringLane({ competitionId, laneId, grantId }: { competitionId: string; laneId: string; grantId: string }) {
  const [context, setContext] = useState<ScoringContext | null>(null);
  const [arrows, setArrows] = useState<(string | null)[]>([]);
  const [arrowIndex, setArrowIndex] = useState(0);
  const [selection, setSelection] = useState<{ participantId: string; roundNumber: number } | null>(null);
  const selectionRef = useRef<typeof selection>(null);
  const activeParticipantHeading = useRef<HTMLHeadingElement>(null);
  const [scrollAfterSave, setScrollAfterSave] = useState(0);
  const correctionDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const pendingOperation = useRef<ScoringMutation | null>(null);
  const busyRef = useRef(false);
  const latestVersion = useRef(-1);
  const rawToken = useRef<string | null>(null);
  const opening = useRef<Promise<ScoringContext> | null>(null);
  const base = `/api/v1/scoring/${encodeURIComponent(grantId)}`;

  useEffect(() => {
    if (scrollAfterSave > 0) activeParticipantHeading.current?.scrollIntoView({ block: 'start' });
  }, [scrollAfterSave]);

  async function requestContext(exchange = false): Promise<ScoringContext> {
    const response = await scoringRequest(
      `${base}/${exchange ? 'exchange' : 'context'}`,
      exchange
        ? {
            method: 'POST',
            headers,
            json: { token: rawToken.current },
          }
        : {},
    );
    let result: ScoringContext & { message?: string };
    try {
      result = await requireJson<ScoringContext & { message?: string }>(response);
    } catch (error) {
      if (error instanceof HttpError && !error.body)
        throw new HttpError(error.status, t('ScoringPage.could_not_load_lane_scores'));
      throw error;
    }
    if (result.competition.id !== competitionId || result.lane.id !== laneId)
      throw new HttpError(403, t('ScoringPage.this_qr_code_belongs_to_a_different_competition_or'));
    if (exchange) rawToken.current = null;
    return result;
  }
  function endAccess(err: unknown) {
    if (!(err instanceof HttpError) || (err.status !== 401 && err.status !== 403)) return false;
    setContext(null);
    setArrows([]);
    pendingOperation.current = null;
    correctionDirty.current = false;
    setConflict(false);
    setRetryable(false);
    setNotice('');
    setError(err.message);
    return true;
  }
  function selectRound(next: ScoringContext, selected: NonNullable<typeof selection>, preserveArrowIndex = false) {
    selectionRef.current = selected;
    setSelection(selected);
    correctionDirty.current = false;
    const round = next.rounds.find(
      (r) => r.participantId === selected.participantId && r.roundNumber === selected.roundNumber,
    );
    const values = round?.arrows ?? Array.from({ length: next.competition.arrowsPerRound }, () => null);
    setArrows(values);
    const emptyIndex = values.findIndex((value) => value === null);
    if (!preserveArrowIndex) setArrowIndex(emptyIndex < 0 ? values.length - 1 : emptyIndex);
  }
  function adoptContext(next: ScoringContext, advance = false, preserveArrowIndex = false) {
    if (next.version < latestVersion.current) return;
    latestVersion.current = next.version;
    setContext(next);
    const selected =
      advance && next.currentParticipantId
        ? { participantId: next.currentParticipantId, roundNumber: next.currentRoundNumber }
        : (selectionRef.current ??
          (next.currentParticipantId
            ? { participantId: next.currentParticipantId, roundNumber: next.currentRoundNumber }
            : null));
    if (selected) selectRound(next, selected, preserveArrowIndex);
  }
  useEffect(() => {
    let cancelled = false;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('token')) {
      rawToken.current = fragment.get('token');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setError('');
    setRetryable(false);
    // Reuse the exchange promise during React StrictMode's effect replay.
    opening.current ??= requestContext(rawToken.current !== null);
    void opening.current
      .then((result) => {
        if (!cancelled) adoptContext(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t('ScoringPage.could_not_connect_check_your_connection_and_try_again'),
          );
          setRetryable(!(err instanceof HttpError) || err.status >= 500);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [base, retry]);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (busyRef.current || pendingOperation.current) return;
      void requestContext()
        .then((result) => {
          if (!cancelled && !busyRef.current && !pendingOperation.current && result.version >= latestVersion.current) {
            if (result.version > latestVersion.current) {
              if (correctionDirty.current) {
                setContext(result);
                setConflict(true);
                setNotice('');
                setError(t('ScoringPage.lane_progress_changed_on_another_device_reload_the_latest'));
              } else {
                setNotice(t('ScoringPage.lane_progress_updated_from_another_device'));
                adoptContext(result);
              }
            } else setContext(result);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && endAccess(err)) return;
          if (!cancelled && !busyRef.current && !pendingOperation.current) {
            setError(
              err instanceof Error ? err.message : t('ScoringPage.could_not_refresh_scores_check_your_connection'),
            );
            setConflict(true);
          }
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [base, !!context]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (busyRef.current || pendingOperation.current || correctionDirty.current) event.preventDefault();
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  async function perform(operation: ScoringMutation) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice(t('CompetitionsPage.saving'));
    setRetryable(false);
    pendingOperation.current = operation;
    try {
      const response = await scoringRequest(`${base}/scores`, { method: 'POST', headers, json: operation });
      try {
        await requireJson<{ message?: string }>(response);
      } catch (error) {
        if (error instanceof HttpError && !error.body)
          throw new HttpError(error.status, t('ScoringPage.could_not_save_scores'));
        throw error;
      }
      const next = await requestContext();
      const wasCorrection = context?.rounds.some(
        (round) =>
          round.participantId === operation.participantId &&
          round.roundNumber === operation.roundNumber &&
          round.status === 'submitted',
      );
      pendingOperation.current = null;
      adoptContext(next, operation.submit, !operation.submit);
      setConflict(false);
      if (operation.submit) setScrollAfterSave((value) => value + 1);
      setNotice(
        wasCorrection
          ? t('ScoringPage.correction_saved')
          : operation.submit
            ? next.completed
              ? t('ScoringPage.all_rounds_saved_lane_scoring_complete')
              : t('ScoringPage.scores_saved_next_participant_selected')
            : t('ScoringPage.draft_saved_press_save_to_confirm_and_continue'),
      );
    } catch (err) {
      if (endAccess(err)) return;
      setNotice('');
      setError(
        err instanceof Error ? err.message : t('ScoringPage.connection_lost_your_input_is_still_shown_retry_to'),
      );
      if (err instanceof HttpError && err.status < 500) {
        setConflict(true);
      } else setRetryable(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function save(values: (string | null)[], submit: boolean) {
    if (!context || busyRef.current || pendingOperation.current || conflict || !selection) return;
    if (selection.roundNumber > context.currentRoundNumber) return;
    setArrows(values);
    const submitted = context.rounds.some(
      (round) =>
        round.participantId === selection.participantId &&
        round.roundNumber === selection.roundNumber &&
        round.status === 'submitted',
    );
    if (submitted && !submit) {
      correctionDirty.current = true;
      setNotice(t('ScoringPage.correction_not_saved_press_save_correction_to_confirm'));
      return;
    }
    void perform({
      submissionId: submissionId(),
      expectedVersion: context.version,
      participantId: selection.participantId,
      roundNumber: selection.roundNumber,
      arrows: values,
      submit,
    });
  }
  async function reload() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await requestContext();
      pendingOperation.current = null;
      adoptContext(next);
      setError('');
      setConflict(false);
      setRetryable(false);
      setNotice(t('ScoringPage.latest_lane_scores_loaded'));
    } catch (err) {
      if (!endAccess(err)) setError(err instanceof Error ? err.message : t('ScoringPage.could_not_load_scores'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const correcting = context?.rounds.some(
    (round) =>
      round.participantId === selection?.participantId &&
      round.roundNumber === selection?.roundNumber &&
      round.status === 'submitted',
  );
  function chooseRound(selected: NonNullable<typeof selection>) {
    if (!context) return;
    if (selected.roundNumber > context.currentRoundNumber) return;
    if (selection?.participantId === selected.participantId && selection.roundNumber === selected.roundNumber) return;
    if (correctionDirty.current && !window.confirm(t('ScoringPage.discard_your_unsaved_correction'))) return;
    selectRound(context, selected);
    setNotice('');
  }
  const locked = context?.competition.status !== 'Active' || context.competition.scoringLocked;
  const disabled = busy || conflict || pendingOperation.current !== null || !!locked;
  const roundBlocked = !!context && !!selection && selection.roundNumber > context.currentRoundNumber;
  const entryDisabled = disabled || roundBlocked;
  return (
    <main className="scoring-page">
      {!context && !error && (
        <div className="panel">
          <p role="status">{t('ScoringPage.opening_lane_scores')}</p>
        </div>
      )}
      {error && (
        <div className="panel scoring-message">
          <p className="error" role="alert">
            {message(error)}
          </p>
          {retryable && (
            <button
              disabled={busy}
              onClick={() => {
                if (pendingOperation.current) void perform(pendingOperation.current);
                else if (context) void reload();
                else {
                  opening.current = null;
                  setRetry((value) => value + 1);
                }
              }}
            >
              {t('ScoringPage.retry')}
            </button>
          )}
          {conflict && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                void reload();
              }}
            >
              {t('ScoringPage.reload_latest_scores')}
            </button>
          )}
        </div>
      )}
      {context && (
        <>
          {locked && (
            <div className="panel scoring-message">
              <p role="status">{t('ScoringPage.score_entry_is_paused')}</p>
            </div>
          )}
          {context.completed ? (
            <section className="panel">
              <h2>{t('ScoringPage.lane_scoring_complete')}</h2>
              <p>
                {context.participants.length
                  ? t('ScoringPage.all_participants_have_completed_every_round')
                  : t('ScoringPage.no_participants_are_assigned_to_this_lane')}
              </p>
            </section>
          ) : null}
          {context.participants.length > 0 && (
            <div className="scoring-participants" role="group" aria-label={t('ScoringPage.lane_participants')}>
              {context.participants.map((participant) => {
                const active = selection?.participantId === participant.id;
                const headingId = active ? 'current-archer' : `participant-heading-${participant.id}`;
                const panelId = `participant-scores-${participant.id}`;
                return (
                  <section
                    key={participant.id}
                    className={`panel scoring-participant${active ? ' active' : ''}`}
                    aria-labelledby={headingId}
                  >
                    <h2 id={headingId} ref={active ? activeParticipantHeading : undefined}>
                      <button
                        type="button"
                        className="scoring-participant-toggle"
                        aria-expanded={active}
                        aria-controls={panelId}
                        disabled={disabled}
                        onClick={() => {
                          if (!active)
                            chooseRound({
                              participantId: participant.id,
                              roundNumber: Math.min(
                                selection?.roundNumber ?? context.currentRoundNumber,
                                context.currentRoundNumber,
                              ),
                            });
                        }}
                      >
                        <span>
                          {context.lane.number}
                          {participant.targetLetter} · {participant.name}
                        </span>
                        <span aria-hidden="true">{active ? '−' : '+'}</span>
                      </button>
                    </h2>
                    <div id={panelId} hidden={!active}>
                      {active && (
                        <div className="score-entry" aria-busy={busy}>
                          <p>
                            {t('scoring.roundProgress', {
                              round: selection.roundNumber,
                              rounds: context.competition.numberOfRounds,
                              arrows: context.competition.arrowsPerRound,
                            })}
                          </p>
                          {roundBlocked && (
                            <p className="scoring-message" role="alert">
                              {t('scoring.roundBlocked', {
                                round: selection.roundNumber,
                                current: context.currentRoundNumber,
                              })}
                            </p>
                          )}
                          <div className="scoring-arrow-row">
                            <div
                              className="scoring-arrow-slots"
                              role="group"
                              aria-label={t('ScoringPage.arrow_scores')}
                            >
                              {arrows.map((symbol, index) => (
                                <button
                                  key={index}
                                  className={index === arrowIndex ? 'selected' : 'secondary'}
                                  aria-label={t('ScoringPage.arrow', {
                                    p0: index + 1,
                                    p1: symbol ?? t('ScoringPage.not_entered'),
                                  })}
                                  aria-pressed={index === arrowIndex}
                                  disabled={entryDisabled}
                                  onClick={() => setArrowIndex(index)}
                                >
                                  {symbol ?? '—'}
                                </button>
                              ))}
                            </div>
                            <p className="scoring-subtotal">
                              <span>{t('ScoringPage.round_total')}</span>
                              <strong>{arrows.reduce<number>((sum, value) => sum + arrowValue(value), 0)}</strong>
                            </p>
                          </div>
                          <div className="scoring-keypad" role="group" aria-label={t('ScoringPage.score_keypad')}>
                            {buttons.map((symbol) => (
                              <button
                                key={symbol}
                                disabled={entryDisabled}
                                aria-label={
                                  symbol === 'M' ? t('ScoringPage.score_miss') : t('ScoringPage.score', { p0: symbol })
                                }
                                onClick={() => {
                                  save(
                                    arrows.map((value, index) => (index === arrowIndex ? symbol : value)),
                                    false,
                                  );
                                  setArrowIndex(Math.min(arrowIndex + 1, arrows.length - 1));
                                }}
                              >
                                {symbol === 'M' ? t('ScoringPage.miss') : symbol}
                              </button>
                            ))}
                            <button
                              className="scoring-backspace"
                              aria-label={t('ScoringPage.backspace')}
                              disabled={entryDisabled || (arrows[arrowIndex] === null && arrowIndex === 0)}
                              onClick={() => {
                                const indexToClear = arrows[arrowIndex] === null ? arrowIndex - 1 : arrowIndex;
                                save(
                                  arrows.map((value, index) => (index === indexToClear ? null : value)),
                                  false,
                                );
                                setArrowIndex(indexToClear);
                              }}
                            >
                              ←
                            </button>
                          </div>
                          <button
                            className="scoring-save"
                            disabled={entryDisabled || arrows.some((value) => value === null)}
                            onClick={() => save(arrows, true)}
                          >
                            {correcting ? t('ScoringPage.save_correction') : t('ScoringPage.save')}
                          </button>
                          <ParticipantScores
                            context={context}
                            participantId={participant.id}
                            selectedRound={selection.roundNumber}
                            disabled={disabled}
                            onSelectRound={(roundNumber) => chooseRound({ participantId: participant.id, roundNumber })}
                          />
                          <p className="scoring-notice visually-hidden" role="status" aria-live="polite">
                            {message(notice)}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
      <footer className="scoring-footer">
        <LanguageSelect flags />
      </footer>
    </main>
  );
}

function ParticipantScores({
  context,
  participantId,
  selectedRound,
  disabled,
  onSelectRound,
}: {
  context: ScoringContext;
  participantId: string;
  selectedRound: number;
  disabled: boolean;
  onSelectRound: (roundNumber: number) => void;
}) {
  const rounds = new Map(
    context.rounds.filter((round) => round.participantId === participantId).map((round) => [round.roundNumber, round]),
  );
  let cumulativeTotal = 0;
  return (
    <div className="table-scroll participant-scorecard">
      <h3>{t('ScoringPage.scoresheet')}</h3>
      <table aria-label={t('ScoringPage.participant_scores')}>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{t('ScoringPage.round')}</span>
            </th>
            {Array.from({ length: context.competition.arrowsPerRound }, (_, index) => (
              <th scope="col" key={index}>
                <span className="visually-hidden">{t('scoring.arrowHeading', { number: index + 1 })}</span>
              </th>
            ))}
            <th scope="col" aria-label={t('ScoringPage.round_total_295')}>
              {t('scoring.subtotalHeading')}
            </th>
            <th scope="col" aria-label={t('ScoringPage.cumulative_total')}>
              {t('scoring.totalHeading')}
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: context.competition.numberOfRounds }, (_, index) => {
            const round = rounds.get(index + 1);
            const hasScores = round?.arrows.some((value) => value !== null);
            const roundDisabled = disabled || index + 1 > context.currentRoundNumber;
            cumulativeTotal += round?.total ?? 0;
            return (
              <tr
                key={index}
                className={selectedRound === index + 1 ? 'selected-round' : undefined}
                aria-disabled={roundDisabled}
                onClick={() => {
                  if (!roundDisabled) onSelectRound(index + 1);
                }}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="scoresheet-round"
                    aria-label={t('ScoringPage.edit_round', { p0: index + 1 })}
                    aria-pressed={selectedRound === index + 1}
                    disabled={roundDisabled}
                  >
                    {index + 1}
                  </button>
                </th>
                {Array.from({ length: context.competition.arrowsPerRound }, (_, arrowIndex) => (
                  <td key={arrowIndex}>{round?.arrows[arrowIndex] ?? '—'}</td>
                ))}
                <td>{hasScores ? round!.total : '—'}</td>
                <td>{hasScores ? cumulativeTotal : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
