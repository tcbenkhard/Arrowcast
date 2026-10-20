import { t, message } from '../../i18n';
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
        if (response.status === 401) { onUnauthorized(t("PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan")); return; }
        if (response.status === 503) throw new Error(t('updates.unavailable'));
        const result = await response.json() as UpdateState & { message: string };
        if (!response.ok) throw new Error(result.message || t('updates.statusUnavailable'));
        if (!controller.signal.aborted) { setState(result); setError(''); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("Updates.connection_interrupted_reconnecting"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 3000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, onUnauthorized]);

  async function install() {
    if (pending) return;
    if (!window.confirm(t("Updates.install_this_update_arrowcast_will_briefly_stop_do_not"))) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/v1/admin/updates', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 401) { onUnauthorized(t("PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan")); return; }
      const result = await response.json() as UpdateState & { message: string };
      if (!response.ok) throw new Error(result.message || t("Updates.could_not_start_update"));
      setState(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Updates.could_not_start_update")); }
    finally { setPending(false); }
  }
  const updateActive = state?.status === 'installing' ||
    (!!state?.availableVersion && ['available', 'failed'].includes(state.status));
  return <SettingsCard id="updates" title="Updates" forceExpanded={updateActive}>
    {state && <p>{t('updates.version', { version: state.currentVersion })}</p>}
    <div aria-live="polite">
      {!state && !error && <p>{t("Updates.reading_update_status")}</p>}
      {state?.status === 'idle' && <p>{t("Updates.no_updates_available")}</p>}
      {state?.availableVersion && ['available', 'failed'].includes(state.status) && <p className="update-available">{t('updates.available', { version: state.availableVersion })}{' '}
        <button disabled={pending || !!error} onClick={() => { void install(); }}>{t("Updates.update")}</button></p>}
      {state && !['idle', 'available'].includes(state.status) && <p>{t(`updates.${state.status as 'checking' | 'installing' | 'failed' | 'disabled' | 'offline'}`)}</p>}
    </div>
    {error && <p className="error" role="alert">{message(error)}</p>}
  </SettingsCard>;
}
