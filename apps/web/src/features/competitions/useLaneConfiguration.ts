import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import type { BulkLaneUpdate, Lane, LaneChanges } from './lane-configuration';

const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function useLaneConfiguration({
  lane,
  bulkUpdate,
  competitionId,
  token,
  onUnauthorized,
  onChange,
}: {
  lane: Lane;
  bulkUpdate: BulkLaneUpdate | null;
  competitionId: string;
  token: string;
  onUnauthorized: (message: string) => void;
  onChange: (laneId: string, changes: LaneChanges) => void;
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
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(
    (next: typeof draft) => {
      const version = ++revision.current;
      setPending(true);
      setError('');
      // Start immediately; serialize subsequent changes to preserve their order.
      // Queued writes finish even if the user navigates away.
      saves.current = saves.current.then(async () => {
        try {
          const response = await managementRequest(
            `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/lanes/${encodeURIComponent(lane.laneId)}`,
            token,
            {
              method: 'PUT',
              json: { targetType: next.targetType || null, numberOfTargets: next.numberOfTargets },
            },
          );
          if (response.status === 401) {
            if (mounted.current) onUnauthorized(t(expiredMessage));
            return;
          }
          if (!response.ok && mounted.current && version === revision.current) {
            setError(t('CompetitionDetailPage.could_not_save_lane_configuration_your_changes_have_been'));
          }
        } catch {
          if (mounted.current && version === revision.current) {
            setError(t('CompetitionDetailPage.could_not_reach_the_server_your_changes_have_been'));
          }
        } finally {
          if (mounted.current && version === revision.current) setPending(false);
        }
      });
    },
    [competitionId, lane.laneId, token, onUnauthorized],
  );

  const change = useCallback(
    (changes: LaneChanges) => {
      const next = { ...latestDraft.current, ...changes };
      latestDraft.current = next;
      setDraft(next);
      onChange(lane.laneId, next);
      save(next);
    },
    [save, lane.laneId, onChange],
  );

  useEffect(() => {
    if (bulkUpdate?.laneIds.has(lane.laneId)) change(bulkUpdate.changes);
  }, [bulkUpdate, lane.laneId, change]);

  return { draft, pending, error, change, retry: () => save(latestDraft.current) };
}
