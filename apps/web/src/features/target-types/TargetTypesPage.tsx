import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SettingsCard } from '../settings/SettingsCard';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';
const sortTypes = (types: string[]) => [...types].sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));

export function TargetTypesPage({ token, onUnauthorized }: AuthProps) {
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState(false);
  const removalInProgress = useRef(false);
  const selectAll = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const response = await managementRequest('/api/v1/admin/target-types', token, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onUnauthorized(t(expiredMessage));
          return;
        }
        if (!response.ok) throw new Error(t('CompetitionDetailPage.loading_failed'));
        const result = (await response.json()) as string[];
        if (!controller.signal.aborted) setTypes(sortTypes(result));
      } catch {
        if (!controller.signal.aborted) setLoadError(t('TargetTypesPage.could_not_load_target_types_please_try_again'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  const allSelected = types.length > 0 && selected.size === types.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected, allSelected, loading, loadError]);

  function selectType(type: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
    setError('');
    setNotice('');
  }

  async function removeSelected() {
    if (removalInProgress.current || pending || !selected.size) return;
    const names = [...selected];
    if (
      !window.confirm(
        t('TargetTypesPage.wil_je_de_volgende_target_types_definitief_verwijderen', { p0: names.join('\n') }),
      )
    )
      return;
    removalInProgress.current = true;
    setRemoving(true);
    setError('');
    setNotice('');
    try {
      const response = await managementRequest('/api/v1/admin/target-types', token, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (response.status === 409) {
        setError(t('TargetTypesPage.een_of_meer_geselecteerde_target_types_zijn_in_gebruik'));
        return;
      }
      if (!response.ok) throw new Error();
      setTypes((current) => current.filter((type) => !selected.has(type)));
      setSelected(new Set());
      setNotice(t('TargetTypesPage.geselecteerde_target_types_verwijderd'));
    } catch {
      setError(t('TargetTypesPage.verwijderen_is_niet_gelukt_de_selectie_is_bewaard_probeer'));
    } finally {
      removalInProgress.current = false;
      setRemoving(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || removalInProgress.current) return;
    setError('');
    setNotice('');
    if (!name.trim()) {
      setError(t('TargetTypesPage.enter_a_target_type_name'));
      return;
    }
    setPending(true);
    try {
      const response = await managementRequest('/api/v1/admin/target-types', token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 409
            ? t('TargetTypesPage.a_target_type_with_this_name_already_exists')
            : t('TargetTypesPage.could_not_create_the_target_type_please_try_again'),
        );
        return;
      }
      const created = (await response.json()) as string;
      setTypes((current) => sortTypes([...current, created]));
      setName('');
      setNotice(t('TargetTypesPage.target_type_added', { p0: created }));
    } catch {
      setError(t('TargetTypesPage.could_not_reach_the_server_your_input_has_been'));
    } finally {
      setPending(false);
      nameInput.current?.focus();
    }
  }

  return (
    <SettingsCard id="target-types" icon="target" title={t('TargetTypesPage.target_types')}>
      <p className="muted">{t('TargetTypesPage.manage_the_target_names_available_for_competition_lanes')}</p>
      <form
        className="target-type-create"
        aria-label={t('TargetTypesPage.add_target_type')}
        aria-busy={pending}
        onSubmit={(event) => {
          void create(event);
        }}
      >
        <label htmlFor="target-type-name">{t('CompetitionDetailPage.name')}</label>
        <div className="target-type-create-fields">
          <input
            ref={nameInput}
            id="target-type-name"
            required
            maxLength={100}
            value={name}
            readOnly={pending || removing}
            placeholder={t('TargetTypesPage.eg_dutch_target_40_cm_3spot')}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={pending || removing || loading || !!loadError}>
            {pending ? t('CompetitionParticipants.adding') : t('TargetTypesPage.add_target_type')}
          </button>
        </div>
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
      </form>
      {selected.size > 0 && (
        <div className="lane-bulk-controls" role="group" aria-label={t('CompetitionParticipants.doe_met_selectie')}>
          <p>{t('selection.actions', { count: selected.size })}</p>
          <button
            type="button"
            disabled={removing || pending}
            onClick={() => {
              void removeSelected();
            }}
          >
            {removing ? t('TargetTypesPage.verwijderen') : t('TargetTypesPage.verwijderen_401')}
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">{t('TargetTypesPage.loading_target_types')}</p>
      ) : loadError ? (
        <div>
          <p className="error" role="alert">
            {message(loadError)}
          </p>
          <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </div>
      ) : types.length === 0 ? (
        <p>{t('TargetTypesPage.no_target_types_yet_add_your_first_target_type')}</p>
      ) : (
        <div className="table-scroll">
          <table aria-label={t('TargetTypesPage.target_types')}>
            <thead>
              <tr>
                <th scope="col">
                  <label className="lane-selection">
                    <input
                      ref={selectAll}
                      type="checkbox"
                      aria-label={t('TargetTypesPage.alle_target_types_selecteren')}
                      checked={allSelected}
                      disabled={removing}
                      onChange={(event) => {
                        setSelected(event.target.checked ? new Set(types) : new Set());
                        setError('');
                        setNotice('');
                      }}
                    />
                    {t('TargetTypesPage.alles_selecteren')}
                  </label>
                </th>
                <th scope="col">{t('CompetitionDetailPage.name')}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type} className={selected.has(type) ? 'lane-selected' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      className="lane-select-checkbox"
                      aria-label={t('TargetTypesPage.selecteer_target_type', { p0: type })}
                      checked={selected.has(type)}
                      disabled={removing}
                      onChange={(event) => selectType(type, event.target.checked)}
                    />
                  </td>
                  <th scope="row">{type}</th>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsCard>
  );
}
