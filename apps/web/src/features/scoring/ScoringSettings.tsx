import { useEffect, useRef, useState } from 'react';
import { ArrowCastLogo } from '../../components/ArrowCastLogo';
import { message, t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { ScoringStandings } from './ScoringStandings';

interface Settings {
  scoringLocked: boolean;
}
export function ScoringSettings({
  competition,
  token,
  onUnauthorized,
  onChange,
}: {
  competition: Settings & { id: string; status: string };
  token: string;
  onUnauthorized: (message: string) => void;
  onChange: (settings: Partial<Settings>) => void;
}) {
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  useEffect(() => {
    const element = panel.current;
    if (!fullscreen || !element) return;

    const pixelsPerSecond = 28;
    const pauseMilliseconds = 3000;
    let position = 0;
    let direction = 1;
    let previousTime = performance.now();
    let pauseUntil = previousTime + pauseMilliseconds;
    let frame: number;
    element.scrollTo({ top: 0, behavior: 'instant' });
    let lastScrollTop = element.scrollTop;

    function pauseForManualScroll() {
      if (!element) return;
      position = element.scrollTop;
      lastScrollTop = position;
      pauseUntil = performance.now() + pauseMilliseconds;
      if (position <= 0) direction = 1;
      else if (position >= element.scrollHeight - element.clientHeight) direction = -1;
    }

    function onScroll() {
      // Our own animation also fires scroll events; only pause for a different position.
      if (element && Math.abs(element.scrollTop - lastScrollTop) > 0.5) pauseForManualScroll();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        pauseForManualScroll();
      }
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    element.addEventListener('wheel', pauseForManualScroll, { passive: true });
    element.addEventListener('touchmove', pauseForManualScroll, { passive: true });
    element.addEventListener('keydown', onKeyDown);

    function scroll(time: number) {
      if (!element || document.fullscreenElement !== element) return;
      onScroll();
      // Cap elapsed time so returning from a background tab cannot jump through the scores.
      const elapsed = Math.min(time - previousTime, 100);
      previousTime = time;
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
      if (bottom === 0) {
        position = 0;
        direction = 1;
        pauseUntil = time + pauseMilliseconds;
      } else if (time >= pauseUntil) {
        // Keep fractional pixels so slow scrolling is consistent across refresh rates.
        position = Math.max(0, Math.min(bottom, position + (direction * pixelsPerSecond * elapsed) / 1000));
        element.scrollTo({ top: position, behavior: 'instant' });
        lastScrollTop = element.scrollTop;
        if ((direction === 1 && position === bottom) || (direction === -1 && position === 0)) {
          direction *= -1;
          pauseUntil = time + pauseMilliseconds;
        }
      }
      frame = requestAnimationFrame(scroll);
    }

    frame = requestAnimationFrame(scroll);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('wheel', pauseForManualScroll);
      element.removeEventListener('touchmove', pauseForManualScroll);
      element.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen, competition.id]);
  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === panel.current) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch {
      setFullscreenError(t('ScoringSettings.fullscreen_failed'));
    }
  }
  async function downloadResults() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      const response = await managementRequest(
        `/api/v1/admin/competitions/${encodeURIComponent(competition.id)}/results-export`,
        token,
      );
      if (response.status === 401) {
        onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in'));
        return;
      }
      if (!response.ok) throw new Error(t('ScoringSettings.export_failed'));
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ? decodeURIComponent(filename) : 'results.xls';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(t('ScoringSettings.export_failed'));
    } finally {
      setExporting(false);
    }
  }
  async function updateLock() {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await managementRequest(`/api/v1/admin/competitions/${competition.id}/scoring-lock`, token, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoringLocked: !competition.scoringLocked }),
      });
      if (response.status === 401) {
        onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in'));
        return;
      }
      const result = (await response.json()) as Settings & { message?: string };
      if (!response.ok) throw new Error(result.message ?? t('ScoringSettings.could_not_save_scoring_settings'));
      onChange({ scoringLocked: result.scoringLocked });
      setNotice(result.scoringLocked ? t('ScoringSettings.scoring_paused') : t('ScoringSettings.scoring_resumed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ScoringSettings.could_not_save_scoring_settings'));
    } finally {
      setPending(false);
    }
  }
  if (competition.status !== 'Active' && competition.status !== 'Closed') return null;
  const fullscreenLabel = t(fullscreen ? 'ScoringSettings.exit_fullscreen' : 'ScoringSettings.enter_fullscreen');
  return (
    <section ref={panel} className="panel live-score-panel" aria-labelledby="scoring-settings-title">
      <div className="section-header live-score-header">
        <div className="live-score-logo">
          <ArrowCastLogo />
        </div>
        <h3 id="scoring-settings-title">
          {t(competition.status === 'Closed' ? 'ScoringSettings.results' : 'ScoringSettings.scoring')}
        </h3>
      </div>
      <div className="section-header live-score-toolbar">
        {competition.status === 'Active' && (
          <p className="live-score-controls">
            {competition.scoringLocked
              ? t('ScoringPage.score_entry_is_paused')
              : t('ScoringSettings.score_entry_is_open')}
          </p>
        )}
        <div className="live-score-actions">
          {competition.status === 'Closed' && (
            <button
              type="button"
              className="secondary live-score-controls"
              disabled={exporting}
              onClick={() => {
                void downloadResults();
              }}
            >
              {t('ScoringSettings.export_results')}
            </button>
          )}
          {competition.status === 'Active' && (
            <button
              className="secondary live-score-controls"
              disabled={pending}
              onClick={() => {
                void updateLock();
              }}
            >
              {competition.scoringLocked ? t('ScoringSettings.resume_scoring') : t('ScoringSettings.pause_scoring')}
            </button>
          )}
          <button
            ref={fullscreenButton}
            type="button"
            className="secondary live-score-fullscreen-button"
            aria-label={fullscreenLabel}
            title={fullscreenLabel}
            aria-pressed={fullscreen}
            onClick={() => {
              void toggleFullscreen();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={fullscreen ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
            </svg>
          </button>
        </div>
      </div>
      <ScoringStandings
        key={competition.id}
        competitionId={competition.id}
        token={token}
        onUnauthorized={onUnauthorized}
        showAssignment={competition.status === 'Active'}
      />
      {fullscreenError && (
        <p className="error" role="alert">
          {message(fullscreenError)}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {message(error)}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {message(notice)}
        </p>
      )}
    </section>
  );
}
