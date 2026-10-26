import type { ScoringContext, ScoringMutation } from '@arrowcast/contracts';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { HttpError } from '../../lib/http';
import { createSubmissionId } from '../../lib/submission-id';
import { loadScoringContext, ScoringContextMismatchError, submitLaneScores } from './scoring-api';
import { findScoringRound, type RoundSelection } from './scoring-round';

/** Owns lane scoring synchronization, retries, and unsaved corrections. */
export function useScoringLane(competitionId: string, laneId: string, grantId: string) {
  const [context, setContext] = useState<ScoringContext | null>(null);
  const [arrows, setArrows] = useState<(string | null)[]>([]);
  const [arrowIndex, setArrowIndex] = useState(0);
  const [selection, setSelection] = useState<RoundSelection | null>(null);
  const selectionRef = useRef<typeof selection>(null);
  const [scrollAfterSave, setScrollAfterSave] = useState(0);
  const correctionDirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waitingForStart, setWaitingForStart] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const pendingOperation = useRef<ScoringMutation | null>(null);
  const busyRef = useRef(false);
  const latestVersion = useRef(-1);
  const rawToken = useRef<string | null>(null);
  const opening = useRef<Promise<ScoringContext> | null>(null);

  async function requestContext(exchange = false): Promise<ScoringContext> {
    try {
      const result = await loadScoringContext(
        { competitionId, laneId, grantId },
        exchange ? rawToken.current : undefined,
      );
      if (exchange) rawToken.current = null;
      return result;
    } catch (error) {
      if (error instanceof ScoringContextMismatchError)
        throw new HttpError(error.status, t('ScoringPage.this_qr_code_belongs_to_a_different_competition_or'));
      if (error instanceof HttpError && !error.body)
        throw new HttpError(error.status, t('ScoringPage.could_not_load_lane_scores'));
      throw error;
    }
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
    const round = findScoringRound(next, selected);
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
    let timer: number | undefined;
    let waiting = false;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('token')) {
      rawToken.current = fragment.get('token');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setError('');
    setRetryable(false);
    function open() {
      // Reuse the exchange promise during React StrictMode's effect replay.
      opening.current ??= requestContext(rawToken.current !== null);
      void opening.current
        .then((result) => {
          if (cancelled) return;
          setWaitingForStart(false);
          setError('');
          setRetryable(false);
          adoptContext(result);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const notStarted =
            err instanceof HttpError &&
            typeof err.body === 'object' &&
            err.body !== null &&
            'code' in err.body &&
            err.body.code === 'SCORING_NOT_STARTED';
          const transient = !(err instanceof HttpError) || err.status >= 500;
          waiting = notStarted || (waiting && transient);
          setWaitingForStart(waiting);
          setError(
            err instanceof Error ? err.message : t('ScoringPage.could_not_connect_check_your_connection_and_try_again'),
          );
          setRetryable(!waiting && transient);
          if (waiting) {
            timer = window.setTimeout(() => {
              opening.current = null;
              open();
            }, 5000);
          }
        });
    }
    open();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [competitionId, laneId, grantId, retry]);

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
  }, [competitionId, laneId, grantId, !!context]);

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
      try {
        await submitLaneScores(grantId, operation);
      } catch (error) {
        if (error instanceof HttpError && !error.body)
          throw new HttpError(error.status, t('ScoringPage.could_not_save_scores'));
        throw error;
      }
      const next = await requestContext();
      const wasCorrection = context && findScoringRound(context, operation)?.status === 'submitted';
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
    const submitted = findScoringRound(context, selection)?.status === 'submitted';
    if (submitted && !submit) {
      correctionDirty.current = true;
      setNotice(t('ScoringPage.correction_not_saved_press_save_correction_to_confirm'));
      return;
    }
    void perform({
      submissionId: createSubmissionId(),
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
  const correcting = !!context && findScoringRound(context, selection)?.status === 'submitted';
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
  function retryRequest() {
    if (pendingOperation.current) void perform(pendingOperation.current);
    else if (context) void reload();
    else {
      opening.current = null;
      setRetry((value) => value + 1);
    }
  }
  return {
    context,
    arrows,
    arrowIndex,
    setArrowIndex,
    selection,
    scrollAfterSave,
    busy,
    error,
    waitingForStart,
    conflict,
    retryable,
    notice,
    correcting,
    locked,
    disabled,
    roundBlocked,
    entryDisabled,
    save,
    reload,
    retryRequest,
    chooseRound,
  };
}
