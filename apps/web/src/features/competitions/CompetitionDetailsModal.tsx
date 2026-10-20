import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useModal } from '../../hooks/useModal';
import type { Competition } from './CompetitionDetailPage';

interface Range {
  id: string; name: string; supportedDistancesMeters: number[];
  lanes: { id: string; number: number }[];
}

export function CompetitionDetailsModal({ mode, competition, token, onUnauthorized, onClose, onSaved, onRemoved }: {
  mode: 'edit' | 'remove'; competition: Competition; token: string;
  onUnauthorized: (message: string) => void; onClose: () => void;
  onSaved: (competition: Competition) => void; onRemoved: () => void;
}) {
  const [draft, setDraft] = useState({ name: competition.name, date: competition.date,
    startingTime: competition.startingTime, endingTime: competition.endingTime,
    numberOfRounds: competition.numberOfRounds, arrowsPerRound: competition.arrowsPerRound,
    defaultTargetType: competition.defaultTargetType ?? '' });
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [rangeId, setRangeId] = useState(competition.range.id);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [initialAssignments, setInitialAssignments] = useState<Record<string, number>>({});
  const rangeChanged = rangeId !== competition.range.id;
  const lanesChanged = rangeChanged || Object.keys(assignments).length !== Object.keys(initialAssignments).length
    || Object.entries(assignments).some(([laneId, distance]) => initialAssignments[laneId] !== distance);
  const range = ranges.find((value) => value.id === rangeId);
  const [loading, setLoading] = useState(mode === 'edit');
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useModal(onClose, pending);
  const removing = mode === 'remove';

  useEffect(() => {
    if (mode !== 'edit') return;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    void (async () => {
      try {
        const responses = await Promise.all(['/api/v1/admin/target-types', '/api/v1/admin/ranges',
          `/api/v1/admin/competitions/${encodeURIComponent(competition.id)}/lanes`].map((url) => fetch(url, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })));
        if (controller.signal.aborted) return;
        if (responses.some((response) => response.status === 401)) { onUnauthorized('Je sessie is verlopen of ongeldig. Log opnieuw in.'); return; }
        if (responses.some((response) => !response.ok)) throw new Error('Loading failed');
        const [types, loadedRanges] = await Promise.all([responses[0]!.json() as Promise<string[]>, responses[1]!.json() as Promise<Range[]>]);
        const loadedLanes = await responses[2]!.json() as { laneId: string; distanceMeters: number }[];
        if (!controller.signal.aborted) {
          setTargetTypes(types.sort((a, b) => a.localeCompare(b, 'nl', { numeric: true })));
          setRanges(loadedRanges);
          const savedAssignments = Object.fromEntries(loadedLanes.map((lane) => [lane.laneId, lane.distanceMeters]));
          setInitialAssignments(savedAssignments);
          setAssignments(savedAssignments);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError('Could not load ranges and target types. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [mode, token, onUnauthorized, retry, competition.id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || loading || loadError) return;
    setError('');
    if (!removing) {
      if (!draft.name.trim()) { setError('Enter a competition name.'); return; }
      if (draft.endingTime <= draft.startingTime) { setError('Ending time must be after starting time on the competition date.'); return; }
      if (!range || Object.keys(assignments).length === 0) {
        setError('Select at least one lane with a distance.'); return;
      }
    }
    setPending(true);
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(competition.id)}`, {
        method: removing ? 'DELETE' : 'PATCH',
        headers: { Authorization: `Bearer ${token}`, ...(!removing ? { 'Content-Type': 'application/json' } : {}) },
        ...(!removing ? { body: JSON.stringify({ ...draft, name: draft.name.trim(), defaultTargetType: draft.defaultTargetType || null,
          ...(lanesChanged ? { rangeId, lanes: Object.entries(assignments).map(([laneId, distanceMeters]) => ({ laneId, distanceMeters })) } : {}),
        }) } : {}),
      });
      if (response.status === 401) { onUnauthorized('Je sessie is verlopen of ongeldig. Log opnieuw in.'); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message ?? `Could not ${removing ? 'remove' : 'save'} the competition. Please try again.`);
      }
      if (removing) onRemoved();
      else onSaved(await response.json() as Competition);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server. Please try again.');
    } finally { setPending(false); }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="competition-modal-title"
    aria-describedby={removing ? 'competition-remove-description' : undefined}>
    <h2 id="competition-modal-title">{removing ? 'Remove competition' : 'Edit competition'}</h2>
    {removing && <p id="competition-remove-description">Remove competition “{competition.name}”? All associated lane assignments,
      registrations and scores will be permanently deleted. This cannot be undone.</p>}
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      {!removing && <fieldset disabled={pending}>
        <label htmlFor="edit-competition-name">Name</label>
        <input id="edit-competition-name" autoFocus required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <label htmlFor="edit-competition-date">Date</label>
        <input id="edit-competition-date" type="date" required min="0001-01-01" max="9999-12-31" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
        <div className="competition-form-row">
          <div className="competition-form-field">
            <label htmlFor="edit-competition-start">Starting time</label>
            <input id="edit-competition-start" type="time" required value={draft.startingTime} onChange={(event) => setDraft({ ...draft, startingTime: event.target.value })} />
          </div>
          <div className="competition-form-field">
            <label htmlFor="edit-competition-end">Ending time</label>
            <input id="edit-competition-end" type="time" required value={draft.endingTime} onChange={(event) => setDraft({ ...draft, endingTime: event.target.value })} />
          </div>
        </div>
        <div className="competition-form-row">
          <div className="competition-form-field">
            <label htmlFor="edit-competition-rounds">Number of rounds</label>
            <input id="edit-competition-rounds" type="number" required min={1} max={1000} disabled={competition.status !== 'Scheduled'} value={draft.numberOfRounds}
              onChange={(event) => setDraft({ ...draft, numberOfRounds: Number(event.target.value) })} />
          </div>
          <div className="competition-form-field">
            <label htmlFor="edit-competition-arrows">Arrows per round</label>
            <input id="edit-competition-arrows" type="number" required min={1} max={36} disabled={competition.status !== 'Scheduled'} value={draft.arrowsPerRound}
              onChange={(event) => setDraft({ ...draft, arrowsPerRound: Number(event.target.value) })} />
          </div>
        </div>
        {competition.status !== 'Scheduled' && <p className="muted">Scoring format is locked after check-in starts.</p>}
        <label htmlFor="edit-competition-target">Default target</label>
        <select id="edit-competition-target" disabled={loading || !!loadError} value={draft.defaultTargetType}
          onChange={(event) => setDraft({ ...draft, defaultTargetType: event.target.value })}>
          <option value="">No default target</option>
          {draft.defaultTargetType && !targetTypes.includes(draft.defaultTargetType) && <option value={draft.defaultTargetType}>{draft.defaultTargetType}</option>}
          {targetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <p className="muted">The default applies to new registrations. Existing lane targets and registrations keep their settings.</p>
        {loading && <p role="status">Loading ranges and target types...</p>}
        {loadError && <div><p className="error" role="alert">{loadError}</p>
          <button type="button" className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <label htmlFor="edit-competition-range">Range</label>
        <select id="edit-competition-range" required disabled={loading || !!loadError || competition.status !== 'Scheduled'} value={rangeId}
          onChange={(event) => {
            setRangeId(event.target.value);
            setAssignments(event.target.value === competition.range.id ? { ...initialAssignments } : {});
          }}>
          {!ranges.some((value) => value.id === competition.range.id) && <option value={competition.range.id}>{competition.range.name}</option>}
          {ranges.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
        </select>
        {competition.status !== 'Scheduled' && <p className="muted">The range is locked after check-in starts.</p>}
        {range && !loading && !loadError && <fieldset className="competition-lanes" disabled={competition.status !== 'Scheduled'}><legend>Lanes and distances</legend>
          <p className="muted">Choose a distance to include a lane. Leave unused lanes unassigned.
            {lanesChanged && ' Changing lanes or distances will clear existing participant placements.'}</p>
          <div className="distance-list" role="group" aria-label="Set distance for all lanes">
            <span>Set all lanes to:</span>
            {range.supportedDistancesMeters.map((distance) => <button key={distance} type="button" className="distance-link"
              aria-label={`Set all lanes to ${distance} m`}
              onClick={() => setAssignments(Object.fromEntries(range.lanes.map((lane) => [lane.id, distance])))}>{distance} m</button>)}
          </div>
          {range.lanes.map((lane) => <div className="lane-assignment" key={lane.id}>
            <label htmlFor={`edit-lane-${lane.id}`}>Lane {lane.number}</label>
            <select id={`edit-lane-${lane.id}`} value={assignments[lane.id] ?? ''} onChange={(event) => {
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
      </fieldset>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" autoFocus={removing} disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" className={removing ? 'danger' : undefined} disabled={pending || loading || !!loadError}>
          {pending ? (removing ? 'Removing...' : 'Saving...') : (removing ? 'Remove competition' : 'Save changes')}
        </button>
      </div>
    </form>
  </dialog>;
}
