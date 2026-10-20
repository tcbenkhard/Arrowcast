import { useEffect, useRef, useState } from 'react';
import { TargetTypesPage } from '../target-types/TargetTypesPage';
import { RangesPage } from '../ranges/RangesPage';
import { SettingsCard } from './SettingsCard';
import { ArrowcastHostname } from './ArrowcastHostname';
import { Updates } from './Updates';

interface ImportState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: string | null;
  result: { season: string; participants: number; clubs: number } | null;
  error: string | null;
}

export function SettingsPage({ token, onUnauthorized }: {
  token: string;
  onUnauthorized: (message: string) => void;
}) {
  const [state, setState] = useState<ImportState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const starting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/v1/admin/participants/import', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized('Je sessie is verlopen of ongeldig. Log opnieuw in.'); return; }
        if (!response.ok) throw new Error('Status unavailable');
        const result = await response.json() as ImportState;
        if (controller.signal.aborted) return;
        setState(result); setError('');
        if (result.status === 'running') timer = setTimeout(() => { void refresh(); }, 1500);
      } catch {
        if (!controller.signal.aborted) setError('De importstatus kon niet worden opgehaald. Controleer de verbinding en probeer opnieuw.');
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, onUnauthorized, retry]);

  async function startImport() {
    if (starting.current || state?.status === 'running') return;
    starting.current = true;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/v1/admin/participants/import', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onUnauthorized('Je sessie is verlopen of ongeldig. Log opnieuw in.'); return; }
      if (!response.ok && response.status !== 409) throw new Error('Import start failed');
      setState({ status: 'running', progress: 'De import wordt gestart.', result: null, error: null });
      setRetry((value) => value + 1);
    } catch {
      setError('De import kon niet worden gestart. Controleer de importstatus voordat je opnieuw probeert.');
    } finally {
      starting.current = false; setPending(false);
    }
  }

  const running = state?.status === 'running';
  return <section className="settings-page" aria-labelledby="settings-heading">
    <h2 id="settings-heading">Settings</h2>
    <div className="settings-cards">
      <ArrowcastHostname />
      <Updates token={token} onUnauthorized={onUnauthorized} />
      <SettingsCard id="participant-import" title="Deelnemers importeren">
        <p>Importeer deelnemers en verenigingen uit de nieuwste regiocompetities van Handboogsport.
          Bestaande deelnemers worden bijgewerkt. De import kan enkele minuten duren en gaat door als je deze pagina verlaat.</p>
        <button disabled={!state || pending || running || !!error} onClick={() => { void startImport(); }}>
          Importeer deelnemers uit handboogsport
        </button>
        {(!state && !error) && <p role="status">Importstatus ophalen...</p>}
        {(running || pending) && <p role="status" aria-live="polite">Bezig met importeren... {state?.progress}</p>}
        {state?.status === 'completed' && state.result && <p className="success" role="status">
          Import voltooid ({state.result.season}): {state.result.participants} deelnemers en {state.result.clubs} verenigingen opgeslagen.
        </p>}
        {state?.status === 'failed' && <p className="error" role="alert">{state.error}</p>}
        {error && <div><p className="error" role="alert">{error}</p>
          <button className="secondary retry-button" onClick={() => { setError(''); setRetry((value) => value + 1); }}>Importstatus opnieuw ophalen</button>
        </div>}
      </SettingsCard>
      <RangesPage token={token} onUnauthorized={onUnauthorized} />
      <TargetTypesPage token={token} onUnauthorized={onUnauthorized} />
    </div>
  </section>;
}
