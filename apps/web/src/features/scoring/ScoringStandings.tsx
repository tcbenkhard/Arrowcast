import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useState } from 'react';
import type { ScoringStanding } from '@arrowcast/contracts';

export function ScoringStandings({ competitionId, token, onUnauthorized, showAssignment = false }: {
  competitionId: string; token: string; onUnauthorized: (message: string) => void; showAssignment?: boolean;
}) {
  const [standings, setStandings] = useState<ScoringStanding[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await managementRequest(`/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/scoring-standings`, token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
        if (!response.ok) throw new Error(t("CompetitionDetailPage.loading_failed"));
        const result = await response.json() as ScoringStanding[];
        if (!controller.signal.aborted) { setStandings(result); setError(''); }
      } catch {
        if (!controller.signal.aborted) setError(t("ScoringStandings.could_not_refresh_scores_please_try_again"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 5000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [competitionId, token, onUnauthorized, retry]);
  return <>
    {error && <div><p className="error" role="alert">{message(error)}</p>
      <button className="secondary" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button></div>}
    {!standings ? <p role="status">{t("ScoringStandings.loading_scores")}</p> : standings.length === 0 ? <p>{t("ScoringStandings.no_participants_assigned")}</p> : <>
      <div className="table-scroll"><table aria-label={t("ScoringStandings.scoring_standings")}>
        <thead><tr><th scope="col">{t("ScoringStandings.participant")}</th>
          {showAssignment && <th scope="col">{t("CompetitionParticipants.assignment")}</th>}
          <th scope="col">{t("ScoringPage.round")}</th>
          <th scope="col">{t("ScoringStandings.total_score")}</th><th scope="col" aria-sort="descending">{t("ScoringStandings.average_score")}</th></tr></thead>
        <tbody>{standings.map((person) => <tr key={person.participantId}>
          <th scope="row">{person.name}</th>
          {showAssignment && <td>{person.laneNumber != null && person.targetLetter
            ? `${person.laneNumber} ${person.targetLetter}` : '\u2014'}</td>}
          <td>{person.enteredRounds}/{person.totalRounds}</td>
          <td>{person.totalScore}</td><td>{person.averageScore.toFixed(2)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </>;
}
