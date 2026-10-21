import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useState } from 'react';
import type { FormEvent } from 'react';

export function PasswordChangeForm({
  token,
  onChanged,
  onLogout,
  onCancel,
}: {
  token: string;
  onChanged: (token: string) => void;
  onLogout: (message?: string) => void;
  onCancel?: (() => void) | undefined;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (password !== confirmation) {
      setError(t('PasswordChangeForm.de_nieuwe_wachtwoorden_komen_niet_overeen'));
      return;
    }
    setPending(true);
    try {
      const response = await managementRequest('/api/v1/admin/password', token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword: password }),
      });
      if (response.status === 401) {
        onLogout(t('PasswordChangeForm.log_opnieuw_in_om_verder_te_gaan'));
        return;
      }
      const result = (await response.json()) as { token: string; message?: string };
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? t('PasswordChangeForm.te_veel_pogingen_probeer_het_over_een_minuut_opnieuw')
            : (result.message ?? t('PasswordChangeForm.het_wachtwoord_kon_niet_worden_gewijzigd')),
        );
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
      onChanged(result.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('AdminPage.geen_verbinding_met_de_server_probeer_opnieuw'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-card">
      <h1>{t('PasswordChangeForm.wachtwoord_wijzigen')}</h1>
      <p>
        {onCancel
          ? t('PasswordChangeForm.kies_een_nieuw_wachtwoord')
          : t('PasswordChangeForm.stel_eerst_een_nieuw_wachtwoord_in_om_het_beheerportal')}{' '}
        {t('PasswordChangeForm.gebruik_minstens_8_tekens')}
      </p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-busy={pending}
      >
        <label htmlFor="current-password">{t('PasswordChangeForm.huidig_wachtwoord')}</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={currentPassword}
          disabled={pending}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <label htmlFor="new-password">{t('PasswordChangeForm.nieuw_wachtwoord')}</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="confirm-password">{t('PasswordChangeForm.bevestig_nieuw_wachtwoord')}</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={1024}
          value={confirmation}
          disabled={pending}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {error && (
          <p className="error" role="alert">
            {message(error)}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? t('PasswordChangeForm.opslaan') : t('PasswordChangeForm.wachtwoord_opslaan')}
        </button>
      </form>
      {onCancel && (
        <button className="secondary" disabled={pending} onClick={onCancel}>
          {t('PasswordChangeForm.cancel')}
        </button>
      )}
      <button className="secondary" disabled={pending} onClick={() => onLogout()}>
        {t('PasswordChangeForm.uitloggen')}
      </button>
    </main>
  );
}
