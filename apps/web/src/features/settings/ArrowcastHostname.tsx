import { t, message } from '../../i18n';
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
    setError('');
    setNotice('');
    let origin: string;
    try {
      const url = new URL(address.trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      origin = url.origin;
    } catch {
      setError(t('ArrowcastHostname.enter_a_valid_http_or_https_website_address'));
      return;
    }
    try {
      localStorage.setItem(arrowcastHostnameKey, origin);
      setAddress(origin);
      setNotice(t('ArrowcastHostname.arrowcast_hostname_saved'));
    } catch {
      setError(t('ArrowcastHostname.could_not_save_the_hostname_in_this_browser_please'));
    }
  }

  return (
    <SettingsCard id="arrowcast-hostname" title={t('ArrowcastHostname.arrowcast_hostname')}>
      <form onSubmit={save}>
        <label htmlFor="scoring-site-url">{t('ArrowcastHostname.scoring_website_address')}</label>
        <input
          id="scoring-site-url"
          type="url"
          required
          value={address}
          aria-describedby="arrowcast-hostname-help"
          onChange={(event) => {
            setAddress(event.target.value);
            setError('');
            setNotice('');
          }}
        />
        <p id="arrowcast-hostname-help" className="muted">
          {t('ArrowcastHostname.use_an_address_reachable_from_the_phones_at_the')}
        </p>
        <button type="submit">{t('ArrowcastHostname.save_hostname')}</button>
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
      </form>
    </SettingsCard>
  );
}
