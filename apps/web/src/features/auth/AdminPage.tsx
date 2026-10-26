import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router';
import { ArrowCastLogo } from '../../components/ArrowCastLogo';
import { Icon } from '../../components/Icon';
import { LanguageSelect } from '../../components/LanguageSelect';
import type { Language } from '../../i18n';
import { message, setLanguage, t } from '../../i18n';
import { decodeJson, managementRequest } from '../../lib/http';
import { CompetitionDetailPage } from '../competitions/CompetitionDetailPage';
import { CompetitionsPage } from '../competitions/CompetitionsPage';
import { LogbookPage } from '../logbook/LogbookPage';
import { LogsPage } from '../settings/LogsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { PasswordChangeForm } from './PasswordChangeForm';
import type { AdminSession } from './session';
import { readAdminToken, writeAdminToken } from './session';

export function AdminPage() {
  const [token, setToken] = useState(readAdminToken);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loginError, setLoginError] = useState('');
  const [checkError, setCheckError] = useState('');
  const [retry, setRetry] = useState(0);
  const [changingPassword, setChangingPassword] = useState(false);

  const logout = useCallback((message = '') => {
    writeAdminToken(null);
    setToken(null);
    setSession(null);
    setLoginError(message);
    setCheckError('');
    setChangingPassword(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setCheckError('');
    setSession(null);
    void (async () => {
      try {
        const response = await managementRequest('/api/v1/admin/me', token, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          logout(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
          return;
        }
        if (!response.ok) throw new Error(t('AdminPage.session_check_failed'));
        const result = await decodeJson<AdminSession>(response);
        if (controller.signal.aborted) return;
        setSession(result);
        setLanguage(result.language);
      } catch {
        if (!controller.signal.aborted) {
          setCheckError(t('AdminPage.je_sessie_kon_niet_worden_gecontroleerd_controleer_de_verbinding'));
        }
      }
    })();
    return () => controller.abort();
  }, [token, retry]);

  if (!token) {
    return (
      <LoginForm
        error={message(loginError)}
        onLogin={(newToken) => {
          writeAdminToken(newToken);
          setLoginError('');
          setToken(newToken);
        }}
      />
    );
  }

  if (!session) {
    return (
      <main className="auth-card">
        <h1>
          <ArrowCastLogo />
        </h1>
        {checkError ? (
          <>
            <p role="alert">{message(checkError)}</p>
            <button onClick={() => setRetry((value) => value + 1)}>{t('AdminPage.opnieuw_proberen')}</button>
            <button className="secondary" onClick={() => logout()}>
              {t('AdminPage.terug_naar_inloggen')}
            </button>
          </>
        ) : (
          <p role="status">{t('AdminPage.sessie_controleren')}</p>
        )}
      </main>
    );
  }

  if (session.forceChangePassword || changingPassword) {
    return (
      <PasswordChangeForm
        token={token}
        onLogout={logout}
        onCancel={session.forceChangePassword ? undefined : () => setChangingPassword(false)}
        onChanged={(newToken) => {
          writeAdminToken(newToken);
          setChangingPassword(false);
          setSession(null);
          setToken(newToken);
        }}
      />
    );
  }

  return (
    <main>
      <header className="admin-header">
        <h1>
          <ArrowCastLogo />
        </h1>
        <ProfileMenu
          username={session.username}
          onLogout={() => logout()}
          token={token}
          onChangePassword={() => setChangingPassword(true)}
        />
      </header>
      <nav className="admin-nav" aria-label={t('AdminPage.admin_navigation')}>
        <NavLink className="with-icon" to="/admin/competitions">
          <Icon name="trophy" />
          {t('AdminPage.competitions')}
        </NavLink>
        <NavLink className="with-icon" to="/admin/logbook">
          <Icon name="book" />
          {t('logbook.title')}
        </NavLink>
        {session.role === 'admin' && (
          <NavLink className="settings-tab with-icon" to="/admin/settings">
            <Icon name="settings" />
            {t('AdminPage.settings')}
          </NavLink>
        )}
      </nav>
      <Routes>
        <Route path="logbook" element={<LogbookPage token={token} onUnauthorized={logout} />} />
        <Route
          path="logs"
          element={
            session.role === 'admin' ? (
              <LogsPage token={token} onUnauthorized={logout} />
            ) : (
              <Navigate to="/admin/competitions" replace />
            )
          }
        />
        <Route
          path="settings"
          element={
            session.role === 'admin' ? (
              <SettingsPage token={token} onUnauthorized={logout} />
            ) : (
              <Navigate to="/admin/competitions" replace />
            )
          }
        />
        <Route index element={<Navigate to="/admin/competitions" replace />} />
        <Route path="target-types" element={<Navigate to="/admin/settings" replace />} />
        <Route path="ranges" element={<Navigate to="/admin/settings" replace />} />
        <Route
          path="competitions/:competitionId"
          element={<CompetitionDetailPage token={token} onUnauthorized={logout} />}
        />
        <Route path="competitions" element={<CompetitionsPage token={token} onUnauthorized={logout} />} />
        <Route
          path="*"
          element={
            <section className="panel">
              <h2>{t('App.pagina_niet_gevonden')}</h2>
              <Link to="/admin">{t('App.naar_het_beheerportal')}</Link>
            </section>
          }
        />
      </Routes>
    </main>
  );
}

function ProfileMenu({
  username,
  token,
  onLogout,
  onChangePassword,
}: {
  username: string;
  token: string;
  onLogout: () => void;
  onChangePassword: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function changeLanguage(value: Language) {
    setPending(true);
    setError('');
    try {
      const response = await managementRequest('/api/v1/admin/me/language', token, {
        method: 'PATCH',
        json: { language: value },
      });
      if (!response.ok) {
        setError(t('language.saveError'));
        return;
      }
      setLanguage(value);
      document.getElementById('profile-dropdown')?.hidePopover();
    } catch {
      setError(t('language.saveError'));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="profile-menu">
      <button
        className="profile-avatar"
        popoverTarget="profile-dropdown"
        aria-label={t('AdminPage.profile', { p0: username })}
        title={username}
      >
        {Array.from(username.trim())[0]?.toLocaleUpperCase() || '?'}
      </button>
      <div id="profile-dropdown" className="profile-dropdown" popover="auto">
        <LanguageSelect
          flags
          disabled={pending}
          onChange={(value) => {
            void changeLanguage(value);
          }}
        />
        {error && <p role="alert">{message(error)}</p>}
        <button onClick={onChangePassword}>{t('AdminPage.change_password')}</button>
        <hr />
        <button onClick={onLogout}>{t('AdminPage.logoff')}</button>
      </div>
    </div>
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
        setRequestError(
          response.status === 401
            ? t('AdminPage.gebruikersnaam_of_wachtwoord_is_onjuist')
            : response.status === 429
              ? t('AdminPage.te_veel_inlogpogingen_probeer_het_over_een_minuut_opnieuw')
              : t('AdminPage.inloggen_is_tijdelijk_niet_mogelijk_probeer_opnieuw'),
        );
        return;
      }
      const result = (await response.json()) as { token: string };
      setPassword('');
      onLogin(result.token);
    } catch {
      setRequestError(t('AdminPage.geen_verbinding_met_de_server_probeer_opnieuw'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-card">
      <p className="eyebrow">{t('AdminPage.arrowcast_beheer')}</p>
      <h1>{t('AdminPage.inloggen')}</h1>
      <p>{t('AdminPage.log_in_om_het_beheerportal_te_openen')}</p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-busy={pending}
      >
        <label htmlFor="username">{t('AdminPage.gebruikersnaam')}</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          maxLength={100}
          value={username}
          disabled={pending}
          onChange={(event) => setUsername(event.target.value)}
        />
        <label htmlFor="password">{t('AdminPage.wachtwoord')}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
        {(requestError || error) && (
          <p className="error" role="alert">
            {message(requestError || error)}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? t('AdminPage.bezig_met_inloggen') : t('AdminPage.inloggen')}
        </button>
      </form>
      <footer className="auth-footer">
        <LanguageSelect flags />
      </footer>
    </main>
  );
}
