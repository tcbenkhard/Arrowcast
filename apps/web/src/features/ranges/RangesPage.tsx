import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
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

const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

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
        const response = await managementRequest('/api/v1/admin/ranges', token, {
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
        const result = (await response.json()) as Range[];
        if (!controller.signal.aborted) setRanges(result);
      } catch {
        if (!controller.signal.aborted) setError(t('RangesPage.could_not_load_ranges_check_your_connection_and_try'));
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

  return (
    <SettingsCard id="ranges" title={t('RangesPage.ranges')}>
      <div className="section-header">
        <p className="muted">{t('RangesPage.manage_your_shooting_ranges_distances_and_lanes')}</p>
        <button
          ref={addButton}
          onClick={() => {
            setNotice('');
            setAdding(true);
          }}
          disabled={loading || !!error}
        >
          {t('CompetitionsPage.add')}
        </button>
      </div>
      {notice && (
        <p className="success" role="status">
          {message(notice)}
        </p>
      )}
      {loading ? (
        <p role="status">{t('CompetitionsPage.loading_ranges')}</p>
      ) : error ? (
        <div>
          <p className="error" role="alert">
            {message(error)}
          </p>
          <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </div>
      ) : ranges.length === 0 ? (
        <div className="empty-state">
          <h3>{t('RangesPage.no_ranges_yet')}</h3>
          <p>{t('RangesPage.add_your_first_range_to_set_up_its_distances')}</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('CompetitionDetailPage.name')}</th>
                <th scope="col">{t('RangesPage.supported_distances')}</th>
                <th scope="col">{t('CompetitionDetailPage.lanes')}</th>
              </tr>
            </thead>
            <tbody>
              {ranges.map((range) => (
                <tr key={range.id}>
                  <th scope="row">{range.name}</th>
                  <td>
                    <div className="distance-list">
                      {range.supportedDistancesMeters.map((distance) => (
                        <span className="distance-badge" key={distance}>
                          {distance} {t('CompetitionDetailPage.m')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <strong>
                      {range.lanes.length} {t('RangesPage.lanes')}
                    </strong>
                    <div className="lane-numbers muted">{range.lanes.map((lane) => lane.number).join(', ')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <AddRangeModal
          token={token}
          onUnauthorized={onUnauthorized}
          onClose={closeModal}
          onCreated={(range) => {
            setRanges((current) => [...current, range].sort((a, b) => a.name.localeCompare(b.name)));
            setNotice(t('RangesPage.range_added', { p0: range.name }));
            closeModal();
          }}
        />
      )}
    </SettingsCard>
  );
}

function parseLaneNumbers(value: string): number[] {
  const numbers: number[] = [];
  for (const part of value.split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
    if (!match) throw new Error(t('RangesPage.enter_lane_numbers_such_as_111_or_1_3'));
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > 2147483647 || end < start || numbers.length + end - start + 1 > 1000) {
      throw new Error(t('RangesPage.use_1_to_1000_lanes_with_positive_whole_numbers'));
    }
    for (let number = start; number <= end; number++) numbers.push(number);
  }
  if (new Set(numbers).size !== numbers.length)
    throw new Error(t('RangesPage.lane_numbers_must_be_unique_within_the_range'));
  return numbers;
}

function AddRangeModal({
  token,
  onUnauthorized,
  onClose,
  onCreated,
}: AuthProps & {
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
      if (!name.trim()) throw new Error(t('RangesPage.enter_a_range_name'));
      if (
        supportedDistancesMeters.length > 100 ||
        supportedDistancesMeters.some((distance) => !Number.isFinite(distance) || distance <= 0) ||
        new Set(supportedDistancesMeters).size !== supportedDistancesMeters.length
      ) {
        throw new Error(t('RangesPage.enter_1_to_100_unique_positive_distances_separated_by'));
      }
      numbers = parseLaneNumbers(laneNumbers);
    } catch (issue) {
      setError((issue as Error).message);
      return;
    }
    setPending(true);
    try {
      const response = await managementRequest('/api/v1/admin/ranges', token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          supportedDistancesMeters,
          lanes: numbers.map((number) => ({ number })),
        }),
      });
      if (response.status === 401) {
        onUnauthorized(t(expiredMessage));
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 400
            ? t('RangesPage.check_the_name_distances_and_lane_numbers_and_try')
            : t('RangesPage.could_not_save_the_range_please_try_again'),
        );
        return;
      }
      onCreated((await response.json()) as Range);
    } catch {
      setError(t('CompetitionsPage.could_not_reach_the_server_your_input_has_been'));
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog ref={dialog} className="range-modal" aria-labelledby="add-range-title">
      <h2 id="add-range-title">{t('RangesPage.add_range')}</h2>
      <p className="muted">{t('RangesPage.set_up_a_shooting_range_and_its_physical_lanes')}</p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-busy={pending}
      >
        <fieldset disabled={pending}>
          <label htmlFor="range-name">{t('CompetitionDetailPage.name')}</label>
          <input
            id="range-name"
            autoFocus
            required
            maxLength={100}
            placeholder={t('RangesPage.indoor')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor="range-distances">{t('RangesPage.supported_distances_meters')}</label>
          <input
            id="range-distances"
            required
            placeholder="18, 25"
            aria-describedby="distance-help"
            value={distances}
            onChange={(event) => setDistances(event.target.value)}
          />
          <small id="distance-help" className="muted">
            {t('RangesPage.separate_distances_with_commas_all_lanes_support_these_distances')}
          </small>
          <label htmlFor="range-lanes">{t('RangesPage.lane_numbers')}</label>
          <input
            id="range-lanes"
            required
            placeholder="1-11"
            aria-describedby="lane-help"
            value={laneNumbers}
            onChange={(event) => setLaneNumbers(event.target.value)}
          />
          <small id="lane-help" className="muted">
            {t('RangesPage.use_a_sequence_like_111_individual_numbers_like_1')}
          </small>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {message(error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={pending}>
            {t('PasswordChangeForm.cancel')}
          </button>
          <button type="submit" disabled={pending}>
            {pending ? t('CompetitionsPage.saving') : t('RangesPage.add_range')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
