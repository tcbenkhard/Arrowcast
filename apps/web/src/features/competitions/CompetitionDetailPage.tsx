import { competitionStatuses } from './status';
import type { CompetitionStatus } from './status';
import { CompetitionStatusBadge } from './CompetitionStatusBadge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { CompetitionDetailsModal } from './CompetitionDetailsModal';
import type { Participant } from '../participants/CompetitionParticipants';
import { competitionWarnings } from './warnings';
import { CompetitionParticipants } from '../participants/CompetitionParticipants';
import type { LaneQrCode } from '@arrowcast/contracts';
import { LaneScoringCodes } from '../scoring/LaneScoringCodes';
import { ScoringSettings } from '../scoring/ScoringSettings';

interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
export interface Competition {
  id: string;
  name: string;
  date: string;
  startingTime: string;
  endingTime: string;
  status: CompetitionStatus;
  numberOfRounds: number;
  arrowsPerRound: number;
  scoringLocked: boolean;
  defaultTargetType: string | null;
  range: { id: string; name: string };
}
interface Lane {
  laneId: string;
  number: number;
  distanceMeters: number;
  targetType: string | null;
  numberOfTargets: number;
}
interface LaneChanges {
  targetType?: string;
  numberOfTargets?: number;
}
interface BulkLaneUpdate {
  laneIds: Set<string>;
  changes: LaneChanges;
}
const targetCounts = [1, 2];
const expiredMessage = 'Je sessie is verlopen of ongeldig. Log opnieuw in.';
const transitionLabels = {
  'Check-in': 'Start check-in',
  Active: 'Start competition',
  Closed: 'End competition',
};

export function CompetitionDetailPage({ token, onUnauthorized }: AuthProps) {
  const { competitionId } = useParams();
  const navigate = useNavigate();
  const [detailsAction, setDetailsAction] = useState<'edit' | 'remove' | null>(null);
  const [detailsNotice, setDetailsNotice] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const restoreDetailsFocus = useRef<'edit' | 'remove' | null>(null);
  function closeDetailsModal() {
    restoreDetailsFocus.current = detailsAction;
    setDetailsAction(null);
  }
  useEffect(() => {
    if (!detailsAction && restoreDetailsFocus.current) {
      (restoreDetailsFocus.current === 'edit' ? editButton : removeButton).current?.focus();
      restoreDetailsFocus.current = null;
    }
  }, [detailsAction]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [laneSnapshot, setLaneSnapshot] = useState<{ id: string | undefined; data: Lane[] | null }>();
  const [participantSnapshot, setParticipantSnapshot] = useState<{ id: string | undefined; data: Participant[] | null }>();
  const onLanesChange = useCallback((data: Lane[] | null) => setLaneSnapshot({ id: competitionId, data }), [competitionId]);
  const onParticipantsChange = useCallback((data: Participant[] | null) => setParticipantSnapshot({ id: competitionId, data }), [competitionId]);
  const warnings = competitionWarnings(laneSnapshot?.id === competitionId ? laneSnapshot?.data : null,
    participantSnapshot?.id === competitionId ? participantSnapshot?.data : null);
  const validationReady = laneSnapshot?.id === competitionId && laneSnapshot?.data != null
    && participantSnapshot?.id === competitionId && participantSnapshot?.data != null;
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [changingStatus, setChangingStatus] = useState(false);
  const statusInProgress = useRef(false);
  const [statusError, setStatusError] = useState('');
  const [qrCodes, setQrCodes] = useState<LaneQrCode[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setCompetition(null);
    setDetailsAction(null);
    setDetailsNotice('');
    setQrCodes([]);
    setError('');
    void (async () => {
      try {
        const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(competitionId!)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (response.status === 404) { setError('Competition not found.'); return; }
        if (!response.ok) throw new Error('Loading failed');
        const result = await response.json() as Competition;
        if (!controller.signal.aborted) setCompetition(result);
      } catch {
        if (!controller.signal.aborted) setError('Could not load competition details. Please try again.');
      }
    })();
    return () => controller.abort();
  }, [competitionId, token, onUnauthorized, retry]);

  const nextStatus = competition ? competitionStatuses[competitionStatuses.indexOf(competition.status) + 1] : undefined;
  async function changeStatus(status: CompetitionStatus) {
    if (!competition || statusInProgress.current) return;
    const currentIndex = competitionStatuses.indexOf(competition.status);
    const targetIndex = competitionStatuses.indexOf(status);
    if (targetIndex === currentIndex || targetIndex > currentIndex + 1) return;
    if (targetIndex > currentIndex) {
      if (!validationReady) return;
      if (warnings.length > 0) {
        window.alert('All warnings must be resolved before transitioning to the next phase.');
        return;
      }
      if (status === 'Active') {
        const hasUncheckedParticipants = participantSnapshot?.data?.some((participant) => !participant.checkedIn);
        const message = 'Starting the competition will lock the competition participants.'
          + (hasUncheckedParticipants ? '\n\nWarning: Not all participants are checked in.' : '')
          + '\n\nStart competition?';
        if (!window.confirm(message)) return;
      }
      if (status === 'Closed') {
        const message = 'Closing the competition will lock all scores, disable all score entry access, and end the competition.'
          + '\n\nEnd competition?';
        if (!window.confirm(message)) return;
      }
    }
    statusInProgress.current = true; setChangingStatus(true); setStatusError('');
    try {
      const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(competition.id)}/status`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message ?? 'Could not update status. Please try again.');
      }
      const result = await response.json() as Competition & { qrCodes?: LaneQrCode[] };
      setCompetition(result);
      if (result.qrCodes) setQrCodes(result.qrCodes);
      if (status !== 'Active') setQrCodes([]);
    } catch (error) { setStatusError(error instanceof Error ? error.message : 'Could not update status. Please try again.'); }
    finally { statusInProgress.current = false; setChangingStatus(false); }
  }

  return <>
    {error ? <section className="panel"><p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </section> : !competition ? <p role="status">Loading competition details...</p> : <>
      <section className="competition-flow-strip" aria-label="Competition flow" aria-busy={changingStatus}>
        <div className="competition-flow-scroll">
          <ol className="competition-flow" aria-label="Competition flow">
            {competitionStatuses.map((status, index) => {
              const current = status === competition.status;
              const completed = index < competitionStatuses.indexOf(competition.status);
              return <li key={status} aria-current={current ? 'step' : undefined}
                className={completed ? 'completed' : undefined}>
                {completed ? <button type="button" className="competition-flow-back" aria-label={`Move back to ${status}`}
                  disabled={changingStatus} onClick={() => { void changeStatus(status); }}>
                  <span className="competition-flow-number" aria-hidden="true">{'\u2713'}</span>
                  <span className="competition-flow-label">{status}</span>
                </button> : <>
                  <span className="competition-flow-number" aria-hidden="true">{index + 1}</span>
                  <span className="competition-flow-label">{status}</span>
                </>}
              </li>;
            })}
          </ol>
        </div>
      </section>
      <div aria-live="polite">
        {warnings.length > 0 && <section className="competition-warnings" aria-labelledby="competition-warnings-title">
          <h3 id="competition-warnings-title">Competition warnings</h3>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>}
      </div>
      <section className="panel" aria-labelledby="competition-details-title" aria-busy={changingStatus}>
        <div className="section-header competition-details-header">
          <h3 id="competition-details-title">Details</h3>
          {(competition.status === 'Scheduled' || competition.status === 'Closed') && <div className="competition-details-toolbar">
            {competition.status === 'Scheduled' && <button ref={editButton} type="button" className="secondary" disabled={changingStatus} onClick={() => { setDetailsNotice(''); setDetailsAction('edit'); }}>Edit</button>}
            <button ref={removeButton} type="button" className="danger" disabled={changingStatus} onClick={() => { setDetailsNotice(''); setDetailsAction('remove'); }}>Remove</button>
          </div>}
        </div>
        {detailsNotice && <p className="success" role="status">{detailsNotice}</p>}
        <dl className="competition-details">
          <div><dt>Name</dt><dd>{competition.name}</dd></div>
          <div><dt>Date</dt><dd><time dateTime={competition.date}>{competition.date}</time></dd></div>
          <div><dt>Starting time</dt><dd>{competition.startingTime}</dd></div>
          <div><dt>Ending time</dt><dd>{competition.endingTime}</dd></div>
          <div><dt>Default target</dt><dd>{competition.defaultTargetType ?? 'None'}</dd></div>
          <div><dt>Range</dt><dd>{competition.range.name}</dd></div>
          <div><dt>Status</dt><dd><CompetitionStatusBadge status={competition.status} /></dd></div>
          <div><dt>Rounds</dt><dd>{competition.numberOfRounds}</dd></div>
          <div><dt>Arrows per round</dt><dd>{competition.arrowsPerRound}</dd></div>
        </dl>
        {statusError && <p className="error" role="alert">{statusError}</p>}
        {nextStatus && nextStatus !== 'Scheduled' && <div className="competition-details-actions">
          <button type="button" disabled={changingStatus || !validationReady} onClick={() => { void changeStatus(nextStatus); }}>
            {transitionLabels[nextStatus]}
          </button>
        </div>}
      </section>
      {detailsAction && <CompetitionDetailsModal key={`${competition.id}-${detailsAction}`} mode={detailsAction} competition={competition}
        token={token} onUnauthorized={onUnauthorized} onClose={closeDetailsModal}
        onSaved={(updated) => {
          if (updated.range.id !== competition.range.id) { setLaneSnapshot(undefined); setParticipantSnapshot(undefined); }
          setCompetition(updated); closeDetailsModal(); setDetailsNotice('Competition details saved.');
        }}
        onRemoved={() => { void navigate('/admin/competitions'); }} />}
      <ScoringSettings key={`scoring-settings-${competition.id}`} competition={competition} token={token}
        onUnauthorized={onUnauthorized} onChange={(settings) => setCompetition((current) => current ? { ...current, ...settings } : current)} />
      {competition.status === 'Active' && <LaneScoringCodes
        key={`scoring-codes-${competition.id}`} competitionId={competition.id} name={competition.name} status={competition.status}
        codes={qrCodes} onCodesChange={setQrCodes} token={token} onUnauthorized={onUnauthorized} />}
      <CompetitionLanes status={competition.status} onChange={onLanesChange} key={`${competition.id}-${competition.range.id}`} competitionId={competition.id} token={token} onUnauthorized={onUnauthorized} />
      <CompetitionParticipants defaultTargetType={competition.defaultTargetType} onChange={onParticipantsChange} status={competition.status} lanes={laneSnapshot?.data ?? []} key={`participants-${competition.id}-${competition.range.id}-${competition.status}`} competitionId={competition.id} token={token} onUnauthorized={onUnauthorized} />
    </>}
  </>;
}

function CompetitionLanes({ competitionId, token, onUnauthorized, onChange, status }: AuthProps & { competitionId: string; onChange: (lanes: Lane[] | null) => void; status: CompetitionStatus }) {
  const readOnly = status !== 'Scheduled';
  const [expanded, setExpanded] = useState(status === 'Scheduled' || status === 'Closed');
  useEffect(() => { setExpanded(status === 'Scheduled' || status === 'Closed'); }, [status]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [selectedLanes, setSelectedLanes] = useState<Set<string>>(() => new Set());
  const [bulkUpdate, setBulkUpdate] = useState<BulkLaneUpdate | null>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const options = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' as const, signal: controller.signal };
        const [response, typesResponse] = await Promise.all([
          fetch(`/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/lanes`, options),
          fetch('/api/v1/admin/target-types', options),
        ]);
        if (controller.signal.aborted) return;
        if (response.status === 401 || typesResponse.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok || !typesResponse.ok) throw new Error('Loading failed');
        const [result, types] = await Promise.all([response.json() as Promise<Lane[]>, typesResponse.json() as Promise<string[]>]);
        if (!controller.signal.aborted) {
          setLanes(result);
          setTargetTypes(types.sort((a, b) => a.localeCompare(b, 'nl', { numeric: true })));
        }
      } catch {
        if (!controller.signal.aborted) setError('Could not load lane configuration. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [competitionId, token, onUnauthorized, retry]);
  useEffect(() => { onChange(loading || error ? null : lanes); }, [lanes, loading, error, onChange]);
  const changeLane = useCallback((laneId: string, changes: LaneChanges) => {
    setLanes((current) => current.map((lane) => lane.laneId === laneId ? { ...lane, ...changes } : lane));
  }, []);
  const allSelected = lanes.length > 0 && selectedLanes.size === lanes.length;
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedLanes.size > 0 && !allSelected;
  }, [selectedLanes, allSelected, loading, error, readOnly]);

  function selectLane(laneId: string, selected: boolean) {
    setSelectedLanes((current) => {
      const next = new Set(current);
      if (selected) next.add(laneId); else next.delete(laneId);
      return next;
    });
  }
  function changeSelected(changes: LaneChanges) {
    setBulkUpdate({ laneIds: new Set(selectedLanes), changes });
  }

  return <section className="panel collapsible-panel" aria-labelledby="competition-lanes-title">
    <div className="section-header collapsible-panel-header">
      <h3 id="competition-lanes-title">Lanes</h3>
      <button type="button" className="panel-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} lanes`}
        aria-expanded={expanded} aria-controls="competition-lanes-content" onClick={() => setExpanded((value) => !value)}>
        <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </div>
    <div id="competition-lanes-content" className="collapsible-panel-content" hidden={!expanded}>
    {loading ? <p role="status">Loading lane configuration...</p> : error ? <>
      <p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </> : lanes.length === 0 ? <p>No lanes assigned.</p> : <>
      {!readOnly && selectedLanes.size > 0 && <div className="lane-bulk-controls" role="group" aria-label="Edit selected lanes">
        <p>Apply to selection</p>
        <select aria-label="Target type for selected lanes" value="" onChange={(event) => changeSelected({ targetType: (JSON.parse(event.target.value) as string | null) ?? '' })}>
            <option value="" disabled>Target type</option>
            <option value="null">Not configured</option>
            {targetTypes.map((type) => <option key={type} value={JSON.stringify(type)}>{type}</option>)}
        </select>
        <select aria-label="Number of targets for selected lanes" value="" onChange={(event) => changeSelected({ numberOfTargets: Number(event.target.value) })}>
            <option value="" disabled>Number of targets</option>
            {targetCounts.map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </div>}
      <div className="table-scroll">
        <table className="lane-configuration-table" aria-label="Lane configuration">
          <thead><tr>{!readOnly && <th scope="col"><label className="lane-selection">
            <input ref={selectAll} type="checkbox" aria-label="Select all lanes" checked={allSelected}
              onChange={(event) => setSelectedLanes(event.target.checked ? new Set(lanes.map((lane) => lane.laneId)) : new Set())} />
            Select all
          </label></th>}<th scope="col">Lane</th><th scope="col">Distance</th>
            <th scope="col">Target type</th><th scope="col">Number of targets</th></tr></thead>
          <tbody>{lanes.map((lane) =>
            <LaneConfiguration readOnly={readOnly} onChange={changeLane} key={lane.laneId} lane={lane} targetTypes={targetTypes} bulkUpdate={bulkUpdate}
              selected={selectedLanes.has(lane.laneId)} onSelect={(selected) => selectLane(lane.laneId, selected)} competitionId={competitionId} token={token} onUnauthorized={onUnauthorized} />)}</tbody>
        </table>
      </div>
    </>}
    </div>
  </section>;
}

function LaneConfiguration({ lane, targetTypes, bulkUpdate, selected, onSelect, competitionId, token, onUnauthorized, onChange, readOnly }: AuthProps & {
  readOnly: boolean;
  onChange: (laneId: string, changes: LaneChanges) => void;
  lane: Lane; targetTypes: string[]; bulkUpdate: BulkLaneUpdate | null;
  selected: boolean; onSelect: (selected: boolean) => void; competitionId: string;
}) {
  const [draft, setDraft] = useState({ targetType: lane.targetType ?? '', numberOfTargets: lane.numberOfTargets ?? 1 });
  const latestDraft = useRef(draft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const saves = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const save = useCallback((next: typeof draft) => {
    const version = ++revision.current;
    setPending(true);
    setError('');
    // Start immediately; serialize subsequent changes to preserve their order.
    // Queued writes finish even if the user navigates away.
    saves.current = saves.current.then(async () => {
      try {
        const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/lanes/${encodeURIComponent(lane.laneId)}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: next.targetType || null, numberOfTargets: next.numberOfTargets }),
        });
        if (response.status === 401) {
          if (mounted.current) onUnauthorized(expiredMessage);
          return;
        }
        if (!response.ok && mounted.current && version === revision.current) {
          setError('Could not save lane configuration. Your changes have been kept.');
        }
      } catch {
        if (mounted.current && version === revision.current) {
          setError('Could not reach the server. Your changes have been kept.');
        }
      } finally {
        if (mounted.current && version === revision.current) setPending(false);
      }
    });
  }, [competitionId, lane.laneId, token, onUnauthorized]);

  const change = useCallback((next: typeof draft) => {
    latestDraft.current = next;
    setDraft(next);
    onChange(lane.laneId, next);
    save(next);
  }, [save, lane.laneId, onChange]);

  useEffect(() => {
    if (bulkUpdate?.laneIds.has(lane.laneId)) change({ ...latestDraft.current, ...bulkUpdate.changes });
  }, [bulkUpdate, lane.laneId, change]);

  return <tr aria-label={`Lane ${lane.number} configuration`} aria-busy={pending} className={!readOnly && selected ? 'lane-selected' : undefined}>
    {!readOnly && <td><input className="lane-select-checkbox" type="checkbox" aria-label={`Select lane ${lane.number}`}
      checked={selected} onChange={(event) => onSelect(event.target.checked)} /></td>}
    <th scope="row">Lane {lane.number}</th>
    <td className="lane-distance">{lane.distanceMeters} m</td>
    <td>{readOnly ? draft.targetType || 'Not configured' : <select aria-label="Target type" id={`target-type-${lane.laneId}`} value={draft.targetType}
      onChange={(event) => change({ ...latestDraft.current, targetType: event.target.value })}>
      <option value="">Not configured</option>
      {draft.targetType && !targetTypes.includes(draft.targetType) && <option value={draft.targetType}>{draft.targetType}</option>}
      {targetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
    </select>}</td>
    <td>{readOnly ? draft.numberOfTargets : <select aria-label="Number of targets" id={`target-count-${lane.laneId}`} value={draft.numberOfTargets}
      aria-describedby={error ? `lane-error-${lane.laneId}` : undefined}
      onChange={(event) => change({ ...latestDraft.current, numberOfTargets: Number(event.target.value) })}>
      {!targetCounts.includes(draft.numberOfTargets) &&
        <option value={draft.numberOfTargets} disabled>{draft.numberOfTargets} (choose 1-2)</option>}
      {targetCounts.map((count) => <option key={count} value={count}>{count}</option>)}
    </select>}
      {error && <div className="lane-save-error">
        <p id={`lane-error-${lane.laneId}`} className="error" role="alert">{error}</p>
        <button type="button" className="secondary retry-button" disabled={readOnly} onClick={() => save(latestDraft.current)}>Try again</button>
      </div>}
    </td>
  </tr>;
}
