import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router';
import { CompetitionDetailPage } from '../competitions/CompetitionDetailPage';
import { CompetitionsPage } from '../competitions/CompetitionsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { PasswordChangeForm } from './PasswordChangeForm';

const storageKey = 'arrowcast.admin.jwt';

function savedToken(): string | null {
  try { return sessionStorage.getItem(storageKey); }
  catch { return null; }
}

function storeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(storageKey, token);
    else sessionStorage.removeItem(storageKey);
  } catch {
    // Authentication still works in memory if browser storage is unavailable.
  }
}

interface Session {
  username: string;
  expiresAt: number;
  forceChangePassword: boolean;
}

export function AdminPage() {
  const [token, setToken] = useState(savedToken);
  const [session, setSession] = useState<Session | null>(null);
  const [loginError, setLoginError] = useState('');
  const [checkError, setCheckError] = useState('');
  const [retry, setRetry] = useState(0);

  const logout = useCallback((message = '') => {
    storeToken(null);
    setToken(null);
    setSession(null);
    setLoginError(message);
    setCheckError('');
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setCheckError('');
    setSession(null);
    void (async () => {
      try {
        const response = await fetch('/api/v1/admin/me', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          logout('Je sessie is verlopen of ongeldig. Log opnieuw in.');
          return;
        }
        if (!response.ok) throw new Error('Session check failed');
        const result = await response.json() as Session;
        if (controller.signal.aborted) return;
        if (result.expiresAt <= Date.now()) {
          logout('Je sessie is verlopen. Log opnieuw in.');
          return;
        }
        setSession(result);
      } catch {
        if (!controller.signal.aborted) {
          setCheckError('Je sessie kon niet worden gecontroleerd. Controleer de verbinding en probeer opnieuw.');
        }
      }
    })();
    return () => controller.abort();
  }, [token, retry]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      logout('Je sessie is verlopen. Log opnieuw in.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  if (!token) {
    return <LoginForm error={loginError} onLogin={(newToken) => {
      storeToken(newToken);
      setLoginError('');
      setToken(newToken);
    }} />;
  }

  if (!session) {
    return (
      <main className="auth-card">
        <h1>ArrowCast</h1>
        {checkError ? <>
          <p role="alert">{checkError}</p>
          <button onClick={() => setRetry((value) => value + 1)}>Opnieuw proberen</button>
          <button className="secondary" onClick={() => logout()}>Terug naar inloggen</button>
        </> : <p role="status">Sessie controleren…</p>}
      </main>
    );
  }

  if (session.forceChangePassword) {
    return <PasswordChangeForm token={token} onLogout={logout} onChanged={(newToken) => {
      storeToken(newToken);
      setSession(null);
      setToken(newToken);
    }} />;
  }

  return (
    <main>
      <header className="admin-header">
        <h1>ArrowCast</h1>
        <button className="secondary" onClick={() => logout()}>Uitloggen</button>
      </header>
      <nav className="admin-nav" aria-label="Admin navigation">
        <NavLink to="/admin/competitions">Competitions</NavLink>
        <NavLink className="settings-tab" to="/admin/settings">Settings</NavLink>
      </nav>
      <Routes>
        <Route path="settings" element={<SettingsPage token={token} onUnauthorized={logout} />} />
        <Route index element={<Navigate to="/admin/competitions" replace />} />
        <Route path="target-types" element={<Navigate to="/admin/settings" replace />} />
        <Route path="ranges" element={<Navigate to="/admin/settings" replace />} />
        <Route path="competitions/:competitionId" element={<CompetitionDetailPage token={token} onUnauthorized={logout} />} />
        <Route path="competitions" element={<CompetitionsPage token={token} onUnauthorized={logout} />} />
        <Route path="*" element={<section className="panel"><h2>Pagina niet gevonden</h2>
          <Link to="/admin">Naar het beheerportal</Link></section>} />
      </Routes>
    </main>
  );
}

function LoginForm({ error, onLogin }: { error: string; onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [requestError, setRequestError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setRequestError('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) {
        setRequestError(response.status === 401
          ? 'Gebruikersnaam of wachtwoord is onjuist.'
          : response.status === 429
            ? 'Te veel inlogpogingen. Probeer het over een minuut opnieuw.'
            : 'Inloggen is tijdelijk niet mogelijk. Probeer opnieuw.');
        return;
      }
      const result = await response.json() as { token: string };
      setPassword('');
      onLogin(result.token);
    } catch {
      setRequestError('Geen verbinding met de server. Probeer opnieuw.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-card">
      <p className="eyebrow">Arrowcast · Beheer</p>
      <h1>Inloggen</h1>
      <p>Log in om het beheerportal te openen.</p>
      <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
        <label htmlFor="username">Gebruikersnaam</label>
        <input id="username" name="username" autoComplete="username" required
          maxLength={100} value={username} disabled={pending}
          onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="password">Wachtwoord</label>
        <input id="password" name="password" type="password" autoComplete="current-password"
          required maxLength={1024} value={password} disabled={pending}
          onChange={(event) => setPassword(event.target.value)} />
        {(requestError || error) && <p className="error" role="alert">{requestError || error}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Bezig met inloggen…' : 'Inloggen'}</button>
      </form>
    </main>
  );
}
