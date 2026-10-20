import { useState } from 'react';
import type { FormEvent } from 'react';

export function PasswordChangeForm({ token, onChanged, onLogout, onCancel }: {
  token: string; onChanged: (token: string) => void; onLogout: (message?: string) => void;
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
    if (password !== confirmation) { setError('De nieuwe wachtwoorden komen niet overeen.'); return; }
    setPending(true);
    try {
      const response = await fetch('/api/v1/admin/password', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword: password }),
      });
      if (response.status === 401) { onLogout('Log opnieuw in om verder te gaan.'); return; }
      const result = await response.json() as { token: string; message?: string };
      if (!response.ok) throw new Error(response.status === 429 ? 'Te veel pogingen. Probeer het over een minuut opnieuw.'
        : result.message ?? 'Het wachtwoord kon niet worden gewijzigd.');
      setCurrentPassword(''); setPassword(''); setConfirmation('');
      onChanged(result.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Geen verbinding met de server. Probeer opnieuw.');
    } finally { setPending(false); }
  }

  return <main className="auth-card">
    <h1>Wachtwoord wijzigen</h1>
    <p>{onCancel ? 'Kies een nieuw wachtwoord.' : 'Stel eerst een nieuw wachtwoord in om het beheerportal te openen.'} Gebruik minstens 8 tekens.</p>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <label htmlFor="current-password">Huidig wachtwoord</label>
      <input id="current-password" type="password" autoComplete="current-password" required maxLength={1024}
        value={currentPassword} disabled={pending} onChange={(event) => setCurrentPassword(event.target.value)} />
      <label htmlFor="new-password">Nieuw wachtwoord</label>
      <input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={1024}
        value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} />
      <label htmlFor="confirm-password">Bevestig nieuw wachtwoord</label>
      <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={1024}
        value={confirmation} disabled={pending} onChange={(event) => setConfirmation(event.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Opslaan…' : 'Wachtwoord opslaan'}</button>
    </form>
    {onCancel && <button className="secondary" disabled={pending} onClick={onCancel}>Cancel</button>}
    <button className="secondary" disabled={pending} onClick={() => onLogout()}>Uitloggen</button>
  </main>;
}
