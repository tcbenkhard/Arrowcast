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
        const response = await fetch('/api/v1/admin/network', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized('Log opnieuw in om verder te gaan.'); return; }
        if (!response.ok) throw new Error('Network status unavailable. Reconnect to the Pi on the selected network.');
        const result = await response.json() as NetworkState;
        if (!controller.signal.aborted) {
          setState(result); setStatusError('');
          if (!initialized.current) { setSsid(result.ssid ?? ''); initialized.current = true; }
        }
      } catch (reason) {
        if (!controller.signal.aborted) setStatusError(reason instanceof Error ? reason.message : 'Could not read network status.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 3000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, onUnauthorized]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || state?.busy) return;
    submitting.current = true;
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/admin/network', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password }),
      });
      if (response.status === 401) { onUnauthorized('Log opnieuw in om verder te gaan.'); return; }
      const result = await response.json() as NetworkState & { message: string };
      if (!response.ok) throw new Error(result.message || 'Could not save Wi-Fi settings.');
      setState(result); setPassword('');
      setNotice('Wi-Fi settings accepted. If disconnected, join the selected network and open http://arrowcast.local/admin. If joining fails, reconnect to ArrowCast at http://10.42.0.1/admin.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connection interrupted. Reconnect to the Pi and check its network status before retrying.');
    } finally { submitting.current = false; setPending(false); }
  }

  return <SettingsCard id="network" title="Network">
    <p>Ethernet takes priority: connecting a network cable disables Wi-Fi, including the ArrowCast hotspot.
      Unplugging it restores saved Wi-Fi, with the hotspot as a fallback.</p>
    <div role="status" aria-live="polite">
      {!state && !statusError && <p>Reading network status…</p>}
      {state?.mode === 'starting' && <p>Starting network service…</p>}
      {state?.mode === 'disabled' && <p>{state.message}</p>}
      {state?.mode === 'ethernet' && <p>Ethernet cable connected. Wi-Fi is disabled.</p>}
      {state?.mode === 'wifi' && <p>Connected to Wi-Fi: {state.ssid}{state.address && ` (${state.address})`}</p>}
      {state?.mode === 'hotspot' && <p>ArrowCast hotspot active: http://10.42.0.1</p>}
      {state && state.mode !== 'disabled' && state.ssid && <p>Saved Wi-Fi: {state.ssid}</p>}
      {state && state.mode !== 'disabled' && state.message && <p>{state.message}</p>}
      {notice && <p>{notice}</p>}
    </div>
    {state && state.mode !== 'disabled' && <form onSubmit={(event) => { void connect(event); }}>
      <p>Enter the exact network name (including hidden networks). Supports open and WPA/WPA2 Personal networks.
        Joining Wi-Fi replaces the hotspot and disconnects devices using it. Enterprise Wi-Fi requires separate setup.</p>
      <label htmlFor="wifi-ssid">Wi-Fi network name (SSID)</label>
      <input id="wifi-ssid" value={ssid} onChange={(event) => setSsid(event.target.value)} required maxLength={32}
        autoComplete="off" disabled={pending || state.busy} />
      <label htmlFor="wifi-password">Wi-Fi password (leave empty for an open network)</label>
      <input id="wifi-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
        maxLength={64} autoComplete="new-password" disabled={pending || state.busy} />
      <button type="submit" disabled={pending || state.busy || !ssid}>Save Wi-Fi settings</button>
      {state.busy && <p>Applying Wi-Fi settings…</p>}
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {statusError && <p className="error" role="alert">{statusError}</p>}
  </SettingsCard>;
}
