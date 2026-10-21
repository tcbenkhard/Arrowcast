import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
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

const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';
const statusOrder: Record<CompetitionStatus, number> = { Active: 0, 'Check-in': 1, Scheduled: 2, Closed: 3 };

function compareCompetitions(a: Competition, b: Competition) {
  return statusOrder[a.status] - statusOrder[b.status]
    || a.date.localeCompare(b.date)
    || a.startingTime.localeCompare(b.startingTime)
    || a.id.localeCompare(b.id);
}

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
        const response = await managementRequest('/api/v1/admin/competitions', token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
        if (!response.ok) throw new Error(t("CompetitionDetailPage.loading_failed"));
        const result = await response.json() as Competition[];
        if (!controller.signal.aborted) setCompetitions(result.sort(compareCompetitions));
      } catch {
        if (!controller.signal.aborted) setError(t("CompetitionsPage.could_not_load_competitions_check_your_connection_and_try"));
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
      <div><h2>{t("AdminPage.competitions")}</h2><p className="muted">{t("CompetitionsPage.schedule_competitions_and_assign_lanes_and_distances")}</p></div>
      <button ref={addButton} onClick={() => { setNotice(''); setAdding(true); }} disabled={loading || !!error}>{t("CompetitionsPage.add")}</button>
    </div>
    {notice && <p className="success" role="status">{message(notice)}</p>}
    {loading ? <p role="status">{t("CompetitionsPage.loading_competitions")}</p> : error ? <div>
      <p className="error" role="alert">{message(error)}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button>
    </div> : competitions.length === 0 ? <div className="empty-state">
      <h3>{t("CompetitionsPage.no_competitions_yet")}</h3><p>{t("CompetitionsPage.add_your_first_competition_to_schedule_its_range_and")}</p>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">{t("CompetitionDetailPage.name")}</th><th scope="col">{t("CompetitionDetailPage.date")}</th><th scope="col">{t("CompetitionsPage.time")}</th>
        <th scope="col">{t("CompetitionDetailPage.range")}</th><th scope="col">{t("CompetitionDetailPage.status")}</th></tr></thead>
      <tbody>{competitions.map((competition) => <tr key={competition.id}>
        <th scope="row"><Link to={`/admin/competitions/${competition.id}`}>{competition.name}</Link></th>
        <td><time dateTime={competition.date}>{competition.date}</time></td>
        <td>{competition.startingTime} – {competition.endingTime}</td>
        <td>{competition.range.name}</td><td><CompetitionStatusBadge status={competition.status} /></td>
      </tr>)}</tbody>
    </table></div>}
    {adding && <AddCompetitionModal token={token} onUnauthorized={onUnauthorized} onClose={closeModal}
      onCreated={(competition) => {
        setCompetitions((current) => [...current, competition].sort(compareCompetitions));
        setNotice(t("CompetitionsPage.competition_added", { p0: competition.name }));
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
  const [numberOfRounds, setNumberOfRounds] = useState(10);
  const [arrowsPerRound, setArrowsPerRound] = useState(3);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [rangeId, setRangeId] = useState('');
  const [targetTypes, setTargetTypes] = useState<string[]>([]);
  const [defaultTargetType, setDefaultTargetType] = useState('');
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
        const responses = await Promise.all(['/api/v1/admin/ranges', '/api/v1/admin/target-types'].map((url) => managementRequest(url, token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })));
        if (controller.signal.aborted) return;
        if (responses.some((response) => response.status === 401)) { onUnauthorized(t(expiredMessage)); return; }
        if (responses.some((response) => !response.ok)) throw new Error(t("CompetitionDetailPage.loading_failed"));
        const [loadedRanges, loadedTargets] = await Promise.all(responses.map((response) => response.json()));
        if (!controller.signal.aborted) { setRanges(loadedRanges as Range[]); setTargetTypes(loadedTargets as string[]); }
      } catch {
        if (!controller.signal.aborted) setLoadError(t("CompetitionDetailsModal.could_not_load_ranges_and_target_types_please_try"));
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
    if (!name.trim()) { setError(t("CompetitionDetailsModal.enter_a_competition_name")); return; }
    if (endingTime <= startingTime) { setError(t("CompetitionDetailsModal.ending_time_must_be_after_starting_time_on_the")); return; }
    const selectedLanes = Object.entries(assignments).map(([laneId, distanceMeters]) => ({ laneId, distanceMeters }));
    if (!range || selectedLanes.length === 0) { setError(t('competition.selectRangeLane')); return; }
    setPending(true);
    try {
      const response = await managementRequest('/api/v1/admin/competitions', token, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), date, startingTime, endingTime, rangeId,
          numberOfRounds, arrowsPerRound, defaultTargetType: defaultTargetType || null, lanes: selectedLanes }),
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      if (!response.ok) {
        setError(response.status === 400 ? t("CompetitionsPage.check_the_date_times_range_and_lane_distances_and")
          : t("CompetitionsPage.could_not_save_the_competition_please_try_again"));
        return;
      }
      onCreated(await response.json() as Competition);
    } catch {
      setError(t("CompetitionsPage.could_not_reach_the_server_your_input_has_been"));
    } finally {
      setPending(false);
    }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="add-competition-title">
    <h2 id="add-competition-title">{t("CompetitionsPage.add_competition")}</h2>
    <p className="muted">{t("CompetitionsPage.choose_a_range_and_assign_a_distance_to_each")}</p>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label htmlFor="competition-name">{t("CompetitionDetailPage.name")}</label>
        <input id="competition-name" autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="competition-date">{t("CompetitionDetailPage.date")}</label>
        <input id="competition-date" type="date" required min="0001-01-01" max="9999-12-31" value={date} onChange={(event) => setDate(event.target.value)} />
        <div className="competition-form-row">
          <div className="competition-form-field">
            <label htmlFor="competition-start">{t("CompetitionDetailPage.starting_time")}</label>
            <input id="competition-start" type="time" required value={startingTime} onChange={(event) => setStartingTime(event.target.value)} />
          </div>
          <div className="competition-form-field">
            <label htmlFor="competition-end">{t("CompetitionDetailPage.ending_time")}</label>
            <input id="competition-end" type="time" required value={endingTime} onChange={(event) => setEndingTime(event.target.value)} />
          </div>
        </div>
        <div className="competition-form-row">
          <div className="competition-form-field">
            <label htmlFor="competition-rounds">{t("CompetitionDetailsModal.number_of_rounds")}</label>
            <input id="competition-rounds" type="number" required min={1} max={1000} value={numberOfRounds}
              onChange={(event) => setNumberOfRounds(Number(event.target.value))} />
          </div>
          <div className="competition-form-field">
            <label htmlFor="competition-arrows">{t("CompetitionDetailPage.arrows_per_round")}</label>
            <input id="competition-arrows" type="number" required min={1} max={36} value={arrowsPerRound}
              onChange={(event) => setArrowsPerRound(Number(event.target.value))} />
          </div>
        </div>
        {loading ? <p role="status">{t("CompetitionsPage.loading_ranges")}</p> : loadError ? <div>
          <p className="error" role="alert">{message(loadError)}</p>
          <button type="button" className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button>
        </div> : ranges.length === 0 ? <p role="status">{t("CompetitionsPage.create_a_range_in_settings_before_adding_a_competition")}</p> : <>
          <label htmlFor="competition-default-target">{t("CompetitionDetailPage.default_target")}</label>
          <select id="competition-default-target" value={defaultTargetType} onChange={(event) => setDefaultTargetType(event.target.value)}>
            <option value="">{t("CompetitionDetailsModal.no_default_target")}</option>
            {targetTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <label htmlFor="competition-range">{t("CompetitionDetailPage.range")}</label>
          <select id="competition-range" required value={rangeId} onChange={(event) => {
            setRangeId(event.target.value); setAssignments({});
          }}>
            <option value="">{t("CompetitionsPage.select_a_range")}</option>
            {ranges.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}
          </select>
          {range && <fieldset className="competition-lanes"><legend>{t("CompetitionDetailsModal.lanes_and_distances")}</legend>
            <p className="muted">{t("CompetitionDetailsModal.choose_a_distance_to_include_a_lane_leave_unused")}</p>
            <div className="distance-list" role="group" aria-label={t("CompetitionDetailsModal.set_distance_for_all_lanes")}>
              <span>{t("CompetitionDetailsModal.set_all_lanes_to")}</span>
              {range.supportedDistancesMeters.map((distance) => <button key={distance} type="button"
                className="distance-link" aria-label={t("CompetitionDetailsModal.set_all_lanes_to_m", { p0: distance })}
                onClick={() => setAssignments(Object.fromEntries(range.lanes.map((lane) => [lane.id, distance])))}>
                {distance} {t("CompetitionDetailPage.m")}</button>)}
            </div>
            {range.lanes.map((lane) => <div className="lane-assignment" key={lane.id}>
              <label htmlFor={`lane-${lane.id}`}>{t("CompetitionDetailPage.lane")} {lane.number}</label>
              <select id={`lane-${lane.id}`} value={assignments[lane.id] ?? ''} onChange={(event) => {
                const value = event.target.value;
                setAssignments((current) => {
                  const next = { ...current };
                  if (value) next[lane.id] = Number(value); else delete next[lane.id];
                  return next;
                });
              }}>
                <option value="">{t("CompetitionDetailsModal.not_assigned")}</option>
                {range.supportedDistancesMeters.map((distance) => <option key={distance} value={distance}>{distance} {t("CompetitionDetailPage.m")}</option>)}
              </select>
            </div>)}
          </fieldset>}
        </>}
      </fieldset>
      {error && <p className="error" role="alert">{message(error)}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={pending}>{t("PasswordChangeForm.cancel")}</button>
        <button type="submit" disabled={pending || loading || !!loadError || ranges.length === 0}>{pending ? t("CompetitionsPage.saving") : t("CompetitionsPage.add_competition")}</button>
      </div>
    </form>
  </dialog>;
}

