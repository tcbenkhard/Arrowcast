import { useState } from 'react';
import type { FormEvent } from 'react';
import { SettingsCard } from './SettingsCard';
import { arrowcastHostnameKey, getArrowcastHostname } from './hostnameStorage';

export function ArrowcastHostname() {
  const [address, setAddress] = useState(getArrowcastHostname);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice('');
    let origin: string;
    try {
      const url = new URL(address.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      origin = url.origin;
    } catch {
      setError('Enter a valid http or https website address.');
      return;
    }
    try {
      localStorage.setItem(arrowcastHostnameKey, origin);
      setAddress(origin);
      setNotice('Arrowcast hostname saved.');
    } catch {
      setError('Could not save the hostname in this browser. Please try again.');
    }
  }

  return <SettingsCard id="arrowcast-hostname" title="Arrowcast hostname">
    <form onSubmit={save}>
      <label htmlFor="scoring-site-url">Scoring website address</label>
      <input id="scoring-site-url" type="url" required value={address}
        aria-describedby="arrowcast-hostname-help"
        onChange={(event) => { setAddress(event.target.value); setError(''); setNotice(''); }} />
      <p id="arrowcast-hostname-help" className="muted">Use an address reachable from the phones at the lanes, including http:// or https://.
        This browser will use the saved address for all lane scoring QR codes.</p>
      <button type="submit">Save hostname</button>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
    </form>
  </SettingsCard>;
}
