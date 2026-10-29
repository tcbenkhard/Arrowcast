import type { ApiTokenSummary, CreatedApiToken } from '@arrowcast/contracts';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { getLanguage, t } from '../../i18n';
import { managementRequest, requireJson } from '../../lib/http';
import { SettingsCard } from './SettingsCard';

const endpoint = '/api/v1/admin/api-tokens';

export function ApiKeys({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [keys, setKeys] = useState<ApiTokenSummary[]>([]);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  const secretInput = useRef<HTMLInputElement>(null);
  const generation = useRef<AbortController | null>(null);
  const revocation = useRef<AbortController | null>(null);
  const revokedIds = useRef(new Set<string>());
  const secretKeyId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void managementRequest(endpoint, token, {
      signal: controller.signal,
      onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
    })
      .then(requireJson<ApiTokenSummary[]>)
      .then((result) => {
        if (!controller.signal.aborted) setKeys(result.filter((key) => !revokedIds.current.has(key.id)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(t('ApiKeys.loadError'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  useEffect(() => {
    setSecret('');
    setCopied(false);
    setPending(false);
    setRevoking(null);
    generation.current = null;
    revocation.current = null;
    revokedIds.current.clear();
    secretKeyId.current = null;
    return () => {
      generation.current?.abort();
      generation.current = null;
      revocation.current?.abort();
      revocation.current = null;
    };
  }, [token]);

  function dismissSecret() {
    setSecret('');
    setCopied(false);
    secretKeyId.current = null;
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (generation.current || revocation.current) return;
    dismissSecret();
    setError('');
    if (!name.trim()) {
      setError(t('ApiKeys.nameRequired'));
      return;
    }
    const controller = new AbortController();
    generation.current = controller;
    setPending(true);
    try {
      const result = await requireJson<CreatedApiToken>(
        await managementRequest(endpoint, token, {
          method: 'POST',
          json: { name: name.trim() },
          signal: controller.signal,
          onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
        }),
      );
      if (controller.signal.aborted) return;
      const { token: generatedToken, ...summary } = result;
      setKeys((current) => [summary, ...current]);
      setSecret(generatedToken);
      secretKeyId.current = result.id;
      setName('');
    } catch {
      if (!controller.signal.aborted) setError(t('ApiKeys.createError'));
    } finally {
      if (!controller.signal.aborted) {
        generation.current = null;
        setPending(false);
      }
    }
  }

  async function revoke(key: ApiTokenSummary) {
    if (generation.current || revocation.current) return;
    const controller = new AbortController();
    revocation.current = controller;
    setRevoking(key.id);
    setError('');
    try {
      const response = await managementRequest(`${endpoint}/${encodeURIComponent(key.id)}`, token, {
        method: 'DELETE',
        signal: controller.signal,
        onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error();
      revokedIds.current.add(key.id);
      setKeys((current) => current.filter((entry) => entry.id !== key.id));
      if (secretKeyId.current === key.id) dismissSecret();
    } catch {
      if (!controller.signal.aborted) setError(t('ApiKeys.revokeError'));
    } finally {
      if (!controller.signal.aborted) {
        revocation.current = null;
        setRevoking(null);
      }
    }
  }

  async function copy() {
    if (!secret) return;
    setError('');
    try {
      try {
        if (!navigator.clipboard) throw new Error();
        await navigator.clipboard.writeText(secret);
      } catch {
        // Local management can use HTTP, where the Clipboard API is unavailable.
        secretInput.current?.focus();
        secretInput.current?.select();
        if (!document.execCommand('copy')) throw new Error();
      }
      setCopied(true);
    } catch {
      setError(t('ApiKeys.copyError'));
    }
  }

  return (
    <SettingsCard
      id="api-keys"
      icon="settings"
      title={t('ApiKeys.title')}
      forceExpanded={pending || revoking !== null}
      onExpandedChange={(expanded) => {
        if (!expanded) dismissSecret();
      }}
    >
      <p className="muted">{t('ApiKeys.help')}</p>
      <form
        onSubmit={(event) => {
          void generate(event);
        }}
        aria-busy={pending}
      >
        <label htmlFor="api-key-name">{t('ApiKeys.name')}</label>
        <div className="target-type-create-fields">
          <input
            id="api-key-name"
            required
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending || revoking !== null}
          />
          <button type="submit" disabled={pending || revoking !== null || loading}>
            {pending ? t('ApiKeys.generating') : t('ApiKeys.generate')}
          </button>
        </div>
      </form>
      {secret && (
        <div>
          <p id="api-key-once" className="muted">
            {t('ApiKeys.oneTime')}
          </p>
          <label htmlFor="api-key-token">{t('ApiKeys.token')}</label>
          <input
            id="api-key-token"
            ref={secretInput}
            readOnly
            autoComplete="off"
            spellCheck={false}
            aria-describedby="api-key-once"
            value={secret}
          />
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
            >
              {t('ApiKeys.copy')}
            </button>
            <button type="button" className="secondary" onClick={dismissSecret}>
              {t('ApiKeys.dismiss')}
            </button>
          </div>
          {copied && (
            <p className="success" role="status">
              {t('ApiKeys.copied')}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{t('ApiKeys.loading')}</p>
      ) : loadError ? (
        <div>
          <p className="error" role="alert">
            {loadError}
          </p>
          <button type="button" className="secondary" onClick={() => setRetry((current) => current + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </div>
      ) : keys.length === 0 ? (
        <p className="muted">{t('ApiKeys.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('ApiKeys.name')}</th>
                <th scope="col">{t('ApiKeys.createdDate')}</th>
                <th scope="col">{t('ApiKeys.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <th scope="row">{key.name}</th>
                  <td>
                    <time dateTime={new Date(key.createdDate).toISOString()}>
                      {new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(
                        key.createdDate,
                      )}
                    </time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      disabled={pending || revoking !== null}
                      aria-label={t('ApiKeys.revokeNamed', { name: key.name })}
                      onClick={() => {
                        void revoke(key);
                      }}
                    >
                      {revoking === key.id ? t('ApiKeys.revoking') : t('ApiKeys.revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SettingsCard>
  );
}
