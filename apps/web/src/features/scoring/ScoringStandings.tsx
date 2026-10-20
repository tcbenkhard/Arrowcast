import { useEffect, useState } from 'react';
import type { ScoringStanding } from '@arrowcast/contracts';

export function ScoringStandings({ competitionId, token, onUnauthorized }: {
  competitionId: string; token: string; onUnauthorized: (message: string) => void;
}) {
  const [standings, setStandings] = useState<ScoringStanding[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch(`/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/scoring-standings`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { onUnauthorized('Je sessie is verlopen. Log opnieuw in.'); return; }
        if (!response.ok) throw new Error('Loading failed');
        const result = await response.json() as ScoringStanding[];
        if (!controller.signal.aborted) { setStandings(result); setError(''); }
      } catch {
        if (!controller.signal.aborted) setError('Could not refresh scores. Please try again.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 5000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [competitionId, token, onUnauthorized, retry]);
  return <>
    {error && <div><p className="error" role="alert">{error}</p>
      <button className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    {!standings ? <p role="status">Loading scores...</p> : standings.length === 0 ? <p>No participants assigned.</p> : <>
      <div className="table-scroll"><table aria-label="Scoring standings">
        <thead><tr><th scope="col">Participant</th><th scope="col">Round</th>
          <th scope="col">Total score</th><th scope="col" aria-sort="descending">Average score</th></tr></thead>
        <tbody>{standings.map((person) => <tr key={person.participantId}>
          <th scope="row">{person.name}</th><td>{person.enteredRounds}/{person.totalRounds}</td>
          <td>{person.totalScore}</td><td>{person.averageScore.toFixed(2)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </>;
}
