import { useModal } from '../../hooks/useModal';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { BowTypeField } from './BowTypeField';

export interface Participant { id: string; name: string; federationNumber: string; clubNumber: string; clubName: string; bowType?: string | null; targetType?: string | null; checkedIn?: boolean; laneId?: string | null; targetLetter?: string | null }
interface AuthProps { token: string; onUnauthorized: (message: string) => void }
const expiredMessage = 'Je sessie is verlopen of ongeldig. Log opnieuw in.';

export function CompetitionParticipants({ competitionId, token, onUnauthorized, onChange, status, lanes, defaultTargetType = null }: AuthProps & { competitionId: string; defaultTargetType?: string | null; status: string; lanes: { laneId: string; number: number }[]; onChange: (people: Participant[] | null) => void }) {
  const checkingIn = status === 'Check-in';
  const [expanded, setExpanded] = useState(status !== 'Active');
  useEffect(() => { setExpanded(status !== 'Active'); }, [status]);
  const canRemove = status === 'Scheduled';
  const canAdd = status === 'Scheduled';
  const canSelect = status === 'Scheduled';
  const [people, setPeople] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectAll = useRef<HTMLInputElement>(null);
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [updatingTarget, setUpdatingTarget] = useState(false);
  const targetUpdateInProgress = useRef(false);
  const [targetError, setTargetError] = useState('');
  const [removing, setRemoving] = useState(false);
  const removalInProgress = useRef(false);
  const [removeError, setRemoveError] = useState('');
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const assignmentInProgress = useRef(false);
  const [assignmentError, setAssignmentError] = useState('');
  const busy = removing || updatingTarget || assignmentBusy;
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const url = `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/participants`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const options = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' as const, signal: controller.signal };
        const [response, targetsResponse] = await Promise.all([fetch(url, options), fetch('/api/v1/admin/target-types', options)]);
        if (response.status === 401 || targetsResponse.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok || !targetsResponse.ok) throw new Error();
        const result = await response.json() as Participant[];
        const types = await targetsResponse.json() as string[];
        if (!controller.signal.aborted) {
          setPeople(result);
          setTargetTypes(types);
          const available = new Set(result.map((person) => person.id));
          setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))));
        }
      } catch {
        if (!controller.signal.aborted) setError('Could not load participants. Please try again.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [url, token, onUnauthorized, retry]);
  useEffect(() => { onChange(loading || error ? null : people); }, [people, loading, error, onChange]);
  const close = () => { setOpen(false); };
  useEffect(() => {
    if (wasOpen.current && !open) addButton.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const allSelected = people.length > 0 && selectedIds.size === people.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedIds.size > 0 && !allSelected;
  }, [selectedIds, allSelected, loading, error, canSelect]);
  function selectPerson(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
    setRemoveError(''); setTargetError(''); setNotice('');
  }
  async function unregisterSelected() {
    if (!canRemove || removalInProgress.current || targetUpdateInProgress.current || !selectedIds.size) return;
    const ids = [...selectedIds];
    const description = ids.length === 1 ? 'de geselecteerde deelnemer' : `${ids.length} geselecteerde deelnemers`;
    if (!window.confirm(`Wil je ${description} uitschrijven voor deze wedstrijd?\n\nDe deelnemers blijven in de database staan.`)) return;
    removalInProgress.current = true;
    setRemoving(true); setRemoveError(''); setNotice('');
    try {
      const response = await fetch(url, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) throw new Error();
      const removed = new Set(ids);
      setPeople((current) => current.filter((person) => !removed.has(person.id)));
      setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
      setNotice(`${ids.length} deelnemer${ids.length === 1 ? '' : 's'} uitgeschreven.`);
    } catch { setRemoveError('Uitschrijven is niet gelukt. De selectie is bewaard. Probeer het opnieuw.'); }
    finally { removalInProgress.current = false; setRemoving(false); }
  }
  async function updateSelectedTarget(targetType: string) {
    if (targetUpdateInProgress.current || removalInProgress.current || !selectedIds.size) return;
    const ids = [...selectedIds];
    targetUpdateInProgress.current = true;
    setUpdatingTarget(true); setTargetError(''); setNotice('');
    try {
      const response = await fetch(url, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids, targetType }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) throw new Error();
      const result = await response.json() as { updatedParticipantIds: string[]; targetType: string | null };
      const updated = new Set(result.updatedParticipantIds);
      setPeople((current) => current.map((person) => updated.has(person.id) ? { ...person, targetType: result.targetType } : person));
      setNotice(`Target bijgewerkt voor ${updated.size} deelnemer${updated.size === 1 ? '' : 's'}.`);
    } catch { setTargetError('Target opslaan is niet gelukt. De selectie is bewaard. Kies het target opnieuw om het nogmaals te proberen.'); }
    finally { targetUpdateInProgress.current = false; setUpdatingTarget(false); }
  }
  async function updateAssignment(person?: Participant) {
    if (assignmentInProgress.current || busy) return;
    if (!person && !window.confirm('This will overwrite all existing assignments for checked-in participants and release assignments for participants who have not checked in. Continue?')) return;
    assignmentInProgress.current = true; setAssignmentBusy(true); setAssignmentError(''); setNotice('');
    try {
      const endpoint = person ? `${url}/${encodeURIComponent(person.id)}/check-in`
        : `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/assignments/reassign`;
      const response = await fetch(endpoint, {
        method: person ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(person ? { checkedIn: !person.checkedIn } : {}),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message ?? 'Could not save shooting assignments.');
      }
      if (person) setPeople((current) => current.map((p) => p.id === person.id ? { ...p, checkedIn: !person.checkedIn } : p));
      else { setRetry((value) => value + 1); setNotice('Shooting assignments updated for checked-in participants.'); }
    } catch (error) { setAssignmentError(error instanceof Error ? error.message : 'Could not save shooting assignments.'); }
    finally { assignmentInProgress.current = false; setAssignmentBusy(false); }
  }
  return <section className="panel collapsible-panel" aria-labelledby="competition-participants-title">
    <div className="section-header collapsible-panel-header">
      <h3 id="competition-participants-title">Participants</h3>
      <div className="competition-participants-actions">
      {status === 'Check-in' && <button type="button" hidden={!expanded}
        disabled={loading || !!error || busy || !people.some((p) => p.checkedIn)}
        onClick={() => { void updateAssignment(); }}>Reassign checked-in participants</button>}
      {canAdd && <button ref={addButton} hidden={!expanded} disabled={loading || !!error || busy} onClick={() => setOpen(true)}>Add participant</button>}
      <button type="button" className="panel-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} participants`}
        aria-expanded={expanded} aria-controls="competition-participants-content" onClick={() => setExpanded((value) => !value)}>
        <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      </div>
    </div>
    <div id="competition-participants-content" className="collapsible-panel-content" hidden={!expanded}>
    {loading ? <p role="status">Loading participants...</p> : error ? <>
      <p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </> : <>
      {assignmentError && <p className="error" role="alert">{assignmentError}</p>}
      {assignmentBusy && <p role="status">Saving shooting assignments...</p>}
      {canSelect && selectedIds.size > 0 && <div className="lane-bulk-controls" role="group" aria-label="Doe met selectie">
        <p>{selectedIds.size} geselecteerd</p>
        <select aria-label="Target for selected participants" value="" disabled={busy}
          onChange={(event) => { void updateSelectedTarget(JSON.parse(event.target.value) as string); }}>
          <option value="" disabled>Target</option>
          {targetTypes.map((type) => <option key={type} value={JSON.stringify(type)}>{type}</option>)}
        </select>
        {canRemove && <button type="button" disabled={busy} onClick={() => { void unregisterSelected(); }}>Uitschrijven</button>}
      </div>}
      {updatingTarget && <p role="status">Target opslaan...</p>}
      {targetError && <p className="error" role="alert">{targetError}</p>}
      {removing && <p role="status">Deelnemers uitschrijven...</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {removeError && <div>
        <p className="error" role="alert">{removeError}</p>
        <button className="secondary retry-button" disabled={!canRemove || busy || !selectedIds.size} onClick={() => { void unregisterSelected(); }}>Opnieuw proberen</button>
      </div>}
      <div className="table-scroll"><table className="participants-table" aria-label="Competition participants">
      <thead><tr>{canSelect && <th scope="col"><label className="lane-selection">
        <input ref={selectAll} type="checkbox" aria-label="Select all participants" checked={allSelected} disabled={busy || !people.length}
          onChange={(event) => { setSelectedIds(event.target.checked ? new Set(people.map((person) => person.id)) : new Set()); setRemoveError(''); setTargetError(''); setNotice(''); }} />
      </label></th>}{['#', 'Name', 'Club', 'Bow type', 'Target', ...(checkingIn ? ['Assignment', 'Check-in'] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{people.length ? people.map((person) => <tr key={person.id} className={canSelect && selectedIds.has(person.id) ? 'lane-selected' : undefined}>
        {canSelect && <td><input type="checkbox" className="lane-select-checkbox" aria-label={`Select participant ${person.name} (${person.federationNumber})`}
          checked={selectedIds.has(person.id)} disabled={busy} onChange={(event) => selectPerson(person.id, event.target.checked)} /></td>}
        <td>{person.federationNumber}</td><th scope="row">{person.name}</th><td>[{person.clubNumber}] {person.clubName}</td><td>{person.bowType ?? '—'}</td><td>{person.targetType ?? '\u2014'}</td>
        {checkingIn && <><td>{person.laneId && person.targetLetter ? `Lane ${lanes.find((l) => l.laneId === person.laneId)?.number ?? '?'} ${person.targetLetter}` : '\u2014'}</td>
        <td><input type="checkbox" aria-label={`Check in ${person.name} (${person.federationNumber})`} checked={person.checkedIn ?? false}
          disabled={busy} onChange={() => { void updateAssignment(person); }} /></td></>}
      </tr>) : <tr><td colSpan={5 + (canSelect ? 1 : 0) + (checkingIn ? 2 : 0)}>No participants yet.</td></tr>}</tbody>
    </table></div></>}
    </div>
    {canAdd && open && <ParticipantModal defaultTargetType={defaultTargetType} token={token} onUnauthorized={onUnauthorized} url={url} onClose={close} onAdded={(person) => {
      setPeople((current) => [...current.filter((p) => p.id !== person.id), person].sort((a, b) => a.name.localeCompare(b.name, 'nl')));
    }} />}
  </section>;
}

function ParticipantModal({ token, onUnauthorized, url, onClose, onAdded, defaultTargetType }: AuthProps & {
  defaultTargetType?: string | null;
  url: string; onClose: () => void; onAdded: (person: Participant) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const suggestions = useRef<HTMLUListElement>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Participant | null>(null);
  const [bowTypes, setBowTypes] = useState<string[]>([]);
  const [bowType, setBowType] = useState('');
  const [bowConfirmed, setBowConfirmed] = useState(false);
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
    suggestions.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, results]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [federationNumber, setFederationNumber] = useState('');
  const [clubNumber, setClubNumber] = useState('');
  const [clubs, setClubs] = useState<{ clubNumber: string; name: string }[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [clubsError, setClubsError] = useState('');
  const [pending, setPending] = useState(false);
  const dialog = useModal(onClose, pending);
  const saving = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBowsLoading(true); setBowsError('');
    void (async () => {
      try {
        const responses = await Promise.all(['/api/v1/admin/bow-types', '/api/v1/admin/target-types'].map((endpoint) => fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })));
        if (responses.some((response) => response.status === 401)) { onUnauthorized(expiredMessage); return; }
        if (responses.some((response) => !response.ok)) throw new Error();
        const [bows, targets] = await Promise.all(responses.map((response) => response.json() as Promise<string[]>));
        if (!controller.signal.aborted) { setBowTypes(bows!); setTargetTypes(targets!); }
      } catch { if (!controller.signal.aborted) setBowsError('Could not load bow and target types. Please try again.'); }
      finally { if (!controller.signal.aborted) setBowsLoading(false); }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);
  useEffect(() => {
    if (focusVersion > 0) searchInput.current?.focus();
  }, [focusVersion]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]); setActive(0); setSearchError('');
    if (!query.trim() || creating || selected) { setSearching(false); return () => controller.abort(); }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/v1/admin/participants?q=${encodeURIComponent(query.trim())}`, {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
          });
          if (response.status === 401) { onUnauthorized(expiredMessage); return; }
          if (!response.ok) throw new Error();
          const result = await response.json() as Participant[];
          if (!controller.signal.aborted) {
            setResults(result);
            setActive(result.length ? 1 : 0);
          }
        } catch { if (!controller.signal.aborted) setSearchError('Could not search participants. Please try again.'); }
        finally { if (!controller.signal.aborted) setSearching(false); }
      })();
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, token, onUnauthorized, creating, selected, retry]);
  useEffect(() => {
    if (!creating) return;
    const controller = new AbortController();
    setClubsLoading(true); setClubsError('');
    void (async () => {
      try {
        const response = await fetch('/api/v1/admin/clubs', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok) throw new Error();
        const result = await response.json() as typeof clubs;
        if (!controller.signal.aborted) setClubs(result);
      } catch { if (!controller.signal.aborted) setClubsError('Could not load clubs. Please try again.'); }
      finally { if (!controller.signal.aborted) setClubsLoading(false); }
    })();
    return () => controller.abort();
  }, [creating, token, onUnauthorized, retry]);

  async function save(body: { participantId: string } | { name: string; federationNumber: string; clubNumber: string }) {
    if (saving.current) return;
    if (!bowConfirmed || !bowTypes.includes(bowType)) { setError('Select and confirm a bow type.'); return; }
    if (!targetTypes.includes(targetType)) { setError('Select a target.'); return; }
    saving.current = true; setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, bowType, targetType }) });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        setError(response.status === 409 || response.status === 400 ? result.message ?? 'Check the participant details.' : 'Could not add participant. Please try again.');
        return;
      }
      const person = await response.json() as Participant;
      onAdded(person);
      setQuery(''); setResults([]); setActive(0); setSearchError('');
      setSelected(null); setBowType(''); setBowConfirmed(false); setTargetType(defaultTargetType ?? '');
      setCreating(false); setName(''); setFederationNumber(''); setClubNumber('');
      setNotice(`${person.name} added.`);
      setFocusVersion((value) => value + 1);
    } catch { setError('Could not reach the server. Your input has been kept. Check the participant list before retrying.'); }
    finally { saving.current = false; setPending(false); }
  }
  function choose(index: number) {
    if (pending || !hasQuery) return;
    if (index === 0) {
      setName(/^\d+$/.test(query.trim()) ? '' : query.trim());
      setFederationNumber(/^\d+$/.test(query.trim()) ? query.trim() : '');
      setCreating(true); setError('');
    } else if (results[index - 1]) {
      const person = results[index - 1]!;
      setSelected(person); setQuery(`${person.name} (${person.federationNumber})`); setResults([]); setError('');
      searchInput.current?.focus();
    }
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (!hasQuery || event.nativeEvent.isComposing || event.repeat || selected) return;
    if (event.key === 'Tab' && !event.shiftKey && !searching && active > 0) choose(active);
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (value + 1) % (results.length + 1)); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value + results.length) % (results.length + 1)); }
    if (event.key === 'Enter') { event.preventDefault(); if (!searching) choose(active); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save({ name: name.trim(), federationNumber: federationNumber.trim(), clubNumber });
  }
  const bowField = <BowTypeField types={bowTypes} value={bowType} confirmed={bowConfirmed} disabled={pending || bowsLoading || !!bowsError}
    onChange={(value) => { setBowType(value); setBowConfirmed(false); setError(''); }}
    onConfirm={(value) => { setBowType(value); setBowConfirmed(true); setError(''); }}
    />;
  const targetField = <div className="participant-search-field">
    <label htmlFor="participant-target-type">Target</label>
    <select id="participant-target-type" required value={targetType} disabled={pending || bowsLoading || !!bowsError}
      onChange={(event) => { setTargetType(event.target.value); setError(''); }}>
      <option value="" disabled>Select a target</option>
      {targetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
  </div>;
  return <dialog ref={dialog} className="range-modal participant-modal" aria-labelledby="add-participant-title">
    <h2 id="add-participant-title">Add participant</h2>
    {bowsLoading && <p role="status">Loading bow types...</p>}
    {bowsError && <><p className="error" role="alert">{bowsError}</p>
      <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></>}
    {!creating ? <div className="participant-search">
      <div className="participant-entry-fields">
      <div className="participant-search-field">
      <label htmlFor="participant-search">Search by name or federation number</label>
      <input ref={searchInput} id="participant-search" role="combobox" aria-autocomplete="list" aria-expanded={hasQuery && !selected}
        aria-controls={hasQuery && !selected ? 'participant-suggestions' : undefined} aria-activedescendant={hasQuery && !selected ? `participant-option-${active}` : undefined}
        autoComplete="off" autoFocus maxLength={200} value={query} disabled={pending} onKeyDown={navigate}
        onChange={(event) => { setQuery(event.target.value); setSelected(null); setResults([]); setActive(0); setError(''); }} />
      {hasQuery && !selected ? <ul ref={suggestions} id="participant-suggestions" role="listbox" aria-label="Participant suggestions" className="participant-suggestions" aria-busy={searching}>
        <li role="presentation"><button type="button" id="participant-option-0" role="option" aria-selected={active === 0}
          tabIndex={-1} disabled={pending} onClick={() => choose(0)}>New participant</button></li>
        {results.map((person, index) => <li role="presentation" key={person.id}>
          <button type="button" id={`participant-option-${index + 1}`} role="option" aria-selected={active === index + 1}
            tabIndex={-1} disabled={pending} onClick={() => choose(index + 1)}>
            {person.name} · {person.federationNumber}<small>{person.clubName} ({person.clubNumber})</small>
          </button>
        </li>)}
      </ul> : !selected && <p className="muted participant-search-hint">Type a name or federation number to find or create a participant.</p>}
      </div>
      {bowField}
      {targetField}
      </div>
      {searching && <p role="status">Searching...</p>}
      {!searching && query.trim() && !selected && !results.length && !searchError && <p>No matching participants.</p>}
      {searchError && <><p className="error" role="alert">{searchError}</p>
        <button className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {pending && <p role="status">Adding participant...</p>}
      <div className="modal-actions"><button className="secondary" disabled={pending} onClick={onClose}>Cancel</button>
        <button disabled={pending || !selected || !bowConfirmed || !targetType || bowsLoading || !!bowsError}
          onClick={() => { if (selected) void save({ participantId: selected.id }); }}>Add participant</button>
      </div>
    </div> : <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend>New participant</legend>
        <label htmlFor="participant-name">Full name</label>
        <input id="participant-name" autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="participant-number">Federation number</label>
        <input id="participant-number" required maxLength={200} value={federationNumber} onChange={(event) => setFederationNumber(event.target.value)} />
        <label htmlFor="participant-club">Club</label>
        <select id="participant-club" required value={clubNumber} disabled={clubsLoading || !!clubsError} onChange={(event) => setClubNumber(event.target.value)}>
          <option value="">Select a club</option>
          {clubs.map((club) => <option key={club.clubNumber} value={club.clubNumber}>{club.name} ({club.clubNumber})</option>)}
        </select>
        {bowField}
        {targetField}
      </fieldset>
      {clubsLoading && <p role="status">Loading clubs...</p>}
      {clubsError && <><p className="error" role="alert">{clubsError}</p>
        <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></>}
      {!clubsLoading && !clubsError && !clubs.length && <p>No clubs available. Import clubs from Settings first.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={pending} onClick={() => { setCreating(false); setError(''); }}>Back</button>
        <button type="button" className="secondary" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={pending || clubsLoading || !!clubsError || !clubs.length || !bowConfirmed || !targetType || bowsLoading || !!bowsError}>{pending ? 'Adding...' : 'Add participant'}</button>
      </div>
    </form>}
  </dialog>;
}
