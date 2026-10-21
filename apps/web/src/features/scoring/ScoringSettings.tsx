import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useRef, useState } from 'react';
import { ScoringStandings } from './ScoringStandings';

interface Settings { scoringLocked: boolean }
export function ScoringSettings({ competition, token, onUnauthorized, onChange }: {
  competition: Settings & { id: string; status: string }; token: string;
  onUnauthorized: (message: string) => void; onChange: (settings: Partial<Settings>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const panel = useRef<HTMLElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    function onFullscreenChange() {
      const active = document.fullscreenElement === panel.current;
      setFullscreen(active);
      if (!active) fullscreenButton.current?.focus();
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setFullscreenError(t('ScoringSettings.fullscreen_failed'));
    }
  }
  async function updateLock() {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const response = await managementRequest(`/api/v1/admin/competitions/${competition.id}/scoring-lock`, token, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoringLocked: !competition.scoringLocked }),
      });
      if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_log_opnieuw_in")); return; }
      const result = await response.json() as Settings & { message?: string };
      if (!response.ok) throw new Error(result.message ?? t("ScoringSettings.could_not_save_scoring_settings"));
      onChange({ scoringLocked: result.scoringLocked });
      setNotice(result.scoringLocked ? t("ScoringSettings.scoring_paused") : t("ScoringSettings.scoring_resumed"));
    } catch (err) { setError(err instanceof Error ? err.message : t("ScoringSettings.could_not_save_scoring_settings")); }
    finally { setPending(false); }
  }
  if (competition.status !== 'Active' && competition.status !== 'Closed') return null;
  const fullscreenLabel = t(fullscreen ? 'ScoringSettings.exit_fullscreen' : 'ScoringSettings.enter_fullscreen');
  return <section ref={panel} className="panel live-score-panel" aria-labelledby="scoring-settings-title">
    <div className="section-header live-score-header">
      <h3 id="scoring-settings-title">{t("ScoringSettings.scoring")}</h3>
    </div>
    <div className="section-header live-score-toolbar">
      {competition.status === 'Active' && <p className="live-score-controls">{competition.scoringLocked ? t("ScoringPage.score_entry_is_paused") : t("ScoringSettings.score_entry_is_open")}</p>}
      <div className="live-score-actions">
        {competition.status === 'Active' && <button className="secondary live-score-controls" disabled={pending} onClick={() => { void updateLock(); }}>
          {competition.scoringLocked ? t("ScoringSettings.resume_scoring") : t("ScoringSettings.pause_scoring")}
        </button>}
      <button ref={fullscreenButton} type="button" className="secondary live-score-fullscreen-button"
        aria-label={fullscreenLabel} title={fullscreenLabel} aria-pressed={fullscreen}
        onClick={() => { void toggleFullscreen(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={fullscreen ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
        </svg>
      </button>
      </div>
    </div>
    <ScoringStandings key={competition.id} competitionId={competition.id} token={token} onUnauthorized={onUnauthorized}
      showAssignment={competition.status === 'Active'} />
    {fullscreenError && <p className="error" role="alert">{message(fullscreenError)}</p>}
    {error && <p className="error" role="alert">{message(error)}</p>}
    {notice && <p className="success" role="status">{message(notice)}</p>}
  </section>;
}
