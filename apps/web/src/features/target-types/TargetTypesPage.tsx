import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SettingsCard } from '../settings/SettingsCard';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const expiredMessage = 'Je sessie is verlopen of ongeldig. Log opnieuw in.';
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
    setLoading(true); setLoadError('');
    void (async () => {
      try {
        const response = await fetch('/api/v1/admin/target-types', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok) throw new Error('Loading failed');
        const result = await response.json() as string[];
        if (!controller.signal.aborted) setTypes(sortTypes(result));
      } catch {
        if (!controller.signal.aborted) setLoadError('Could not load target types. Please try again.');
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
      if (checked) next.add(type); else next.delete(type);
      return next;
    });
    setError(''); setNotice('');
  }

  async function removeSelected() {
    if (removalInProgress.current || pending || !selected.size) return;
    const names = [...selected];
    if (!window.confirm(`Wil je de volgende target types definitief verwijderen?\n\n${names.join('\n')}`)) return;
    removalInProgress.current = true;
    setRemoving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/admin/target-types', {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (response.status === 409) {
        setError('Een of meer geselecteerde target types zijn in gebruik bij een wedstrijd. Er is niets verwijderd.');
        return;
      }
      if (!response.ok) throw new Error();
      setTypes((current) => current.filter((type) => !selected.has(type)));
      setSelected(new Set());
      setNotice('Geselecteerde target types verwijderd.');
    } catch { setError('Verwijderen is niet gelukt. De selectie is bewaard. Probeer het opnieuw.'); }
    finally { removalInProgress.current = false; setRemoving(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || removalInProgress.current) return;
    setError(''); setNotice('');
    if (!name.trim()) { setError('Enter a target type name.'); return; }
    setPending(true);
    try {
      const response = await fetch('/api/v1/admin/target-types', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        setError(response.status === 409 ? 'A target type with this name already exists.'
          : 'Could not create the target type. Please try again.');
        return;
      }
      const created = await response.json() as string;
      setTypes((current) => sortTypes([...current, created]));
      setName(''); setNotice(`Target type “${created}” added.`);
    } catch { setError('Could not reach the server. Your input has been kept.'); }
    finally { setPending(false); nameInput.current?.focus(); }
  }

  return <SettingsCard id="target-types" title="Target types">
    <p className="muted">Manage the target names available for competition lanes.</p>
    <form className="target-type-create" aria-label="Add target type" aria-busy={pending}
      onSubmit={(event) => { void create(event); }}>
      <label htmlFor="target-type-name">Name</label>
      <div className="target-type-create-fields">
        <input ref={nameInput} id="target-type-name" required maxLength={100} value={name} readOnly={pending || removing}
          placeholder="e.g. Dutch Target 40 cm (3-spot)" onChange={(event) => setName(event.target.value)} />
        <button type="submit" disabled={pending || removing || loading || !!loadError}>{pending ? 'Adding...' : 'Add target type'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
    </form>
    {selected.size > 0 && <div className="lane-bulk-controls" role="group" aria-label="Doe met selectie">
      <p>Doe met selectie ({selected.size} geselecteerd)</p>
      <button type="button" disabled={removing || pending} onClick={() => { void removeSelected(); }}>
        {removing ? 'Verwijderen...' : 'Verwijderen'}
      </button>
    </div>}
    {loading ? <p role="status">Loading target types...</p> : loadError ? <div>
      <p className="error" role="alert">{loadError}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </div> : types.length === 0 ? <p>No target types yet. Add your first target type above.</p>
      : <div className="table-scroll"><table aria-label="Target types">
        <thead><tr><th scope="col"><label className="lane-selection">
          <input ref={selectAll} type="checkbox" aria-label="Alle target types selecteren" checked={allSelected} disabled={removing}
            onChange={(event) => { setSelected(event.target.checked ? new Set(types) : new Set()); setError(''); setNotice(''); }} />
          Alles selecteren
        </label></th><th scope="col">Name</th></tr></thead>
        <tbody>{types.map((type) => <tr key={type} className={selected.has(type) ? 'lane-selected' : undefined}>
          <td><input type="checkbox" className="lane-select-checkbox" aria-label={`Selecteer target type ${type}`}
            checked={selected.has(type)} disabled={removing} onChange={(event) => selectType(type, event.target.checked)} /></td>
          <th scope="row">{type}</th>
        </tr>)}</tbody>
      </table></div>}
  </SettingsCard>;
}
