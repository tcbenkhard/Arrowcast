import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useModal } from '../../hooks/useModal';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { BowTypeField } from './BowTypeField';

export interface Participant { id: string; name: string; federationNumber: string; clubNumber: string; clubName: string; bowType?: string | null; targetType?: string | null; checkedIn?: boolean; laneId?: string | null; targetLetter?: string | null }
interface AuthProps { token: string; onUnauthorized: (message: string) => void }
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function CompetitionParticipants({ competitionId, token, onUnauthorized, onChange, status, lanes, defaultTargetType = null }: AuthProps & { competitionId: string; defaultTargetType?: string | null; status: string; lanes: { laneId: string; number: number }[]; onChange: (people: Participant[] | null) => void }) {
  const checkingIn = status === 'Check-in';
  const [expanded, setExpanded] = useState(status !== 'Active');
  useEffect(() => { setExpanded(status !== 'Active'); }, [status]);
  const canRemove = status === 'Scheduled';
  const canAdd = status === 'Scheduled';
  const canSelect = status === 'Scheduled';
  const [people, setPeople] = useState<Participant[]>([]);
  const [participantFilter, setParticipantFilter] = useState('');
  const filterTerms = checkingIn ? participantFilter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const visiblePeople = people.filter((person) => {
    const searchable = `${person.name} ${person.federationNumber} ${person.clubNumber} ${person.clubName}`.toLocaleLowerCase();
    return filterTerms.every((term) => searchable.includes(term));
  });
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importInProgress = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const busy = removing || updatingTarget || assignmentBusy || importing;
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const url = `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/participants`;
  async function importFile(file: File) {
    if (!canAdd || busy || importInProgress.current) return;
    setImportError(''); setNotice('');
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) {
      setImportError(t("CompetitionParticipants.kies_een_xlsxbestand_van_maximaal_5_mb")); return;
    }
    importInProgress.current = true; setImporting(true);
    try {
      const response = await managementRequest(`${url}/import`, token, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: file,
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      const result = await response.json() as { imported: number; created: number; message?: string };
      if (!response.ok) throw new Error(result.message ?? t("CompetitionParticipants.importeren_is_mislukt_probeer_het_opnieuw"));
      setNotice(t("CompetitionParticipants.deelnemers_gemporteerd_nieuwe_schutters_aangemaakt", { p0: result.imported, p1: result.created }));
      setRetry((value) => value + 1);
    } catch (error) { setImportError(error instanceof Error ? error.message : t("CompetitionParticipants.importeren_is_mislukt_controleer_de_deelnemerslijst_voordat_je_het")); }
    finally { importInProgress.current = false; setImporting(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const options = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' as const, signal: controller.signal };
        const [response, targetsResponse] = await Promise.all([
          managementRequest(url, token, options),
          managementRequest('/api/v1/admin/target-types', token, options),
        ]);
        if (response.status === 401 || targetsResponse.status === 401) { onUnauthorized(t(expiredMessage)); return; }
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
        if (!controller.signal.aborted) setError(t("CompetitionParticipants.could_not_load_participants_please_try_again"));
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
    const description = ids.length === 1 ? t("CompetitionParticipants.de_geselecteerde_deelnemer") : t("CompetitionParticipants.geselecteerde_deelnemers", { p0: ids.length });
    if (!window.confirm(t("CompetitionParticipants.wil_je_uitschrijven_voor_deze_wedstrijdde_deelnemers_blijven_in", { p0: description }))) return;
    removalInProgress.current = true;
    setRemoving(true); setRemoveError(''); setNotice('');
    try {
      const response = await managementRequest(url, token, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids }),
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      if (!response.ok) throw new Error();
      const removed = new Set(ids);
      setPeople((current) => current.filter((person) => !removed.has(person.id)));
      setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
      setNotice(t("CompetitionParticipants.deelnemer_uitgeschreven", { p0: ids.length, p1: ids.length === 1 ? '' : 's' }));
    } catch { setRemoveError(t("CompetitionParticipants.uitschrijven_is_niet_gelukt_de_selectie_is_bewaard_probeer")); }
    finally { removalInProgress.current = false; setRemoving(false); }
  }
  async function updateSelectedTarget(targetType: string) {
    if (targetUpdateInProgress.current || removalInProgress.current || !selectedIds.size) return;
    const ids = [...selectedIds];
    targetUpdateInProgress.current = true;
    setUpdatingTarget(true); setTargetError(''); setNotice('');
    try {
      const response = await managementRequest(url, token, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids, targetType }),
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      if (!response.ok) throw new Error();
      const result = await response.json() as { updatedParticipantIds: string[]; targetType: string | null };
      const updated = new Set(result.updatedParticipantIds);
      setPeople((current) => current.map((person) => updated.has(person.id) ? { ...person, targetType: result.targetType } : person));
      setNotice(t("CompetitionParticipants.target_bijgewerkt_voor_deelnemer", { p0: updated.size, p1: updated.size === 1 ? '' : 's' }));
    } catch { setTargetError(t("CompetitionParticipants.target_opslaan_is_niet_gelukt_de_selectie_is_bewaard")); }
    finally { targetUpdateInProgress.current = false; setUpdatingTarget(false); }
  }
  async function updateAssignment(person?: Participant) {
    if (assignmentInProgress.current || busy) return;
    if (!person && !window.confirm(t("CompetitionParticipants.this_will_overwrite_all_existing_assignments_for_checkedin_participants"))) return;
    assignmentInProgress.current = true; setAssignmentBusy(true); setAssignmentError(''); setNotice('');
    try {
      const endpoint = person ? `${url}/${encodeURIComponent(person.id)}/check-in`
        : `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/assignments/reassign`;
      const response = await managementRequest(endpoint, token, {
        method: person ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(person ? { checkedIn: !person.checkedIn } : {}),
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message ?? t("CompetitionParticipants.could_not_save_shooting_assignments"));
      }
      if (person) setPeople((current) => current.map((p) => p.id === person.id ? { ...p, checkedIn: !person.checkedIn } : p));
      else { setRetry((value) => value + 1); setNotice(t("CompetitionParticipants.shooting_assignments_updated_for_checkedin_participants")); }
    } catch (error) { setAssignmentError(error instanceof Error ? error.message : t("CompetitionParticipants.could_not_save_shooting_assignments")); }
    finally { assignmentInProgress.current = false; setAssignmentBusy(false); }
  }
  return <section className="panel collapsible-panel" aria-labelledby="competition-participants-title">
    <div className="section-header collapsible-panel-header">
      <h3 id="competition-participants-title">{t("CompetitionParticipants.participants")}</h3>
      <div className="competition-participants-actions">
      {canAdd && <><input ref={importInput} type="file" hidden accept=".xlsx" aria-label={t("CompetitionParticipants.import_participants_xlsx")}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} />
        <button type="button" hidden={!expanded} disabled={loading || !!error || busy || open}
          onClick={() => importInput.current?.click()}>{t("CompetitionParticipants.import")}</button></>}
      {status === 'Check-in' && <button type="button" hidden={!expanded}
        disabled={loading || !!error || busy || !people.some((p) => p.checkedIn)}
        onClick={() => { void updateAssignment(); }}>{t("CompetitionParticipants.reassign_checkedin_participants")}</button>}
      {canAdd && <button ref={addButton} hidden={!expanded} disabled={loading || !!error || busy} onClick={() => setOpen(true)}>{t("CompetitionParticipants.add_participant")}</button>}
      <button type="button" className="panel-toggle" aria-label={t('participants.toggle', { action: expanded ? t('CompetitionDetailPage.collapse') : t('CompetitionDetailPage.expand') })}
        aria-expanded={expanded} aria-controls="competition-participants-content" onClick={() => setExpanded((value) => !value)}>
        <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      </div>
    </div>
    <div id="competition-participants-content" className="collapsible-panel-content" hidden={!expanded}>
    {importing && <p role="status">{t("CompetitionParticipants.deelnemers_importeren")}</p>}
    {importError && <p className="error" role="alert">{message(importError)}</p>}
    {loading ? <p role="status">{t("CompetitionParticipants.loading_participants")}</p> : error ? <>
      <p className="error" role="alert">{message(error)}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button>
    </> : <>
      {assignmentError && <p className="error" role="alert">{message(assignmentError)}</p>}
      {canSelect && selectedIds.size > 0 && <div className="lane-bulk-controls" role="group" aria-label={t("CompetitionParticipants.doe_met_selectie")}>
        <p>{t('selection.count', { count: selectedIds.size })}</p>
        <select aria-label={t("CompetitionParticipants.target_for_selected_participants")} value="" disabled={busy}
          onChange={(event) => { void updateSelectedTarget(JSON.parse(event.target.value) as string); }}>
          <option value="" disabled>{t("CompetitionParticipants.target")}</option>
          {targetTypes.map((type) => <option key={type} value={JSON.stringify(type)}>{type}</option>)}
        </select>
        {canRemove && <button type="button" disabled={busy} onClick={() => { void unregisterSelected(); }}>{t("CompetitionParticipants.uitschrijven")}</button>}
      </div>}
      {updatingTarget && <p role="status">{t("CompetitionParticipants.target_opslaan")}</p>}
      {targetError && <p className="error" role="alert">{message(targetError)}</p>}
      {removing && <p role="status">{t("CompetitionParticipants.deelnemers_uitschrijven")}</p>}
      {notice && <p className="success" role="status">{message(notice)}</p>}
      {removeError && <div>
        <p className="error" role="alert">{message(removeError)}</p>
        <button className="secondary retry-button" disabled={!canRemove || busy || !selectedIds.size} onClick={() => { void unregisterSelected(); }}>{t("AdminPage.opnieuw_proberen")}</button>
      </div>}
      {checkingIn && <div className="participant-search-field participant-filter">
        <label htmlFor="check-in-participant-filter">{t("CompetitionParticipants.filter_participants")}</label>
        <input id="check-in-participant-filter" type="search" placeholder={t("CompetitionParticipants.name_federation_number_or_club")}
          value={participantFilter} onChange={(event) => setParticipantFilter(event.target.value)} />
      </div>}
      <div className="table-scroll"><table className="participants-table" aria-label={t("CompetitionParticipants.competition_participants")}>
      <thead><tr>{canSelect && <th scope="col"><label className="lane-selection">
        <input ref={selectAll} type="checkbox" aria-label={t('selection.allParticipants')} checked={allSelected} disabled={busy || !people.length}
          onChange={(event) => { setSelectedIds(event.target.checked ? new Set(people.map((person) => person.id)) : new Set()); setRemoveError(''); setTargetError(''); setNotice(''); }} />
      </label></th>}{['#', t("CompetitionDetailPage.name"), t("CompetitionParticipants.club"), t("BowTypeField.bow_type"), t("CompetitionParticipants.target"), ...(checkingIn ? [t("CompetitionParticipants.assignment"), t("CompetitionParticipants.checkin")] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{visiblePeople.length ? visiblePeople.map((person) => <tr key={person.id} className={canSelect && selectedIds.has(person.id) ? 'lane-selected' : undefined}>
        {canSelect && <td><input type="checkbox" className="lane-select-checkbox" aria-label={t("CompetitionParticipants.select_participant", { p0: person.name, p1: person.federationNumber })}
          checked={selectedIds.has(person.id)} disabled={busy} onChange={(event) => selectPerson(person.id, event.target.checked)} /></td>}
        <td>{person.federationNumber}</td><th scope="row">{person.name}</th><td>[{person.clubNumber}] {person.clubName}</td><td>{person.bowType ?? '—'}</td><td>{person.targetType ?? '\u2014'}</td>
        {checkingIn && <><td>{person.laneId && person.targetLetter ? t("CompetitionParticipants.lane", { p0: lanes.find((l) => l.laneId === person.laneId)?.number ?? '?', p1: person.targetLetter }) : '\u2014'}</td>
        <td><input type="checkbox" aria-label={t("CompetitionParticipants.check_in", { p0: person.name, p1: person.federationNumber })} checked={person.checkedIn ?? false}
          disabled={busy} onChange={() => { void updateAssignment(person); }} /></td></>}
      </tr>) : <tr><td colSpan={6 + (canSelect ? 1 : 0) + (checkingIn ? 2 : 0)}>{people.length ? t("CompetitionParticipants.no_matching_participants") : t("CompetitionParticipants.no_participants_yet")}</td></tr>}</tbody>
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
        const responses = await Promise.all(['/api/v1/admin/bow-types', '/api/v1/admin/target-types'].map((endpoint) => managementRequest(endpoint, token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })));
        if (responses.some((response) => response.status === 401)) { onUnauthorized(t(expiredMessage)); return; }
        if (responses.some((response) => !response.ok)) throw new Error();
        const [bows, targets] = await Promise.all(responses.map((response) => response.json() as Promise<string[]>));
        if (!controller.signal.aborted) { setBowTypes(bows!); setTargetTypes(targets!); }
      } catch { if (!controller.signal.aborted) setBowsError(t("CompetitionParticipants.could_not_load_bow_and_target_types_please_try")); }
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
          const response = await managementRequest(`/api/v1/admin/participants?q=${encodeURIComponent(query.trim())}`, token, {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
          });
          if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
          if (!response.ok) throw new Error();
          const result = await response.json() as Participant[];
          if (!controller.signal.aborted) {
            setResults(result);
            setActive(result.length ? 1 : 0);
          }
        } catch { if (!controller.signal.aborted) setSearchError(t("CompetitionParticipants.could_not_search_participants_please_try_again")); }
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
        const response = await managementRequest('/api/v1/admin/clubs', token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
        if (!response.ok) throw new Error();
        const result = await response.json() as typeof clubs;
        if (!controller.signal.aborted) setClubs(result);
      } catch { if (!controller.signal.aborted) setClubsError(t("CompetitionParticipants.could_not_load_clubs_please_try_again")); }
      finally { if (!controller.signal.aborted) setClubsLoading(false); }
    })();
    return () => controller.abort();
  }, [creating, token, onUnauthorized, retry]);

  async function save(body: { participantId: string } | { name: string; federationNumber: string; clubNumber: string }) {
    if (saving.current) return;
    if (!bowTypes.includes(bowType)) { setError(t('participants.selectBow')); return; }
    if (!targetTypes.includes(targetType)) { setError(t('participants.selectTarget')); return; }
    saving.current = true; setPending(true); setError(''); setNotice('');
    try {
      const response = await managementRequest(url, token, { method: 'POST', json: { ...body, bowType, targetType } });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        setError(response.status === 409 || response.status === 400 ? result.message ?? t("CompetitionParticipants.check_the_participant_details") : t("CompetitionParticipants.could_not_add_participant_please_try_again"));
        return;
      }
      const person = await response.json() as Participant;
      onAdded(person);
      setQuery(''); setResults([]); setActive(0); setSearchError('');
      setSelected(null); setBowType(''); setTargetType(defaultTargetType ?? '');
      setCreating(false); setName(''); setFederationNumber(''); setClubNumber('');
      setNotice(t('CompetitionParticipants.participant_added', { name: person.name }));
      setFocusVersion((value) => value + 1);
    } catch { setError(t("CompetitionParticipants.could_not_reach_the_server_your_input_has_been")); }
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
  const bowField = <BowTypeField types={bowTypes} value={bowType} disabled={pending || bowsLoading || !!bowsError}
    onChange={(value) => { setBowType(value); setError(''); }}
    />;
  const targetField = <div className="participant-search-field">
    <label htmlFor="participant-target-type">{t("CompetitionParticipants.target")}</label>
    <select id="participant-target-type" required value={targetType} disabled={pending || bowsLoading || !!bowsError}
      onChange={(event) => { setTargetType(event.target.value); setError(''); }}>
      <option value="" disabled>{t("CompetitionParticipants.select_a_target")}</option>
      {targetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
  </div>;
  return <dialog ref={dialog} className="range-modal participant-modal" aria-labelledby="add-participant-title">
    <h2 id="add-participant-title">{t("CompetitionParticipants.add_participant")}</h2>
    {bowsLoading && <p role="status">{t("CompetitionParticipants.loading_bow_types")}</p>}
    {bowsError && <><p className="error" role="alert">{message(bowsError)}</p>
      <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button></>}
    {!creating ? <div className="participant-search">
      <div className="participant-entry-fields">
      <div className="participant-search-field">
      <label htmlFor="participant-search">{t("CompetitionParticipants.search_by_name_or_federation_number")}</label>
      <input ref={searchInput} id="participant-search" role="combobox" aria-autocomplete="list" aria-expanded={hasQuery && !selected}
        aria-controls={hasQuery && !selected ? 'participant-suggestions' : undefined} aria-activedescendant={hasQuery && !selected ? `participant-option-${active}` : undefined}
        autoComplete="off" autoFocus maxLength={200} value={query} disabled={pending} onKeyDown={navigate}
        onChange={(event) => { setQuery(event.target.value); setSelected(null); setResults([]); setActive(0); setError(''); }} />
      {hasQuery && !selected ? <ul ref={suggestions} id="participant-suggestions" role="listbox" aria-label={t("CompetitionParticipants.participant_suggestions")} className="participant-suggestions" aria-busy={searching}>
        <li role="presentation"><button type="button" id="participant-option-0" role="option" aria-selected={active === 0}
          tabIndex={-1} disabled={pending} onClick={() => choose(0)}>{t("CompetitionParticipants.new_participant")}</button></li>
        {results.map((person, index) => <li role="presentation" key={person.id}>
          <button type="button" id={`participant-option-${index + 1}`} role="option" aria-selected={active === index + 1}
            tabIndex={-1} disabled={pending} onClick={() => choose(index + 1)}>
            {person.name} · {person.federationNumber}<small>{person.clubName} ({person.clubNumber})</small>
          </button>
        </li>)}
      </ul> : !selected && <p className="muted participant-search-hint">{t("CompetitionParticipants.type_a_name_or_federation_number_to_find_or")}</p>}
      </div>
      {bowField}
      {targetField}
      </div>
      {searching && <p role="status">{t("CompetitionParticipants.searching")}</p>}
      {!searching && query.trim() && !selected && !results.length && !searchError && <p>{t("CompetitionParticipants.no_matching_participants")}</p>}
      {searchError && <><p className="error" role="alert">{message(searchError)}</p>
        <button className="secondary" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button></>}
      {error && <p className="error" role="alert">{message(error)}</p>}
      {notice && <p className="success" role="status">{message(notice)}</p>}
      {pending && <p role="status">{t("CompetitionParticipants.adding_participant")}</p>}
      <div className="modal-actions"><button className="secondary" disabled={pending} onClick={onClose}>{t("PasswordChangeForm.cancel")}</button>
        <button disabled={pending || !selected || !bowType || !targetType || bowsLoading || !!bowsError}
          onClick={() => { if (selected) void save({ participantId: selected.id }); }}>{t("CompetitionParticipants.add_participant")}</button>
      </div>
    </div> : <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending}>
        <legend>{t("CompetitionParticipants.new_participant")}</legend>
        <label htmlFor="participant-name">{t("CompetitionParticipants.full_name")}</label>
        <input id="participant-name" autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="participant-number">{t("CompetitionParticipants.federation_number")}</label>
        <input id="participant-number" required maxLength={200} value={federationNumber} onChange={(event) => setFederationNumber(event.target.value)} />
        <label htmlFor="participant-club">{t("CompetitionParticipants.club")}</label>
        <select id="participant-club" required value={clubNumber} disabled={clubsLoading || !!clubsError} onChange={(event) => setClubNumber(event.target.value)}>
          <option value="">{t("CompetitionParticipants.select_a_club")}</option>
          {clubs.map((club) => <option key={club.clubNumber} value={club.clubNumber}>{club.name} ({club.clubNumber})</option>)}
        </select>
        {bowField}
        {targetField}
      </fieldset>
      {clubsLoading && <p role="status">{t("CompetitionParticipants.loading_clubs")}</p>}
      {clubsError && <><p className="error" role="alert">{message(clubsError)}</p>
        <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button></>}
      {!clubsLoading && !clubsError && !clubs.length && <p>{t("CompetitionParticipants.no_clubs_available_import_clubs_from_settings_first")}</p>}
      {error && <p className="error" role="alert">{message(error)}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={pending} onClick={() => { setCreating(false); setError(''); }}>{t("CompetitionParticipants.back")}</button>
        <button type="button" className="secondary" disabled={pending} onClick={onClose}>{t("PasswordChangeForm.cancel")}</button>
        <button type="submit" disabled={pending || clubsLoading || !!clubsError || !clubs.length || !bowType || !targetType || bowsLoading || !!bowsError}>{pending ? t("CompetitionParticipants.adding") : t("CompetitionParticipants.add_participant")}</button>
      </div>
    </form>}
  </dialog>;
}
