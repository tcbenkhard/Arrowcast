import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { AppliedSettings } from './AppliedSettings';
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
  ddns: 'PublicAccess.errorDdns',
} as const;

interface PublicState {
  simulation?: boolean;
  available: boolean;
  enabled: boolean;
  busy: boolean;
  active: boolean;
  domain: string;
  email: string;
  accessMode?: 'public' | 'ddns';
  ddns?: { hostname?: string; ready?: boolean; address?: string; lastCheckedAt?: string; message?: string };
  expiresAt: string | null;
  lastCheckedAt: string | null;
  message: string;
  errorCode?: string | null;
  attempt?: { domain: string; email: string; accessMode?: 'public' | 'ddns' } | null;
  origin: string | null;
}

export function PublicAccess({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [state, setState] = useState<PublicState | null>(null);
  const [mode, setMode] = useState('internal');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [ddnsToken, setDdnsToken] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const awaitingApply = useRef(false);
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
        if (awaitingApply.current && !value.busy) {
          awaitingApply.current = false;
          if (!value.message && !value.ddns?.message && value.active) setEditing(false);
        }
        if (!initialized.current) {
          setMode(
            value.available && (value.enabled || value.active || value.attempt)
              ? value.attempt
                ? (value.attempt.accessMode ?? 'public')
                : (value.accessMode ?? 'public')
              : 'internal',
          );
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
        json: {
          enabled,
          domain,
          email,
          ...(mode === 'ddns' ? { accessMode: 'ddns', ddnsToken } : {}),
        },
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
      awaitingApply.current = true;
      setDdnsToken('');
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

  async function copyDdnsHostname() {
    if (!state?.ddns?.hostname) return;
    try {
      try {
        await navigator.clipboard.writeText(state.ddns.hostname);
      } catch {
        // Local HTTP management pages may not have access to the Clipboard API.
        const previousFocus = document.activeElement;
        const input = document.createElement('textarea');
        input.value = state.ddns.hostname;
        input.readOnly = true;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        try {
          input.focus();
          input.select();
          if (!document.execCommand('copy')) throw new Error('Copy failed');
        } finally {
          input.remove();
          if (previousFocus instanceof HTMLElement) previousFocus.focus();
        }
      }
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  const serverWarning = state?.message
    ? t(failureMessages[state.errorCode as keyof typeof failureMessages] ?? 'PublicAccess.configurationFailed')
    : '';
  const warning =
    error || loadError || (mode === 'ddns' && state?.ddns?.message ? t('PublicAccess.errorDdns') : serverWarning);
  const external = mode === 'public' || mode === 'ddns';
  const showSummary =
    state?.active &&
    (state.accessMode !== 'ddns' || state.ddns?.ready) &&
    !state.busy &&
    !pending &&
    !warning &&
    !editing;

  return (
    <SettingsCard id="public-access" icon="globe" title={t('PublicAccess.accessTitle')}>
      <div className="public-access-compact">
        {state?.available && (
          <p className="public-access-status" role="status">
            {state.busy
              ? t('PublicAccess.applying')
              : state.active
                ? t('PublicAccess.active')
                : t('PublicAccess.inactive')}
          </p>
        )}
        {state?.simulation && <small className="muted">{t('PublicAccess.simulation')}</small>}
        {showSummary ? (
          <AppliedSettings
            actions={
              state.accessMode === 'ddns' && state.ddns?.hostname ? (
                <>
                  <div className="applied-settings-copy">
                    <span className="applied-settings-cname">
                      {state.domain} CNAME <code>{state.ddns.hostname}</code>
                    </span>
                    <button type="button" onClick={() => void copyDdnsHostname()}>
                      {t('PublicAccess.copyDdnsHostname')}
                    </button>
                  </div>
                  {copyStatus && (
                    <small role="status">
                      {t(copyStatus === 'copied' ? 'PublicAccess.hostnameCopied' : 'PublicAccess.hostnameCopyFailed')}
                    </small>
                  )}
                </>
              ) : undefined
            }
            onEdit={() => {
              setEditing(true);
              setCopyStatus(null);
              setMode(state.accessMode ?? 'public');
              setDomain(state.domain);
              setEmail(state.email);
            }}
          >
            <span>{t(state.accessMode === 'ddns' ? 'PublicAccess.externalDdns' : 'PublicAccess.externalStatic')}</span>
            <span>{state.origin}</span>
            <span>{state.email}</span>
          </AppliedSettings>
        ) : (
          <>
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
                  {t('PublicAccess.externalStatic')}
                </option>
                <option value="ddns" disabled={!state?.available}>
                  {t('PublicAccess.externalDdns')}
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
            {state?.available && external && (
              <>
                {state.origin && (
                  <p className="public-access-origin">
                    <code>{state.origin}</code>
                  </p>
                )}
                <p>{t('PublicAccess.help')}</p>
                <form onSubmit={save} className="public-access-form">
                  <fieldset className="score-entry-access-fields" disabled={pending || state.busy}>
                    {mode === 'ddns' && (
                      <label className="public-access-field" htmlFor="ddns-token">
                        {t('PublicAccess.ddnsToken')}
                        <input
                          id="ddns-token"
                          type="password"
                          autoComplete="new-password"
                          maxLength={512}
                          required={!state.ddns?.ready}
                          value={ddnsToken}
                          onChange={(event) => setDdnsToken(event.target.value)}
                        />
                      </label>
                    )}
                    <div className="public-access-field">
                      <label htmlFor="public-domain">{t('PublicAccess.domain')}</label>
                      <input
                        id="public-domain"
                        value={domain}
                        required
                        maxLength={253}
                        placeholder="scores.jouwclub.nl"
                        onChange={(event) => setDomain(event.target.value)}
                      />
                    </div>
                    <div className="public-access-field">
                      <label htmlFor="public-email">{t('PublicAccess.email')}</label>
                      <input
                        id="public-email"
                        type="email"
                        value={email}
                        required
                        maxLength={254}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </div>
                    <small className="muted">
                      {t('PublicAccess.saveTerms')}{' '}
                      <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer">
                        {t('PublicAccess.agreement')}
                      </a>
                      {mode === 'ddns' && (
                        <>
                          <br />
                          <a href="https://dynv6.com/keys" target="_blank" rel="noreferrer">
                            {t('PublicAccess.ddnsAccount')}
                          </a>
                        </>
                      )}
                    </small>
                    <div className="public-access-actions">
                      <button type="submit">{t('PublicAccess.saveSettings')}</button>
                    </div>
                  </fieldset>
                </form>
                {mode === 'ddns' && state.ddns?.ready && state.ddns.hostname && (
                  <div className="public-access-cname">
                    <small>{t('PublicAccess.cnameHelp')}</small>
                    <code>
                      {domain || t('PublicAccess.domain')} CNAME {state.ddns.hostname}
                    </code>
                  </div>
                )}
              </>
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
      </div>
    </SettingsCard>
  );
}
