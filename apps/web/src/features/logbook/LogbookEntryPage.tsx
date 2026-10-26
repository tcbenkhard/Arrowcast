import type { LogbookContext, LogbookPerson } from '@arrowcast/contracts';
import { useEffect, useRef, useState } from 'react';
import { LanguageSelect } from '../../components/LanguageSelect';
import { Icon } from '../../components/Icon';
import { message, t } from '../../i18n';
import { requireJson, scoringRequest } from '../../lib/http';
import { ScoreKeypad } from '../scoring/ScoreKeypad';
import { ScoreSheet } from '../scoring/ScoreSheet';
import { LogbookHistory } from './LogbookHistory';
import { GuestLogbookEntry } from './GuestLogbookEntry';
import { SecurityCodeEntry } from './SecurityCodeEntry';
import { readLogbookDraft, writeLogbookDraft } from './draft';

const base = '/api/v1/scoring/logbook';
const headers = { 'X-Arrowcast-Scoring': '1' };
const total = (arrows: (string | null)[]) =>
  arrows.reduce<number>((sum, arrow) => sum + (arrow === 'M' ? 0 : Number(arrow)), 0);

export function LogbookEntryPage() {
  const [guest, setGuest] = useState(false);
  const [restored, setRestored] = useState(readLogbookDraft);
  const cached = useRef(true);
  const [query, setQuery] = useState('');
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [people, setPeople] = useState<LogbookPerson[]>([]);
  const [person, setPerson] = useState<LogbookPerson | null>(null);
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [confirmingPin, setConfirmingPin] = useState(false);
  const [context, setContext] = useState<LogbookContext | null>(restored?.context ?? null);
  const [rounds, setRounds] = useState<(string | null)[][]>(restored?.rounds ?? []);
  const [round, setRound] = useState(restored?.round ?? 0);
  const [arrowIndex, setArrowIndex] = useState(restored?.arrowIndex ?? 0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const dirty = !!context && JSON.stringify(rounds) !== JSON.stringify(context.entry.rounds);

  useEffect(() => {
    if (context) cached.current = writeLogbookDraft({ context, rounds, round, arrowIndex });
  }, [context, rounds, round, arrowIndex]);

  useEffect(() => {
    if (!restored) return;
    const controller = new AbortController();
    void scoringRequest(`${base}/context`, { signal: controller.signal })
      .then(requireJson<LogbookContext>)
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.entry.id !== restored.context.entry.id) {
          setError(t('logbook.conflict'));
          return;
        }
        if (next.entry.version > restored.context.entry.version || next.entry.completedAt !== null) {
          setContext(next);
          setRounds(next.entry.rounds);
        }
      })
      .catch(() => {
        /* Keep the local sheet if the connection is temporarily unavailable. */
      });
    return () => controller.abort();
  }, [restored]);

  useEffect(() => {
    const controller = new AbortController();
    setPeople([]);
    setActiveSuggestion(0);
    if (!query.trim() || person || context || guest) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void scoringRequest(`${base}/participants?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(requireJson<LogbookPerson[]>)
        .then((result) => {
          if (!controller.signal.aborted) {
            setPeople(result);
            setError('');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(t('logbook.loadError'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, retry, person, !!context, guest]);

  useEffect(() => {
    function preventLoss(event: BeforeUnloadEvent) {
      if (busy || (dirty && !cached.current)) event.preventDefault();
    }
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, busy]);

  async function authenticate() {
    if (!person || busyRef.current) return;
    if (!person.hasPin && !confirmingPin) {
      if (!/^[0-9]{4,6}$/.test(pin)) {
        setError(t('logbook.invalidPin'));
        return;
      }
      setError('');
      setConfirmingPin(true);
      return;
    }
    if (!/^[0-9]{4,6}$/.test(pin) || (!person.hasPin && !/^[0-9]{4,6}$/.test(confirmation))) {
      setError(t('logbook.invalidPin'));
      return;
    }
    if (!person.hasPin && pin !== confirmation) {
      setError(t('logbook.pinMismatch'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await requireJson<LogbookContext>(
        await scoringRequest(`${base}/authenticate`, {
          method: 'POST',
          headers,
          json: { participantId: person.id, pin, createPin: !person.hasPin },
        }),
      );
      setContext(result);
      setRounds(result.entry.rounds);
      setPin('');
      setConfirmation('');
      chooseRound(
        result.entry.rounds.findIndex((values) => values.includes(null)),
        result.entry.rounds,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logbook.saveError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function chooseRound(index: number, values = rounds) {
    const next = index < 0 ? 9 : index;
    setRound(next);
    const empty = values[next]?.findIndex((arrow) => arrow === null) ?? 0;
    setArrowIndex(empty < 0 ? 2 : empty);
  }
  async function save() {
    if (!context || busyRef.current) return;
    const finish = canFinish;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const entry = await requireJson<LogbookContext['entry']>(
        await scoringRequest(`${base}/entry`, {
          method: 'PUT',
          headers,
          json: { entryId: context.entry.id, rounds, expectedVersion: context.entry.version, finish },
        }),
      );
      setContext({ ...context, entry });
      if (finish) setNotice(t('logbook.finished'));
      if (!finish) chooseRound(rounds.findIndex((values) => values.includes(null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logbook.saveError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function restart() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await requireJson<LogbookContext>(
        await scoringRequest(`${base}/restart`, { method: 'POST', headers }),
      );
      setContext(next);
      setRounds(next.entry.rounds);
      chooseRound(0, next.entry.rounds);
      setNotice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logbook.saveError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function exit() {
    if (busyRef.current || !window.confirm(t(dirty ? 'logbook.discard' : 'logbook.confirmExit'))) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await requireJson(await scoringRequest(`${base}/logout`, { method: 'POST', headers }));
      setRestored(null);
      writeLogbookDraft(null);
      setContext(null);
      setPerson(null);
      setConfirmingPin(false);
      setQuery('');
      setPin('');
      setConfirmation('');
      setRounds([]);
      setRound(0);
      setArrowIndex(0);
      setError('');
      setNotice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logbook.saveError'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const complete = rounds.length === 10 && rounds.every((values) => values.every((arrow) => arrow !== null));
  const canFinish = complete && !dirty && context?.entry.completedAt === null;
  if (guest) return <GuestLogbookEntry onExit={() => setGuest(false)} />;
  return (
    <main className="scoring-page">
      <section className="panel">
        {(context || !person) && (
          <div className="logbook-entry-header">
            <h1>{t('logbook.title')}</h1>
            {context && (
              <button
                type="button"
                className="danger logbook-exit"
                aria-label={t('logbook.exit')}
                title={t('logbook.exit')}
                disabled={busy}
                onClick={() => void exit()}
              >
                <Icon name="exit" />
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {message(error)}
          </p>
        )}
        {notice && <p role="status">{message(notice)}</p>}
        {!context ? (
          <>
            {!person && <p>{t('logbook.intro')}</p>}
            {!person ? (
              <>
                <label htmlFor="logbook-search">{t('logbook.findName')}</label>
                <div className="participant-combobox">
                  <input
                    id="logbook-search"
                    role="combobox"
                    aria-autocomplete="list"
                    autoComplete="off"
                    aria-expanded={people.length > 0}
                    aria-controls={people.length ? 'logbook-suggestions' : undefined}
                    aria-activedescendant={people.length ? `logbook-option-${activeSuggestion}` : undefined}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setQuery('');
                      if (!people.length) return;
                      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                        event.preventDefault();
                        setActiveSuggestion(
                          (current) => (current + (event.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length,
                        );
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        setPerson(people[activeSuggestion]!);
                        setError('');
                      }
                    }}
                    value={query}
                    maxLength={200}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {loading ? (
                    <p role="status">{t('logbook.loading')}</p>
                  ) : (
                    <>
                      {query.trim() && (
                        <ul
                          className="participant-suggestions"
                          id="logbook-suggestions"
                          role="listbox"
                          aria-label={t('CompetitionParticipants.participant_suggestions')}
                        >
                          {people.map((p, index) => (
                            <li key={p.id} role="presentation">
                              <button
                                type="button"
                                role="option"
                                id={`logbook-option-${index}`}
                                aria-selected={activeSuggestion === index}
                                onClick={() => {
                                  setPerson(p);
                                  setError('');
                                }}
                              >
                                {p.name} <span className="muted">({p.clubName})</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="muted">
                        {t(
                          !query.trim()
                            ? 'logbook.searchHelp'
                            : people.length
                              ? 'logbook.selectName'
                              : 'logbook.noPeople',
                        )}
                      </p>
                    </>
                  )}
                </div>
                {error && <button onClick={() => setRetry((value) => value + 1)}>{t('ScoringPage.retry')}</button>}
                <button type="button" className="secondary" onClick={() => setGuest(true)}>
                  {t('logbook.guest')}
                </button>
                <p className="muted">{t('logbook.guestHelp')}</p>
              </>
            ) : (
              <form
                className="logbook-pin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void authenticate();
                }}
              >
                <h2>{person.name}</h2>
                <p aria-live="polite">
                  {t(person.hasPin ? 'logbook.enterPin' : confirmingPin ? 'logbook.repeatPin' : 'logbook.createPin')}
                </p>
                <SecurityCodeEntry
                  key={confirmingPin ? 'confirmation' : 'pin'}
                  pin={confirmingPin ? confirmation : pin}
                  confirming={confirmingPin}
                  disabled={busy}
                  onPinChange={confirmingPin ? setConfirmation : setPin}
                />
                <button disabled={busy}>
                  {t(!person.hasPin && !confirmingPin ? 'logbook.nextPin' : 'logbook.continue')}
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <h2>{context.participant.name}</h2>
            {context.entry.completedAt !== null ? (
              <>
                <p>
                  {t('logbook.result', {
                    total: context.entry.total ?? 0,
                    date: new Date(context.entry.completedAt).toLocaleString(),
                  })}
                </p>
                <button disabled={busy} onClick={() => void restart()}>
                  {t('logbook.newEntry')}
                </button>
              </>
            ) : (
              <div className="score-entry" aria-busy={busy}>
                <p>{t('scoring.roundProgress', { round: round + 1, rounds: 10, arrows: 3 })}</p>
                <ScoreKeypad
                  arrows={rounds[round]!}
                  arrowIndex={arrowIndex}
                  setArrowIndex={setArrowIndex}
                  disabled={busy}
                  onChange={(arrows) => {
                    setRounds(rounds.map((values, index) => (index === round ? arrows : values)));
                    setNotice('');
                  }}
                />
                <button
                  className="scoring-save"
                  disabled={busy || (!complete && rounds[round]!.some((arrow) => arrow === null))}
                  onClick={() => void save()}
                >
                  {t(canFinish ? 'logbook.finish' : 'ScoringPage.save')}
                </button>
              </div>
            )}
            <ScoreSheet
              rounds={rounds.map((arrows, index) => ({ roundNumber: index + 1, arrows, total: total(arrows) }))}
              numberOfRounds={10}
              arrowsPerRound={3}
              currentRoundNumber={10}
              selectedRound={round + 1}
              disabled={busy || context.entry.completedAt !== null}
              onSelectRound={(number) => chooseRound(number - 1)}
            />
            {context.history.length > 0 && <LogbookHistory entries={context.history} />}
          </>
        )}
      </section>
      <footer className="scoring-footer">
        <LanguageSelect flags />
      </footer>
    </main>
  );
}
