import type { CompetitionStatus } from './status';
import { CompetitionStatusBadge } from './CompetitionStatusBadge';
import { useModal } from '../../hooks/useModal';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';

interface Competition {
  id: string;
  status: CompetitionStatus;
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  range: { id: string; name: string };

}

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

export function CompetitionsPage({ token, onUnauthorized }: AuthProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
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
        const response = await fetch('/api/v1/admin/competitions', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok) throw new Error('Loading failed');
        const result = await response.json() as Competition[];
        if (!controller.signal.aborted) setCompetitions(result);
      } catch {
        if (!controller.signal.aborted) setError('Could not load competitions. Check your connection and try again.');
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

  return <section className="panel">
    <div className="section-header">
      <div><h2>Competitions</h2><p className="muted">Schedule competitions and assign lanes and distances.</p></div>
      <button ref={addButton} onClick={() => { setNotice(''); setAdding(true); }} disabled={loading || !!error}>Add</button>
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {loading ? <p role="status">Loading competitions…</p> : error ? <div>
      <p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </div> : competitions.length === 0 ? <div className="empty-state">
      <h3>No competitions yet</h3><p>Add your first competition to schedule its range and lanes.</p>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">Name</th><th scope="col">Date</th><th scope="col">Time</th>
        <th scope="col">Range</th><th scope="col">Status</th></tr></thead>
      <tbody>{competitions.map((competition) => <tr key={competition.id}>
        <th scope="row"><Link to={`/admin/competitions/${competition.id}`}>{competition.name}</Link></th>
        <td><time dateTime={competition.date}>{competition.date}</time></td>
        <td>{competition.startingTime} – {competition.endingTime}</td>
        <td>{competition.range.name}</td><td><CompetitionStatusBadge status={competition.status} /></td>
      </tr>)}</tbody>
    </table></div>}
    {adding && <AddCompetitionModal token={token} onUnauthorized={onUnauthorized} onClose={closeModal}
      onCreated={(competition) => {
        setCompetitions((current) => [...current, competition].sort((a, b) => a.date.localeCompare(b.date) || a.startingTime.localeCompare(b.startingTime) || a.id.localeCompare(b.id)));
        setNotice(`Competition “${competition.name}” added.`);
        closeModal();
      }} />}
  </section>;
}

function AddCompetitionModal({ token, onUnauthorized, onClose, onCreated }: AuthProps & {
  onClose: () => void;
  onCreated: (competition: Competition) => void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [startingTime, setStartingTime] = useState('');
  const [endingTime, setEndingTime] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [rangeId, setRangeId] = useState('');
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const dialog = useModal(onClose, pending);
  const [error, setError] = useState('');
  const range = ranges.find((value) => value.id === rangeId);


  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
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
        if (!controller.signal.aborted) setLoadError('Could not load ranges. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || loadError) return;
    setError('');
    if (!name.trim()) { setError('Enter a competition name.'); return; }
    if (endingTime <= startingTime) { setError('Ending time must be after starting time on the competition date.'); return; }
    const selectedLanes = Object.entries(assignments).map(([laneId, distanceMeters]) => ({ laneId, distanceMeters }));
    if (!range || selectedLanes.length === 0) { setError('Select a range and at least one lane with a distance.'); return; }
    setPending(true);
    try {
      const response = await fetch('/api/v1/admin/competitions', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), date, startingTime, endingTime, rangeId, lanes: selectedLanes }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        setError(response.status === 400 ? 'Check the date, times, range and lane distances and try again.'
          : 'Could not save the competition. Please try again.');
        return;
      }
      onCreated(await response.json() as Competition);
    } catch {
      setError('Could not reach the server. Your input has been kept. Check the overview before retrying.');
    } finally {
      setPending(false);
    }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="add-competition-title">
    <h2 id="add-competition-title">Add competition</h2>
    <p className="muted">Choose a range and assign a distance to each participating lane.</p>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label htmlFor="competition-name">Name</label>
        <input id="competition-name" autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="competition-date">Date</label>
        <input id="competition-date" type="date" required min="0001-01-01" max="9999-12-31" value={date} onChange={(event) => setDate(event.target.value)} />
        <label htmlFor="competition-start">Starting time</label>
        <input id="competition-start" type="time" required value={startingTime} onChange={(event) => setStartingTime(event.target.value)} />
        <label htmlFor="competition-end">Ending time</label>
        <input id="competition-end" type="time" required value={endingTime} onChange={(event) => setEndingTime(event.target.value)} />
        {loading ? <p role="status">Loading ranges…</p> : loadError ? <div>
          <p className="error" role="alert">{loadError}</p>
          <button type="button" className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div> : ranges.length === 0 ? <p role="status">Create a range in Settings before adding a competition.</p> : <>
          <label htmlFor="competition-range">Range</label>
          <select id="competition-range" required value={rangeId} onChange={(event) => {
            setRangeId(event.target.value); setAssignments({});
          }}>
            <option value="">Select a range</option>
            {ranges.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
          </select>
          {range && <fieldset className="competition-lanes"><legend>Lanes and distances</legend>
            <p className="muted">Choose a distance to include a lane. Leave unused lanes unassigned.</p>
            <div className="distance-list" role="group" aria-label="Set distance for all lanes">
              <span>Set all lanes to:</span>
              {range.supportedDistancesMeters.map((distance) => <button key={distance} type="button"
                className="distance-link" aria-label={`Set all lanes to ${distance} m`}
                onClick={() => setAssignments(Object.fromEntries(range.lanes.map((lane) => [lane.id, distance])))}>
                {distance} m
              </button>)}
            </div>
            {range.lanes.map((lane) => <div className="lane-assignment" key={lane.id}>
              <label htmlFor={`lane-${lane.id}`}>Lane {lane.number}</label>
              <select id={`lane-${lane.id}`} value={assignments[lane.id] ?? ''} onChange={(event) => {
                const value = event.target.value;
                setAssignments((current) => {
                  const next = { ...current };
                  if (value) next[lane.id] = Number(value); else delete next[lane.id];
                  return next;
                });
              }}>
                <option value="">Not assigned</option>
                {range.supportedDistancesMeters.map((distance) => <option key={distance} value={distance}>{distance} m</option>)}
              </select>
            </div>)}
          </fieldset>}
        </>}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={pending}>Cancel</button>
        <button type="submit" disabled={pending || loading || !!loadError || ranges.length === 0}>{pending ? 'Saving…' : 'Add competition'}</button>
      </div>
    </form>
  </dialog>;
}

