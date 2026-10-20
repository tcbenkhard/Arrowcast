import { useEffect, useState } from 'react';
import { SettingsCard } from './SettingsCard';

interface UpdateState {
  status: 'checking' | 'idle' | 'available' | 'installing' | 'failed' | 'disabled' | 'offline';
  currentVersion: string;
  availableVersion: string | null;
  message: string;
}

export function Updates({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/v1/admin/updates', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized('Log opnieuw in om verder te gaan.'); return; }
        if (response.status === 503) throw new Error('Update service unavailable. Reconnecting…');
        const result = await response.json() as UpdateState & { message: string };
        if (!response.ok) throw new Error(result.message || 'Update status unavailable.');
        if (!controller.signal.aborted) { setState(result); setError(''); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Connection interrupted. Reconnecting…');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 3000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, onUnauthorized]);

  async function install() {
    if (pending) return;
    if (!window.confirm('Install this update? Arrowcast will briefly stop. Do not disconnect the Pi from power.')) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/v1/admin/updates', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) { onUnauthorized('Log opnieuw in om verder te gaan.'); return; }
      const result = await response.json() as UpdateState & { message: string };
      if (!response.ok) throw new Error(result.message || 'Could not start update.');
      setState(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start update.'); }
    finally { setPending(false); }
  }
  const updateActive = state?.status === 'installing' ||
    (!!state?.availableVersion && ['available', 'failed'].includes(state.status));
  return <SettingsCard id="updates" title="Updates" forceExpanded={updateActive}>
    {state && <p>Installed version: {state.currentVersion}</p>}
    <div aria-live="polite">
      {!state && !error && <p>Reading update status…</p>}
      {state?.status === 'idle' && <p>No updates available</p>}
      {state?.availableVersion && ['available', 'failed'].includes(state.status) && <p className="update-available">Update available ({state.availableVersion}){' '}
        <button disabled={pending || !!error} onClick={() => { void install(); }}>Update</button></p>}
      {state && !['idle', 'available'].includes(state.status) && <p>{state.message}</p>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </SettingsCard>;
}
