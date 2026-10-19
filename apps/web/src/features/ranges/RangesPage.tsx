import { useModal } from '../../hooks/useModal';
import { SettingsCard } from '../settings/SettingsCard';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

interface Range {
  id: string;
  name: string;
  supportedDistancesMeters: number[];
  lanes: { id: string; number: number }[];
}

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}

const expiredMessage = 'Je sessie is verlopen of ongeldig. Log opnieuw in.';

export function RangesPage({ token, onUnauthorized }: AuthProps) {
  const [ranges, setRanges] = useState<Range[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!adding && restoreFocus.current) {
      addButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [adding]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const response = await fetch('/api/v1/admin/ranges', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok) throw new Error('Loading failed');
        const result = await response.json() as Range[];
        if (!controller.signal.aborted) setRanges(result);
      } catch {
        if (!controller.signal.aborted) setError('Could not load ranges. Check your connection and try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  function closeModal() {
    restoreFocus.current = true;
    setAdding(false);
  }

  return <SettingsCard id="ranges" title="Ranges">
    <div className="section-header">
      <p className="muted">Manage your shooting ranges, distances and lanes.</p>
      <button ref={addButton} onClick={() => { setNotice(''); setAdding(true); }} disabled={loading || !!error}>Add</button>
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {loading ? <p role="status">Loading ranges…</p> : error ? <div>
      <p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </div> : ranges.length === 0 ? <div className="empty-state">
      <h3>No ranges yet</h3><p>Add your first range to set up its distances and lanes.</p>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">Name</th><th scope="col">Supported distances</th><th scope="col">Lanes</th></tr></thead>
      <tbody>{ranges.map((range) => <tr key={range.id}>
        <th scope="row">{range.name}</th>
        <td><div className="distance-list">{range.supportedDistancesMeters.map((distance) =>
          <span className="distance-badge" key={distance}>{distance} m</span>)}</div></td>
        <td><strong>{range.lanes.length} lanes</strong><div className="lane-numbers muted">
          {range.lanes.map((lane) => lane.number).join(', ')}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
    {adding && <AddRangeModal token={token} onUnauthorized={onUnauthorized} onClose={closeModal}
      onCreated={(range) => {
        setRanges((current) => [...current, range].sort((a, b) => a.name.localeCompare(b.name)));
        setNotice(`Range “${range.name}” added.`);
        closeModal();
      }} />}
  </SettingsCard>;
}

function parseLaneNumbers(value: string): number[] {
  const numbers: number[] = [];
  for (const part of value.split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error('Enter lane numbers such as 1-11 or 1, 3, 5.');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > 2147483647 || end < start || numbers.length + end - start + 1 > 1000) {
      throw new Error('Use 1 to 1000 lanes with positive whole numbers.');
    }
    for (let number = start; number <= end; number++) numbers.push(number);
  }
  if (new Set(numbers).size !== numbers.length) throw new Error('Lane numbers must be unique within the range.');
  return numbers;
}

function AddRangeModal({ token, onUnauthorized, onClose, onCreated }: AuthProps & {
  onClose: () => void;
  onCreated: (range: Range) => void;
}) {
  const [name, setName] = useState('');
  const [distances, setDistances] = useState('');
  const [laneNumbers, setLaneNumbers] = useState('');
  const [pending, setPending] = useState(false);
  const dialog = useModal(onClose, pending);
  const [error, setError] = useState('');


  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    let numbers: number[];
    const supportedDistancesMeters = distances.split(',').map((value) => Number(value.trim()));
    try {
      if (!name.trim()) throw new Error('Enter a range name.');
      if (supportedDistancesMeters.length > 100 || supportedDistancesMeters.some((distance) => !Number.isFinite(distance) || distance <= 0)
        || new Set(supportedDistancesMeters).size !== supportedDistancesMeters.length) {
        throw new Error('Enter 1 to 100 unique positive distances, separated by commas.');
      }
      numbers = parseLaneNumbers(laneNumbers);
    } catch (issue) {
      setError((issue as Error).message);
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/v1/admin/ranges', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), supportedDistancesMeters, lanes: numbers.map((number) => ({ number })) }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        setError(response.status === 400 ? 'Check the name, distances and lane numbers and try again.'
          : 'Could not save the range. Please try again.');
        return;
      }
      onCreated(await response.json() as Range);
    } catch {
      setError('Could not reach the server. Your input has been kept. Check the overview before retrying.');
    } finally {
      setPending(false);
    }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="add-range-title">
    <h2 id="add-range-title">Add range</h2>
    <p className="muted">Set up a shooting range and its physical lanes.</p>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label htmlFor="range-name">Name</label>
        <input id="range-name" autoFocus required maxLength={100} placeholder="Indoor" value={name}
          onChange={(event) => setName(event.target.value)} />
        <label htmlFor="range-distances">Supported distances (meters)</label>
        <input id="range-distances" required placeholder="18, 25" aria-describedby="distance-help" value={distances}
          onChange={(event) => setDistances(event.target.value)} />
        <small id="distance-help" className="muted">Separate distances with commas. All lanes support these distances.</small>
        <label htmlFor="range-lanes">Lane numbers</label>
        <input id="range-lanes" required placeholder="1-11" aria-describedby="lane-help" value={laneNumbers}
          onChange={(event) => setLaneNumbers(event.target.value)} />
        <small id="lane-help" className="muted">Use a sequence like 1-11, individual numbers like 1, 3, 5, or both.</small>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={pending}>Cancel</button>
        <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Add range'}</button>
      </div>
    </form>
  </dialog>;
}
