import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { ArrowcastHostname } from './ArrowcastHostname';
import { SettingsCard } from './SettingsCard';

const failureMessages = {
  dns: 'PublicAccess.errorDns',
  timeout: 'PublicAccess.errorTimeout',
  connection: 'PublicAccess.errorConnection',
  challenge_response: 'PublicAccess.errorChallenge',
  rate_limit: 'PublicAccess.errorRateLimit',
  permissions: 'PublicAccess.errorPermissions',
  nginx: 'PublicAccess.errorNginx',
  restore: 'PublicAccess.errorRestore',
  configuration: 'PublicAccess.configurationFailed',
} as const;

interface PublicState {
  available: boolean;
  enabled: boolean;
  busy: boolean;
  active: boolean;
  domain: string;
  email: string;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  message: string;
  errorCode?: string | null;
  attempt?: { domain: string; email: string } | null;
  origin: string | null;
}

export function PublicAccess({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [state, setState] = useState<PublicState | null>(null);
  const [mode, setMode] = useState('internal');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const initialized = useRef(false);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await managementRequest('/api/v1/admin/public-access', token, { signal: controller.signal });
        if (response.status === 401) {
          onUnauthorized(t('PublicAccess.sessionExpired'));
          return;
        }
        if (!response.ok) throw new Error();
        const value = (await response.json()) as PublicState;
        if (controller.signal.aborted) return;
        setState(value);
        setLoadError('');
        if (!initialized.current) {
          setMode(value.available && (value.enabled || value.active || value.attempt) ? 'public' : 'internal');
          setDomain(value.attempt?.domain ?? value.domain ?? '');
          setEmail(value.attempt?.email ?? value.email ?? '');
          initialized.current = true;
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(t('PublicAccess.unavailable'));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 4000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, onUnauthorized]);

  async function configure(enabled: boolean) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const response = await managementRequest('/api/v1/admin/public-access', token, {
        method: 'POST',
        json: { enabled, domain, email },
      });
      if (response.status === 401) {
        onUnauthorized(t('PublicAccess.sessionExpired'));
        return;
      }
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message || t('PublicAccess.saveFailed'));
      }
      setState((value) => (value ? { ...value, busy: true, message: '', errorCode: null } : value));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('PublicAccess.saveFailed'));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void configure(true);
  }

  const serverWarning = state?.message
    ? t(failureMessages[state.errorCode as keyof typeof failureMessages] ?? 'PublicAccess.configurationFailed')
    : '';
  const warning = error || loadError || serverWarning;

  return (
    <SettingsCard id="public-access" icon="globe" title={t('PublicAccess.accessTitle')}>
      <p>{t('PublicAccess.accessHelp')}</p>
      <div className="score-entry-access-mode">
        <label htmlFor="score-entry-access">{t('PublicAccess.accessMode')}</label>
        <select
          id="score-entry-access"
          value={mode}
          disabled={!state || pending || state.busy}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="internal">{t('PublicAccess.internalOnly')}</option>
          <option value="public" disabled={!state?.available}>
            {t('PublicAccess.title')}
          </option>
        </select>
      </div>
      {state && !state.available && <p role="status">{t('PublicAccess.piOnly')}</p>}
      {mode === 'internal' && (
        <>
          {state?.enabled && (
            <button type="button" disabled={pending || state.busy} onClick={() => void configure(false)}>
              {t('PublicAccess.useInternal')}
            </button>
          )}
          <fieldset className="score-entry-access-fields" disabled={pending || state?.busy || state?.enabled}>
            <ArrowcastHostname />
          </fieldset>
        </>
      )}
      {state?.available && (mode === 'public' || state.enabled || state.busy) && (
        <>
          <p role="status">
            {state.busy
              ? t('PublicAccess.applying')
              : state.active
                ? t('PublicAccess.active')
                : t('PublicAccess.inactive')}
          </p>
          {mode === 'public' && state.origin && (
            <p>
              <code>{state.origin}</code>
            </p>
          )}
          {mode === 'public' && state.expiresAt && <p>{t('PublicAccess.expires', { date: state.expiresAt })}</p>}
          {mode === 'public' && state.lastCheckedAt && (
            <p>{t('PublicAccess.checked', { date: state.lastCheckedAt })}</p>
          )}
          {mode === 'public' && (
            <form onSubmit={save}>
              <p>{t('PublicAccess.help')}</p>
              <fieldset className="score-entry-access-fields" disabled={pending || state.busy}>
                <label htmlFor="public-domain">{t('PublicAccess.domain')}</label>
                <input
                  id="public-domain"
                  value={domain}
                  required
                  maxLength={253}
                  placeholder="scores.jouwclub.nl"
                  onChange={(event) => setDomain(event.target.value)}
                />
                <label htmlFor="public-email">{t('PublicAccess.email')}</label>
                <input
                  id="public-email"
                  type="email"
                  value={email}
                  required
                  maxLength={254}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p>{t('PublicAccess.terms')}</p>
                <p>
                  <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">
                    {t('PublicAccess.agreement')}
                  </a>
                </p>
                <div className="public-access-actions">
                  <button type="submit">{state.active ? t('PublicAccess.update') : t('PublicAccess.activate')}</button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      {warning && (
        <div className="settings-warning" role="alert">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-warning-icon">
            <path d="M12 3 2 21h20L12 3Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 9v5m0 3v1" stroke="currentColor" strokeWidth="2" />
          </svg>
          <div>
            <strong>{t('PublicAccess.warning')}</strong>
            <p>{warning}</p>
            {serverWarning && !error && !loadError && state?.message && (
              <details>
                <summary>{t('PublicAccess.technicalDetails')}</summary>
                <pre>{state.message}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
