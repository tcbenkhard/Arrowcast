import { useState } from 'react';
import { ScoringStandings } from './ScoringStandings';

interface Settings { scoringLocked: boolean }
export function ScoringSettings({ competition, token, onUnauthorized, onChange }: {
  competition: Settings & { id: string; status: string }; token: string;
  onUnauthorized: (message: string) => void; onChange: (settings: Partial<Settings>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function updateLock() {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/v1/admin/competitions/${competition.id}/scoring-lock`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoringLocked: !competition.scoringLocked }),
      });
      if (response.status === 401) { onUnauthorized('Je sessie is verlopen. Log opnieuw in.'); return; }
      const result = await response.json() as Settings & { message?: string };
      if (!response.ok) throw new Error(result.message ?? 'Could not save scoring settings.');
      onChange({ scoringLocked: result.scoringLocked });
      setNotice(result.scoringLocked ? 'Scoring paused.' : 'Scoring resumed.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save scoring settings.'); }
    finally { setPending(false); }
  }
  if (competition.status !== 'Active' && competition.status !== 'Closed') return null;
  return <section className="panel" aria-labelledby="scoring-settings-title">
    <h3 id="scoring-settings-title">Scoring</h3>
    {competition.status === 'Active' && <div className="section-header">
      <p>{competition.scoringLocked ? 'Score entry is paused.' : 'Score entry is open.'}</p>
      <button className="secondary" disabled={pending} onClick={() => { void updateLock(); }}>
        {competition.scoringLocked ? 'Resume scoring' : 'Pause scoring'}
      </button>
    </div>}
    <ScoringStandings key={competition.id} competitionId={competition.id} token={token} onUnauthorized={onUnauthorized} />
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
  </section>;
}
