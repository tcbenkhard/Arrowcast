import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { ScoringContext, ScoringMutation } from '@arrowcast/contracts';

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const headers = { 'Content-Type': 'application/json', 'X-Arrowcast-Scoring': '1' };
const buttons = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'M'];
const arrowValue = (symbol: string | null) => symbol === 'M' || symbol === null ? 0 : Number(symbol);
function submissionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues is also available when a venue serves scoring over LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ScoringPage() {
  const { competitionId, laneId, grantId } = useParams();
  return <ScoringLane key={`${competitionId}/${laneId}/${grantId}`} competitionId={competitionId!} laneId={laneId!} grantId={grantId!} />;
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
    const response = await fetch(`${base}/${exchange ? 'exchange' : 'context'}`, exchange ? {
      method: 'POST', headers, body: JSON.stringify({ token: rawToken.current }), credentials: 'same-origin', cache: 'no-store',
    } : { credentials: 'same-origin', cache: 'no-store' });
    const result = await response.json() as ScoringContext & { message?: string };
    if (!response.ok) throw new ApiError(response.status, result.message ?? 'Could not load lane scores.');
    if (result.competition.id !== competitionId || result.lane.id !== laneId) throw new ApiError(403, 'This QR code belongs to a different competition or lane.');
    if (exchange) rawToken.current = null;
    return result;
  }
  function endAccess(err: unknown) {
    if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 403)) return false;
    setContext(null); setArrows([]); pendingOperation.current = null;
    correctionDirty.current = false;
    setConflict(false); setRetryable(false); setNotice(''); setError(err.message);
    return true;
  }
  function selectRound(next: ScoringContext, selected: NonNullable<typeof selection>, preserveArrowIndex = false) {
    selectionRef.current = selected; setSelection(selected); correctionDirty.current = false;
    const round = next.rounds.find((r) => r.participantId === selected.participantId && r.roundNumber === selected.roundNumber);
    const values = round?.arrows ?? Array.from({ length: next.competition.arrowsPerRound }, () => null);
    setArrows(values); const emptyIndex = values.findIndex((value) => value === null);
    if (!preserveArrowIndex) setArrowIndex(emptyIndex < 0 ? values.length - 1 : emptyIndex);
  }
  function adoptContext(next: ScoringContext, advance = false, preserveArrowIndex = false) {
    if (next.version < latestVersion.current) return;
    latestVersion.current = next.version; setContext(next);
    const selected = advance && next.currentParticipantId
      ? { participantId: next.currentParticipantId, roundNumber: next.currentRoundNumber }
      : selectionRef.current ?? (next.currentParticipantId ? { participantId: next.currentParticipantId, roundNumber: next.currentRoundNumber } : null);
    if (selected) selectRound(next, selected, preserveArrowIndex);
  }
  useEffect(() => {
    let cancelled = false;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('token')) {
      rawToken.current = fragment.get('token');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setError(''); setRetryable(false);
    // Reuse the exchange promise during React StrictMode's effect replay.
    opening.current ??= requestContext(rawToken.current !== null);
    void opening.current.then((result) => { if (!cancelled) adoptContext(result); })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not connect. Check your connection and try again.');
          setRetryable(!(err instanceof ApiError) || err.status >= 500);
        }
      });
    return () => { cancelled = true; };
  }, [base, retry]);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (busyRef.current || pendingOperation.current) return;
      void requestContext().then((result) => {
        if (!cancelled && !busyRef.current && !pendingOperation.current && result.version >= latestVersion.current) {
          if (result.version > latestVersion.current) {
            if (correctionDirty.current) {
              setContext(result); setConflict(true); setNotice('');
              setError('Lane progress changed on another device. Reload the latest scores before continuing.');
            } else { setNotice('Lane progress updated from another device.'); adoptContext(result); }
          } else setContext(result);
        }
      }).catch((err: unknown) => {
        if (!cancelled && endAccess(err)) return;
        if (!cancelled && !busyRef.current && !pendingOperation.current) {
          setError(err instanceof Error ? err.message : 'Could not refresh scores. Check your connection.');
          setConflict(true);
        }
      });
    }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
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
    busyRef.current = true; setBusy(true); setError(''); setNotice('Saving…'); setRetryable(false);
    pendingOperation.current = operation;
    try {
      const response = await fetch(`${base}/scores`, { method: 'POST', headers, body: JSON.stringify(operation), credentials: 'same-origin' });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new ApiError(response.status, result.message ?? 'Could not save scores.');
      const next = await requestContext();
      const wasCorrection = context?.rounds.some((round) => round.participantId === operation.participantId
        && round.roundNumber === operation.roundNumber && round.status === 'submitted');
      pendingOperation.current = null; adoptContext(next, operation.submit, !operation.submit); setConflict(false);
      if (operation.submit) setScrollAfterSave((value) => value + 1);
      setNotice(wasCorrection ? 'Correction saved.' : operation.submit ? next.completed ? 'All rounds saved. Lane scoring complete.' : 'Scores saved. Next participant selected.' : 'Draft saved. Press Save to confirm and continue.');
    } catch (err) {
      if (endAccess(err)) return;
      setNotice('');
      setError(err instanceof Error ? err.message : 'Connection lost. Your input is still shown. Retry to confirm it was saved.');
      if (err instanceof ApiError && err.status < 500) { setConflict(true); }
      else setRetryable(true);
    } finally { busyRef.current = false; setBusy(false); }
  }
  function save(values: (string | null)[], submit: boolean) {
    if (!context || busyRef.current || pendingOperation.current || conflict || !selection) return;
    if (selection.roundNumber > context.currentRoundNumber) return;
    setArrows(values);
    const submitted = context.rounds.some((round) => round.participantId === selection.participantId
      && round.roundNumber === selection.roundNumber && round.status === 'submitted');
    if (submitted && !submit) {
      correctionDirty.current = true; setNotice('Correction not saved. Press Save correction to confirm.');
      return;
    }
    void perform({ submissionId: submissionId(), expectedVersion: context.version,
      participantId: selection.participantId, roundNumber: selection.roundNumber, arrows: values, submit });
  }
  async function reload() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const next = await requestContext();
      pendingOperation.current = null; adoptContext(next); setError(''); setConflict(false); setRetryable(false);
      setNotice('Latest lane scores loaded.');
    } catch (err) { if (!endAccess(err)) setError(err instanceof Error ? err.message : 'Could not load scores.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const correcting = context?.rounds.some((round) => round.participantId === selection?.participantId
    && round.roundNumber === selection?.roundNumber && round.status === 'submitted');
  function chooseRound(selected: NonNullable<typeof selection>) {
    if (!context) return;
    if (selected.roundNumber > context.currentRoundNumber) return;
    if (selection?.participantId === selected.participantId && selection.roundNumber === selected.roundNumber) return;
    if (correctionDirty.current && !window.confirm('Discard your unsaved correction?')) return;
    selectRound(context, selected); setNotice('');
  }
  const locked = context?.competition.status !== 'Active' || context.competition.scoringLocked;
  const disabled = busy || conflict || pendingOperation.current !== null || !!locked;
  const roundBlocked = !!context && !!selection && selection.roundNumber > context.currentRoundNumber;
  const entryDisabled = disabled || roundBlocked;
  return <main className="scoring-page">
    {!context && !error && <div className="panel"><p role="status">Opening lane scores…</p></div>}
    {error && <div className="panel scoring-message"><p className="error" role="alert">{error}</p>
      {retryable && <button disabled={busy} onClick={() => {
        if (pendingOperation.current) void perform(pendingOperation.current);
        else if (context) void reload();
        else { opening.current = null; setRetry((value) => value + 1); }
      }}>Retry</button>}
      {conflict && <button className="secondary" disabled={busy} onClick={() => { void reload(); }}>Reload latest scores</button>}
    </div>}
    {context && <>
      {locked && <div className="panel scoring-message"><p role="status">Score entry is paused.</p></div>}
      {context.completed ? <section className="panel"><h2>Lane scoring complete</h2>
        <p>{context.participants.length ? 'All participants have completed every round.' : 'No participants are assigned to this lane.'}</p>
      </section> : null}
      {context.participants.length > 0 && <div className="scoring-participants" role="group" aria-label="Lane participants">
        {context.participants.map((participant) => {
          const active = selection?.participantId === participant.id;
          const headingId = active ? 'current-archer' : `participant-heading-${participant.id}`;
          const panelId = `participant-scores-${participant.id}`;
          return <section key={participant.id} className={`panel scoring-participant${active ? ' active' : ''}`} aria-labelledby={headingId}>
            <h2 id={headingId} ref={active ? activeParticipantHeading : undefined}><button type="button" className="scoring-participant-toggle" aria-expanded={active}
              aria-controls={panelId} disabled={disabled} onClick={() => {
                if (!active) chooseRound({ participantId: participant.id,
                  roundNumber: Math.min(selection?.roundNumber ?? context.currentRoundNumber, context.currentRoundNumber) });
              }}>
              <span>{context.lane.number}{participant.targetLetter} · {participant.name}</span>
              <span aria-hidden="true">{active ? '−' : '+'}</span>
            </button></h2>
            <div id={panelId} hidden={!active}>
            {active && <div className="score-entry" aria-busy={busy}>
        <p>Round {selection.roundNumber} of {context.competition.numberOfRounds} · {context.competition.arrowsPerRound} arrows</p>
        {roundBlocked && <p className="scoring-message" role="alert">
          Round {selection.roundNumber} cannot be saved yet. Finish round {context.currentRoundNumber} for everyone in your lane first.
        </p>}
        <div className="scoring-arrow-row">
        <div className="scoring-arrow-slots" role="group" aria-label="Arrow scores">
          {arrows.map((symbol, index) => <button key={index} className={index === arrowIndex ? 'selected' : 'secondary'}
            aria-label={`Arrow ${index + 1}: ${symbol ?? 'not entered'}`} aria-pressed={index === arrowIndex}
            disabled={entryDisabled} onClick={() => setArrowIndex(index)}>{symbol ?? '—'}</button>)}
        </div>
        <p className="scoring-subtotal"><span>Round total</span><strong>{arrows.reduce<number>((sum, value) => sum + arrowValue(value), 0)}</strong></p>
        </div>
        <div className="scoring-keypad" role="group" aria-label="Score keypad">{buttons.map((symbol) => <button key={symbol}
          disabled={entryDisabled} aria-label={symbol === 'M' ? 'Score Miss' : `Score ${symbol}`}
          onClick={() => {
            save(arrows.map((value, index) => index === arrowIndex ? symbol : value), false);
            setArrowIndex(Math.min(arrowIndex + 1, arrows.length - 1));
          }}>{symbol === 'M' ? 'Miss' : symbol}</button>)}
          <button className="scoring-backspace" aria-label="Backspace" disabled={entryDisabled || (arrows[arrowIndex] === null && arrowIndex === 0)}
            onClick={() => {
              const indexToClear = arrows[arrowIndex] === null ? arrowIndex - 1 : arrowIndex;
              save(arrows.map((value, index) => index === indexToClear ? null : value), false);
              setArrowIndex(indexToClear);
            }}>←</button>
        </div>
        <button className="scoring-save" disabled={entryDisabled || arrows.some((value) => value === null)}
          onClick={() => save(arrows, true)}>{correcting ? 'Save correction' : 'Save'}</button>
        <ParticipantScores context={context} participantId={participant.id} selectedRound={selection.roundNumber}
          disabled={disabled} onSelectRound={(roundNumber) => chooseRound({ participantId: participant.id, roundNumber })} />
        <p className="scoring-notice visually-hidden" role="status" aria-live="polite">{notice}</p>
            </div>}
            </div>
          </section>;
        })}
      </div>}
    </>}
  </main>;
}

function ParticipantScores({ context, participantId, selectedRound, disabled, onSelectRound }: {
  context: ScoringContext; participantId: string; selectedRound: number; disabled: boolean; onSelectRound: (roundNumber: number) => void;
}) {
  const rounds = new Map(context.rounds.filter((round) => round.participantId === participantId)
    .map((round) => [round.roundNumber, round]));
  let cumulativeTotal = 0;
  return <div className="table-scroll participant-scorecard">
    <h3>Scoresheet</h3>
    <table aria-label="Participant scores">
      <thead className="visually-hidden"><tr><th scope="col">Round</th>
        {Array.from({ length: context.competition.arrowsPerRound }, (_, index) => <th scope="col" key={index}>Arrow {index + 1}</th>)}
        <th scope="col">Round Total</th><th scope="col">Cumulative Total</th>
      </tr></thead>
      <tbody>{Array.from({ length: context.competition.numberOfRounds }, (_, index) => {
        const round = rounds.get(index + 1);
        const hasScores = round?.arrows.some((value) => value !== null);
        const roundDisabled = disabled || index + 1 > context.currentRoundNumber;
        cumulativeTotal += round?.total ?? 0;
        return <tr key={index} className={selectedRound === index + 1 ? 'selected-round' : undefined} aria-disabled={roundDisabled}
          onClick={() => { if (!roundDisabled) onSelectRound(index + 1); }}>
          <th scope="row"><button type="button" className="scoresheet-round" aria-label={`Edit round ${index + 1}`}
            aria-pressed={selectedRound === index + 1} disabled={roundDisabled}>{index + 1}</button></th>
          {Array.from({ length: context.competition.arrowsPerRound }, (_, arrowIndex) =>
            <td key={arrowIndex}>{round?.arrows[arrowIndex] ?? '—'}</td>)}
          <td>{hasScores ? round!.total : '—'}</td><td>{hasScores ? cumulativeTotal : '—'}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
