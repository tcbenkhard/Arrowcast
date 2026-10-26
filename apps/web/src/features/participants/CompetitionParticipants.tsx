import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { message, t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { ParticipantModal } from './ParticipantModal';
import type { Participant } from './participant';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function CompetitionParticipants({
  competitionId,
  token,
  onUnauthorized,
  onChange,
  status,
  lanes,
  defaultTargetType = null,
}: AuthProps & {
  competitionId: string;
  defaultTargetType?: string | null;
  status: string;
  lanes: { laneId: string; number: number }[];
  onChange: (people: Participant[] | null) => void;
}) {
  const checkingIn = status === 'Check-in';
  const [expanded, setExpanded] = useState(status !== 'Active');
  useEffect(() => {
    setExpanded(status !== 'Active');
  }, [status]);
  const canRemove = status === 'Scheduled';
  const canAdd = status === 'Scheduled';
  const canSelect = status === 'Scheduled';
  const [people, setPeople] = useState<Participant[]>([]);
  const [participantFilter, setParticipantFilter] = useState('');
  const filterTerms = checkingIn ? participantFilter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const visiblePeople = people.filter((person) => {
    const searchable =
      `${person.name} ${person.federationNumber} ${person.clubNumber} ${person.clubName}`.toLocaleLowerCase();
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
    setImportError('');
    setNotice('');
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) {
      setImportError(t('CompetitionParticipants.kies_een_xlsxbestand_van_maximaal_5_mb'));
      return;
    }
    importInProgress.current = true;
    setImporting(true);
    try {
      const response = await managementRequest(`${url}/import`, token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      const result = (await response.json()) as { imported: number; created: number; message?: string };
      if (!response.ok)
        throw new Error(result.message ?? t('CompetitionParticipants.importeren_is_mislukt_probeer_het_opnieuw'));
      setNotice(
        t('CompetitionParticipants.deelnemers_gemporteerd_nieuwe_schutters_aangemaakt', {
          p0: result.imported,
          p1: result.created,
        }),
      );
      setRetry((value) => value + 1);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : t('CompetitionParticipants.importeren_is_mislukt_controleer_de_deelnemerslijst_voordat_je_het'),
      );
    } finally {
      importInProgress.current = false;
      setImporting(false);
    }
  }
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
        const [response, targetsResponse] = await Promise.all([
          managementRequest(url, token, options),
          managementRequest('/api/v1/admin/target-types', token, options),
        ]);
        if (response.status === 401 || targetsResponse.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (!response.ok || !targetsResponse.ok) throw new Error();
        const result = (await response.json()) as Participant[];
        const types = (await targetsResponse.json()) as string[];
        if (!controller.signal.aborted) {
          setPeople(result);
          setTargetTypes(types);
          const available = new Set(result.map((person) => person.id));
          setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))));
        }
      } catch {
        if (!controller.signal.aborted)
          setError(t('CompetitionParticipants.could_not_load_participants_please_try_again'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url, token, onUnauthorized, retry]);
  useEffect(() => {
    onChange(loading || error ? null : people);
  }, [people, loading, error, onChange]);
  const close = () => {
    setOpen(false);
  };
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
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setRemoveError('');
    setTargetError('');
    setNotice('');
  }
  async function unregisterSelected() {
    if (!canRemove || removalInProgress.current || targetUpdateInProgress.current || !selectedIds.size) return;
    const ids = [...selectedIds];
    const description =
      ids.length === 1
        ? t('CompetitionParticipants.de_geselecteerde_deelnemer')
        : t('CompetitionParticipants.geselecteerde_deelnemers', { p0: ids.length });
    if (
      !window.confirm(
        t('CompetitionParticipants.wil_je_uitschrijven_voor_deze_wedstrijdde_deelnemers_blijven_in', {
          p0: description,
        }),
      )
    )
      return;
    removalInProgress.current = true;
    setRemoving(true);
    setRemoveError('');
    setNotice('');
    try {
      const response = await managementRequest(url, token, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids }),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) throw new Error();
      const removed = new Set(ids);
      setPeople((current) => current.filter((person) => !removed.has(person.id)));
      setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))));
      setNotice(
        t('CompetitionParticipants.deelnemer_uitgeschreven', { p0: ids.length, p1: ids.length === 1 ? '' : 's' }),
      );
    } catch {
      setRemoveError(t('CompetitionParticipants.uitschrijven_is_niet_gelukt_de_selectie_is_bewaard_probeer'));
    } finally {
      removalInProgress.current = false;
      setRemoving(false);
    }
  }
  async function updateSelectedTarget(targetType: string) {
    if (targetUpdateInProgress.current || removalInProgress.current || !selectedIds.size) return;
    const ids = [...selectedIds];
    targetUpdateInProgress.current = true;
    setUpdatingTarget(true);
    setTargetError('');
    setNotice('');
    try {
      const response = await managementRequest(url, token, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: ids, targetType }),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { updatedParticipantIds: string[]; targetType: string | null };
      const updated = new Set(result.updatedParticipantIds);
      setPeople((current) =>
        current.map((person) => (updated.has(person.id) ? { ...person, targetType: result.targetType } : person)),
      );
      setNotice(
        t('CompetitionParticipants.target_bijgewerkt_voor_deelnemer', {
          p0: updated.size,
          p1: updated.size === 1 ? '' : 's',
        }),
      );
    } catch {
      setTargetError(t('CompetitionParticipants.target_opslaan_is_niet_gelukt_de_selectie_is_bewaard'));
    } finally {
      targetUpdateInProgress.current = false;
      setUpdatingTarget(false);
    }
  }
  async function updateAssignment(person?: Participant) {
    if (assignmentInProgress.current || busy) return;
    if (
      !person &&
      !window.confirm(
        t('CompetitionParticipants.this_will_overwrite_all_existing_assignments_for_checkedin_participants'),
      )
    )
      return;
    assignmentInProgress.current = true;
    setAssignmentBusy(true);
    setAssignmentError('');
    setNotice('');
    try {
      const endpoint = person
        ? `${url}/${encodeURIComponent(person.id)}/check-in`
        : `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/assignments/reassign`;
      const response = await managementRequest(endpoint, token, {
        method: person ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(person ? { checkedIn: !person.checkedIn } : {}),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? t('CompetitionParticipants.could_not_save_shooting_assignments'));
      }
      if (person)
        setPeople((current) => current.map((p) => (p.id === person.id ? { ...p, checkedIn: !person.checkedIn } : p)));
      else {
        setRetry((value) => value + 1);
        setNotice(t('CompetitionParticipants.shooting_assignments_updated_for_checkedin_participants'));
      }
    } catch (error) {
      setAssignmentError(
        error instanceof Error ? error.message : t('CompetitionParticipants.could_not_save_shooting_assignments'),
      );
    } finally {
      assignmentInProgress.current = false;
      setAssignmentBusy(false);
    }
  }
  return (
    <section className="panel collapsible-panel" aria-labelledby="competition-participants-title">
      <div className="section-header collapsible-panel-header">
        <h3 id="competition-participants-title">{t('CompetitionParticipants.participants')}</h3>
        <div className="competition-participants-actions">
          {canAdd && (
            <>
              <input
                ref={importInput}
                type="file"
                hidden
                accept=".xlsx"
                aria-label={t('CompetitionParticipants.import_participants_xlsx')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importFile(file);
                }}
              />
              <button
                type="button"
                className="with-icon participant-import-button"
                hidden={!expanded}
                disabled={loading || !!error || busy || open}
                onClick={() => importInput.current?.click()}
              >
                <Icon name="import" />
                {t('CompetitionParticipants.import')}
              </button>
            </>
          )}
          {status === 'Check-in' && (
            <button
              type="button"
              hidden={!expanded}
              disabled={loading || !!error || busy || !people.some((p) => p.checkedIn)}
              onClick={() => {
                void updateAssignment();
              }}
            >
              {t('CompetitionParticipants.reassign_checkedin_participants')}
            </button>
          )}
          {canAdd && (
            <button
              ref={addButton}
              className="with-icon"
              hidden={!expanded}
              disabled={loading || !!error || busy}
              onClick={() => setOpen(true)}
            >
              <Icon name="userPlus" />
              {t('CompetitionParticipants.add_participant')}
            </button>
          )}
          <button
            type="button"
            className="panel-toggle"
            aria-label={t('participants.toggle', {
              action: expanded ? t('CompetitionDetailPage.collapse') : t('CompetitionDetailPage.expand'),
            })}
            aria-expanded={expanded}
            aria-controls="competition-participants-content"
            onClick={() => setExpanded((value) => !value)}
          >
            <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div id="competition-participants-content" className="collapsible-panel-content" hidden={!expanded}>
        {importing && <p role="status">{t('CompetitionParticipants.deelnemers_importeren')}</p>}
        {importError && (
          <p className="error" role="alert">
            {message(importError)}
          </p>
        )}
        {loading ? (
          <p role="status">{t('CompetitionParticipants.loading_participants')}</p>
        ) : error ? (
          <>
            <p className="error" role="alert">
              {message(error)}
            </p>
            <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>
              {t('CompetitionDetailPage.try_again')}
            </button>
          </>
        ) : (
          <>
            {assignmentError && (
              <p className="error" role="alert">
                {message(assignmentError)}
              </p>
            )}
            {canSelect && selectedIds.size > 0 && (
              <div
                className="lane-bulk-controls"
                role="group"
                aria-label={t('CompetitionParticipants.doe_met_selectie')}
              >
                <p>{t('selection.count', { count: selectedIds.size })}</p>
                <select
                  aria-label={t('CompetitionParticipants.target_for_selected_participants')}
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    void updateSelectedTarget(JSON.parse(event.target.value) as string);
                  }}
                >
                  <option value="" disabled>
                    {t('CompetitionParticipants.target')}
                  </option>
                  {targetTypes.map((type) => (
                    <option key={type} value={JSON.stringify(type)}>
                      {type}
                    </option>
                  ))}
                </select>
                {canRemove && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void unregisterSelected();
                    }}
                  >
                    {t('CompetitionParticipants.uitschrijven')}
                  </button>
                )}
              </div>
            )}
            {updatingTarget && <p role="status">{t('CompetitionParticipants.target_opslaan')}</p>}
            {targetError && (
              <p className="error" role="alert">
                {message(targetError)}
              </p>
            )}
            {removing && <p role="status">{t('CompetitionParticipants.deelnemers_uitschrijven')}</p>}
            {notice && (
              <p className="success" role="status">
                {message(notice)}
              </p>
            )}
            {removeError && (
              <div>
                <p className="error" role="alert">
                  {message(removeError)}
                </p>
                <button
                  className="secondary retry-button"
                  disabled={!canRemove || busy || !selectedIds.size}
                  onClick={() => {
                    void unregisterSelected();
                  }}
                >
                  {t('AdminPage.opnieuw_proberen')}
                </button>
              </div>
            )}
            {checkingIn && (
              <div className="participant-search-field participant-filter">
                <label htmlFor="check-in-participant-filter">{t('CompetitionParticipants.filter_participants')}</label>
                <input
                  id="check-in-participant-filter"
                  type="search"
                  placeholder={t('CompetitionParticipants.name_federation_number_or_club')}
                  value={participantFilter}
                  onChange={(event) => setParticipantFilter(event.target.value)}
                />
              </div>
            )}
            <div className="table-scroll">
              <table className="participants-table" aria-label={t('CompetitionParticipants.competition_participants')}>
                <thead>
                  <tr>
                    {canSelect && (
                      <th scope="col">
                        <label className="lane-selection">
                          <input
                            ref={selectAll}
                            type="checkbox"
                            aria-label={t('selection.allParticipants')}
                            checked={allSelected}
                            disabled={busy || !people.length}
                            onChange={(event) => {
                              setSelectedIds(
                                event.target.checked ? new Set(people.map((person) => person.id)) : new Set(),
                              );
                              setRemoveError('');
                              setTargetError('');
                              setNotice('');
                            }}
                          />
                        </label>
                      </th>
                    )}
                    {[
                      '#',
                      t('CompetitionDetailPage.name'),
                      t('CompetitionParticipants.club'),
                      t('BowTypeField.bow_type'),
                      t('CompetitionParticipants.target'),
                      ...(checkingIn
                        ? [t('CompetitionParticipants.assignment'), t('CompetitionParticipants.checkin')]
                        : []),
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiblePeople.length ? (
                    visiblePeople.map((person) => (
                      <tr
                        key={person.id}
                        className={canSelect && selectedIds.has(person.id) ? 'lane-selected' : undefined}
                      >
                        {canSelect && (
                          <td>
                            <input
                              type="checkbox"
                              className="lane-select-checkbox"
                              aria-label={t('CompetitionParticipants.select_participant', {
                                p0: person.name,
                                p1: person.federationNumber,
                              })}
                              checked={selectedIds.has(person.id)}
                              disabled={busy}
                              onChange={(event) => selectPerson(person.id, event.target.checked)}
                            />
                          </td>
                        )}
                        <td>{person.federationNumber}</td>
                        <th scope="row">{person.name}</th>
                        <td>
                          [{person.clubNumber}] {person.clubName}
                        </td>
                        <td>{person.bowType ?? '—'}</td>
                        <td>{person.targetType ?? '\u2014'}</td>
                        {checkingIn && (
                          <>
                            <td>
                              {person.laneId && person.targetLetter
                                ? t('CompetitionParticipants.lane', {
                                    p0: lanes.find((l) => l.laneId === person.laneId)?.number ?? '?',
                                    p1: person.targetLetter,
                                  })
                                : '\u2014'}
                            </td>
                            <td className="participant-check-in-cell">
                              <input
                                type="checkbox"
                                className="check-in-checkbox"
                                aria-label={t('CompetitionParticipants.check_in', {
                                  p0: person.name,
                                  p1: person.federationNumber,
                                })}
                                checked={person.checkedIn ?? false}
                                disabled={busy}
                                onChange={() => {
                                  void updateAssignment(person);
                                }}
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6 + (canSelect ? 1 : 0) + (checkingIn ? 2 : 0)}>
                        {people.length
                          ? t('CompetitionParticipants.no_matching_participants')
                          : t('CompetitionParticipants.no_participants_yet')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {canAdd && open && (
        <ParticipantModal
          defaultTargetType={defaultTargetType}
          token={token}
          onUnauthorized={onUnauthorized}
          url={url}
          onClose={close}
          onAdded={(person) => {
            setPeople((current) =>
              [...current.filter((p) => p.id !== person.id), person].sort((a, b) => a.name.localeCompare(b.name, 'nl')),
            );
          }}
        />
      )}
    </section>
  );
}
