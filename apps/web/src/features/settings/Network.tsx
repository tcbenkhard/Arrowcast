import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SettingsCard } from './SettingsCard';

interface NetworkState {
  mode: 'disabled' | 'starting' | 'ethernet' | 'wifi' | 'hotspot';
  busy: boolean;
  ssid: string | null;
  address: string | null;
  message: string;
}

export function Network({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const initialized = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await managementRequest('/api/v1/admin/network', token, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          onUnauthorized(t('PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan'));
          return;
        }
        if (!response.ok) throw new Error(t('Network.network_status_unavailable_reconnect_to_the_pi_on_the'));
        const result = (await response.json()) as NetworkState;
        if (!controller.signal.aborted) {
          setState(result);
          setStatusError('');
          if (!initialized.current) {
            setSsid(result.ssid ?? '');
            initialized.current = true;
          }
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setStatusError(reason instanceof Error ? reason.message : t('Network.could_not_read_network_status'));
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void refresh();
          }, 3000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, onUnauthorized]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || state?.busy) return;
    submitting.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await managementRequest('/api/v1/admin/network', token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password }),
      });
      if (response.status === 401) {
        onUnauthorized(t('PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan'));
        return;
      }
      const result = (await response.json()) as NetworkState & { message: string };
      if (!response.ok) throw new Error(result.message || t('Network.could_not_save_wifi_settings'));
      setState(result);
      setPassword('');
      setNotice(t('Network.wifi_settings_accepted_if_disconnected_join_the_selected_network'));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t('Network.connection_interrupted_reconnect_to_the_pi_and_check_its'),
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <SettingsCard id="network" icon="network" title={t('Network.network')}>
      <p>{t('Network.ethernet_takes_priority_connecting_a_network_cable_disables_wifi')}</p>
      <div role="status" aria-live="polite">
        {!state && !statusError && <p>{t('Network.reading_network_status')}</p>}
        {state?.mode === 'starting' && <p>{t('Network.starting_network_service')}</p>}
        {state?.mode === 'disabled' && <p>{t('network.disabled')}</p>}
        {state?.mode === 'ethernet' && <p>{t('Network.ethernet_cable_connected_wifi_is_disabled')}</p>}
        {state?.mode === 'wifi' && (
          <p>
            {t('network.connected', { ssid: state.ssid })}
            {state.address && ` (${state.address})`}
          </p>
        )}
        {state?.mode === 'hotspot' && <p>{t('Network.arrowcast_hotspot_active_http104201')}</p>}
        {state && state.mode !== 'disabled' && state.ssid && <p>{t('network.saved', { ssid: state.ssid })}</p>}
        {state && state.mode !== 'disabled' && state.message && <p>{message(state.message)}</p>}
        {notice && <p>{message(notice)}</p>}
      </div>
      {state && state.mode !== 'disabled' && (
        <form
          onSubmit={(event) => {
            void connect(event);
          }}
        >
          <p>{t('Network.enter_the_exact_network_name_including_hidden_networks_supports')}</p>
          <label htmlFor="wifi-ssid">{t('Network.wifi_network_name_ssid')}</label>
          <input
            id="wifi-ssid"
            value={ssid}
            onChange={(event) => setSsid(event.target.value)}
            required
            maxLength={32}
            autoComplete="off"
            disabled={pending || state.busy}
          />
          <label htmlFor="wifi-password">{t('Network.wifi_password_leave_empty_for_an_open_network')}</label>
          <input
            id="wifi-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={64}
            autoComplete="new-password"
            disabled={pending || state.busy}
          />
          <button type="submit" disabled={pending || state.busy || !ssid}>
            {t('Network.save_wifi_settings')}
          </button>
          {state.busy && <p>{t('Network.applying_wifi_settings')}</p>}
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {message(error)}
        </p>
      )}
      {statusError && (
        <p className="error" role="alert">
          {message(statusError)}
        </p>
      )}
    </SettingsCard>
  );
}
