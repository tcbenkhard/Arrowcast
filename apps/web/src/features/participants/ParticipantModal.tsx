import type { FormEvent, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { message, t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { BowTypeField } from './BowTypeField';
import { ClubField } from './ClubField';
import type { Participant } from './participant';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function ParticipantModal({
  token,
  onUnauthorized,
  url,
  onClose,
  onAdded,
  defaultTargetType,
}: AuthProps & {
  defaultTargetType?: string | null;
  url: string;
  onClose: () => void;
  onAdded: (person: Participant) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const suggestions = useRef<HTMLUListElement>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Participant | null>(null);
  const [bowTypes, setBowTypes] = useState<string[]>([]);
  const [bowType, setBowType] = useState('');
  const [bowsLoading, setBowsLoading] = useState(true);
  const [bowsError, setBowsError] = useState('');
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [targetType, setTargetType] = useState(defaultTargetType ?? '');
  const hasQuery = query.trim().length > 0;
  const [results, setResults] = useState<Participant[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  useEffect(() => {
    suggestions.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, results]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [federationNumber, setFederationNumber] = useState('');
  const [clubNumber, setClubNumber] = useState('');
  const [clubName, setClubName] = useState('');
  const [clubs, setClubs] = useState<{ clubNumber: string; name: string }[]>([]);
  const knownClub = clubs.find((club) => club.clubNumber === clubNumber.trim());
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubsError, setClubsError] = useState('');
  const [pending, setPending] = useState(false);
  const dialog = useModal(onClose, pending);
  const saving = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBowsLoading(true);
    setBowsError('');
    void (async () => {
      try {
        const responses = await Promise.all(
          ['/api/v1/admin/bow-types', '/api/v1/admin/target-types'].map((endpoint) =>
            managementRequest(endpoint, token, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
              signal: controller.signal,
            }),
          ),
        );
        if (responses.some((response) => response.status === 401)) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error();
        const [bows, targets] = await Promise.all(responses.map((response) => response.json() as Promise<string[]>));
        if (!controller.signal.aborted) {
          setBowTypes(bows!);
          setTargetTypes(targets!);
        }
      } catch {
        if (!controller.signal.aborted)
          setBowsError(t('CompetitionParticipants.could_not_load_bow_and_target_types_please_try'));
      } finally {
        if (!controller.signal.aborted) setBowsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);
  useEffect(() => {
    if (focusVersion > 0) searchInput.current?.focus();
  }, [focusVersion]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setActive(0);
    setSearchError('');
    if (!query.trim() || creating || selected) {
      setSearching(false);
      return () => controller.abort();
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await managementRequest(
            `/api/v1/admin/participants?q=${encodeURIComponent(query.trim())}`,
            token,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
              signal: controller.signal,
            },
          );
          if (response.status === 401) {
            onUnauthorized(t(expiredMessage));
            return;
          }
          if (!response.ok) throw new Error();
          const result = (await response.json()) as Participant[];
          if (!controller.signal.aborted) {
            setResults(result);
            setActive(result.length ? 1 : 0);
          }
        } catch {
          if (!controller.signal.aborted)
            setSearchError(t('CompetitionParticipants.could_not_search_participants_please_try_again'));
        } finally {
          if (!controller.signal.aborted) setSearching(false);
        }
      })();
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, token, onUnauthorized, creating, selected, retry]);
  useEffect(() => {
    if (!creating) return;
    const controller = new AbortController();
    setClubsLoading(true);
    setClubsError('');
    void (async () => {
      try {
        const response = await managementRequest('/api/v1/admin/clubs', token, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (!response.ok) throw new Error();
        const result = (await response.json()) as typeof clubs;
        if (!controller.signal.aborted) setClubs(result);
      } catch {
        if (!controller.signal.aborted)
          setClubsError(t('CompetitionParticipants.could_not_load_clubs_please_try_again'));
      } finally {
        if (!controller.signal.aborted) setClubsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [creating, token, onUnauthorized, retry]);

  async function save(
    body: { participantId: string } | { name: string; federationNumber: string; clubNumber: string; clubName: string },
  ) {
    if (saving.current) return;
    if (!bowTypes.includes(bowType)) {
      setError(t('participants.selectBow'));
      return;
    }
    if (!targetTypes.includes(targetType)) {
      setError(t('participants.selectTarget'));
      return;
    }
    saving.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await managementRequest(url, token, { method: 'POST', json: { ...body, bowType, targetType } });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        setError(
          response.status === 409 || response.status === 400
            ? (result.message ?? t('CompetitionParticipants.check_the_participant_details'))
            : t('CompetitionParticipants.could_not_add_participant_please_try_again'),
        );
        return;
      }
      const person = (await response.json()) as Participant;
      onAdded(person);
      setQuery('');
      setResults([]);
      setActive(0);
      setSearchError('');
      setSelected(null);
      setBowType('');
      setTargetType(defaultTargetType ?? '');
      setCreating(false);
      setName('');
      setFederationNumber('');
      setClubNumber('');
      setClubName('');
      setNotice(t('CompetitionParticipants.participant_added', { name: person.name }));
      setFocusVersion((value) => value + 1);
    } catch {
      setError(t('CompetitionParticipants.could_not_reach_the_server_your_input_has_been'));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  function choose(index: number) {
    if (pending || !hasQuery) return;
    if (index === 0) {
      setName(/^\d+$/.test(query.trim()) ? '' : query.trim());
      setFederationNumber(/^\d+$/.test(query.trim()) ? query.trim() : '');
      setCreating(true);
      setError('');
    } else if (results[index - 1]) {
      const person = results[index - 1]!;
      setSelected(person);
      setQuery(`${person.name} (${person.federationNumber})`);
      setResults([]);
      setError('');
      searchInput.current?.focus();
    }
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || event.nativeEvent.isComposing || event.repeat || selected) return;
    if (event.key === 'Tab' && !event.shiftKey && !searching && active > 0) choose(active);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (value + 1) % (results.length + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (value + results.length) % (results.length + 1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!searching) choose(active);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!clubNumber.trim()) {
      setError(t('participants.selectClub'));
      return;
    }
    void save({
      name: name.trim(),
      federationNumber: federationNumber.trim(),
      clubNumber: clubNumber.trim(),
      clubName: knownClub?.name ?? clubName.trim(),
    });
  }
  const bowField = (
    <BowTypeField
      types={bowTypes}
      value={bowType}
      disabled={pending || bowsLoading || !!bowsError}
      onChange={(value) => {
        setBowType(value);
        setError('');
      }}
    />
  );
  const targetField = (
    <div className="participant-search-field">
      <label htmlFor="participant-target-type">{t('CompetitionParticipants.target')}</label>
      <select
        id="participant-target-type"
        required
        value={targetType}
        disabled={pending || bowsLoading || !!bowsError}
        onChange={(event) => {
          setTargetType(event.target.value);
          setError('');
        }}
      >
        <option value="" disabled>
          {t('CompetitionParticipants.select_a_target')}
        </option>
        {targetTypes.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <dialog ref={dialog} className="range-modal participant-modal" aria-labelledby="add-participant-title">
      <h2 id="add-participant-title">{t('CompetitionParticipants.add_participant')}</h2>
      {bowsLoading && <p role="status">{t('CompetitionParticipants.loading_bow_types')}</p>}
      {bowsError && (
        <>
          <p className="error" role="alert">
            {message(bowsError)}
          </p>
          <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </>
      )}
      {!creating ? (
        <div className="participant-search">
          <div className="participant-entry-fields">
            <div className="participant-search-field">
              <label htmlFor="participant-search">
                {t('CompetitionParticipants.search_by_name_or_federation_number')}
              </label>
              <div className="participant-combobox">
                <input
                  ref={searchInput}
                  id="participant-search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={hasQuery && !selected}
                  aria-controls={hasQuery && !selected ? 'participant-suggestions' : undefined}
                  aria-activedescendant={hasQuery && !selected ? `participant-option-${active}` : undefined}
                  autoComplete="off"
                  autoFocus
                  maxLength={200}
                  value={query}
                  disabled={pending}
                  onKeyDown={navigate}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(null);
                    setResults([]);
                    setActive(0);
                    setError('');
                  }}
                />
                {hasQuery && !selected ? (
                  <ul
                    ref={suggestions}
                    id="participant-suggestions"
                    role="listbox"
                    aria-label={t('CompetitionParticipants.participant_suggestions')}
                    className="participant-suggestions"
                    aria-busy={searching}
                  >
                    <li role="presentation">
                      <button
                        type="button"
                        id="participant-option-0"
                        role="option"
                        aria-selected={active === 0}
                        tabIndex={-1}
                        disabled={pending}
                        onClick={() => choose(0)}
                      >
                        {t('CompetitionParticipants.new_participant')}
                      </button>
                    </li>
                    {results.map((person, index) => (
                      <li role="presentation" key={person.id}>
                        <button
                          type="button"
                          id={`participant-option-${index + 1}`}
                          role="option"
                          aria-selected={active === index + 1}
                          tabIndex={-1}
                          disabled={pending}
                          onClick={() => choose(index + 1)}
                        >
                          {person.name} · {person.federationNumber}
                          <small>
                            {person.clubName} ({person.clubNumber})
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <p
                className="muted participant-search-hint"
                style={{ visibility: !hasQuery && !selected ? 'visible' : 'hidden' }}
              >
                {t('CompetitionParticipants.type_a_name_or_federation_number_to_find_or')}
              </p>
            </div>
            {bowField}
            {targetField}
          </div>
          <div className="participant-search-feedback">
            {searching && <p role="status">{t('CompetitionParticipants.searching')}</p>}
            {!searching && query.trim() && !selected && !results.length && !searchError && (
              <p>{t('CompetitionParticipants.no_matching_participants')}</p>
            )}
          </div>
          {searchError && (
            <>
              <p className="error" role="alert">
                {message(searchError)}
              </p>
              <button className="secondary" onClick={() => setRetry((value) => value + 1)}>
                {t('CompetitionDetailPage.try_again')}
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {message(error)}
            </p>
          )}
          {notice && (
            <p className="success" role="status">
              {message(notice)}
            </p>
          )}
          {pending && <p role="status">{t('CompetitionParticipants.adding_participant')}</p>}
          <div className="modal-actions">
            <button className="secondary" disabled={pending} onClick={onClose}>
              {t('PasswordChangeForm.cancel')}
            </button>
            <button
              disabled={pending || !selected || !bowType || !targetType || bowsLoading || !!bowsError}
              onClick={() => {
                if (selected) void save({ participantId: selected.id });
              }}
            >
              {t('CompetitionParticipants.add_participant')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={pending}>
          <fieldset disabled={pending}>
            <legend>{t('CompetitionParticipants.new_participant')}</legend>
            <label htmlFor="participant-name">{t('CompetitionParticipants.full_name')}</label>
            <input
              id="participant-name"
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor="participant-number">{t('CompetitionParticipants.federation_number')}</label>
            <input
              id="participant-number"
              required
              maxLength={200}
              value={federationNumber}
              onChange={(event) => setFederationNumber(event.target.value)}
            />
            <ClubField
              clubs={clubs}
              clubNumber={clubNumber}
              clubName={clubName}
              onChange={(number, name) => {
                setClubNumber(number);
                setClubName(name);
                setError('');
              }}
            />
            {bowField}
            {targetField}
          </fieldset>
          {clubsLoading && <p role="status">{t('CompetitionParticipants.loading_clubs')}</p>}
          {clubsError && (
            <>
              <p className="error" role="alert">
                {message(clubsError)}
              </p>
              <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>
                {t('CompetitionDetailPage.try_again')}
              </button>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {message(error)}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => {
                setCreating(false);
                setError('');
              }}
            >
              {t('CompetitionParticipants.back')}
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={onClose}>
              {t('PasswordChangeForm.cancel')}
            </button>
            <button type="submit" disabled={pending || !bowType || !targetType || bowsLoading || !!bowsError}>
              {pending ? t('CompetitionParticipants.adding') : t('CompetitionParticipants.add_participant')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
