import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useModal } from '../../hooks/useModal';
import { SettingsCard } from './SettingsCard';

interface User {
  name: string;
  username: string;
  role: 'admin' | 'competition_manager';
  forceChangePassword: boolean;
  language: 'nl' | 'en';
}
interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const roleNames = { admin: 'Users.administrator', competition_manager: 'Users.competition_manager' } as const;
const expiredMessage = 'AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in';

export function Users({ token, onUnauthorized }: AuthProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (editing === null && opener.current) {
      (opener.current.isConnected ? opener.current : addButton.current)?.focus();
      opener.current = null;
    }
  }, [editing]);

  function open(user: User | 'new', trigger: HTMLElement) {
    opener.current = trigger; setNotice(''); setEditing(user);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await managementRequest('/api/v1/admin/users', token, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
        if (!response.ok) throw new Error(t("Users.could_not_load_users_please_try_again"));
        const result = await response.json() as User[];
        if (!controller.signal.aborted) setUsers(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("Users.could_not_load_users"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  return <SettingsCard id="users" title={t("Users.users")}>
    <div className="section-header">
      <p className="muted">{t("Users.manage_users_and_their_access_to_arrowcast")}</p>
      <button ref={addButton} onClick={(event) => open('new', event.currentTarget)}>{t("CompetitionsPage.add")}</button>
    </div>
    {notice && <p className="success" role="status">{message(notice)}</p>}
    {loading ? <p role="status">{t("Users.loading_users")}</p> : error ? <div>
      <p className="error" role="alert">{message(error)}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>{t("CompetitionDetailPage.try_again")}</button>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">{t("CompetitionDetailPage.name")}</th><th scope="col">{t("Users.username")}</th><th scope="col">{t("Users.role")}</th></tr></thead>
      <tbody>{users.map((user) => <tr key={user.username} className="user-row" onClick={(event) => open(user, event.currentTarget.querySelector('button')!)}>
        <th scope="row"><button className="user-edit-button">{user.name || user.username}</button></th>
        <td>{user.username}</td><td>{t(roleNames[user.role])}</td>
      </tr>)}</tbody>
    </table></div>}
    {editing !== null && <UserModal token={token} onUnauthorized={onUnauthorized}
      user={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
      onRemoved={(user) => {
        setUsers((current) => current.filter((item) => item.username !== user.username));
        setNotice(t("Users.user_removed", { p0: user.name })); setEditing(null);
      }}
      onSaved={(user) => {
        setUsers((current) => [...current.filter((item) => item.username !== (editing === 'new' ? user.username : editing.username)), user]
          .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username)));
        setNotice(t("Users.user_saved", { p0: user.name })); setEditing(null);
      }} />}
  </SettingsCard>;
}

function UserModal({ token, onUnauthorized, user, onClose, onSaved, onRemoved }: AuthProps & {
  user: User | null; onClose: () => void; onSaved: (user: User) => void;
  onRemoved: (user: User) => void;
}) {
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<User['role']>(user?.role ?? 'competition_manager');
  const [language, setLanguage] = useState<User['language']>(user?.language ?? 'nl');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useModal(onClose, pending);

  async function remove() {
    if (!user || pending) return;
    setPending(true); setError('');
    try {
      const response = await managementRequest(`/api/v1/admin/users/${encodeURIComponent(user.username)}`, token, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      const result = await response.json() as { sessionRevoked?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? t("Users.could_not_remove_the_user_please_try_again"));
      if (result.sessionRevoked) { onUnauthorized(t("Users.your_account_was_removed")); return; }
      onRemoved(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Users.could_not_remove_the_user_please_try_again"));
    } finally { setPending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (!name.trim() || !username.trim() || ((!user || password) && password.trim().length < 8)) {
      setError(t("Users.enter_a_name_username_and_a_password_with_at")); return;
    }
    setPending(true);
    try {
      const response = await managementRequest(user ? `/api/v1/admin/users/${encodeURIComponent(user.username)}` : '/api/v1/admin/users', token, {
        method: user ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), username: username.trim(), role, language, ...((!user || password) ? { password } : {}) }),
      });
      if (response.status === 401) { onUnauthorized(t(expiredMessage)); return; }
      const result = await response.json() as User & { user?: User; sessionRevoked?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? t("Users.could_not_save_the_user_please_try_again"));
      setPassword('');
      if (result.sessionRevoked) { onUnauthorized(t("Users.your_account_was_updated_please_log_in_again")); return; }
      onSaved(result.user ?? result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Users.could_not_save_the_user_please_try_again"));
    } finally { setPending(false); }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="user-modal-title">
    <h2 id="user-modal-title">{user ? t("Users.edit_user") : t("Users.add_user")}</h2>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label htmlFor="user-name">{t("CompetitionDetailPage.name")}</label>
        <input id="user-name" autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="user-username">{t("Users.username")}</label>
        <input id="user-username" required maxLength={100} autoComplete="off" readOnly={user?.username === 'admin'} value={username} onChange={(event) => setUsername(event.target.value)} />
        {user?.username === 'admin' ? <p className="muted">{t("Users.log_in_as_admin_and_use_change_password_in")}</p> : <>
        <label htmlFor="user-password">{user ? t("Users.reset_password") : t("Users.initial_password")}</label>
        <input id="user-password" type="password" required={!user} minLength={8} maxLength={1024} autoComplete="new-password"
          aria-describedby="user-password-help" value={password} onChange={(event) => setPassword(event.target.value)} />
        <small id="user-password-help" className="muted">{user ? t("Users.leave_blank_to_keep_the_current_password_a_reset")
          : t("Users.use_at_least_8_characters_the_user_must_change")}</small>
        </>}
        <label htmlFor="user-language">{t('language.label')}</label>
        <select id="user-language" value={language} onChange={(event) => setLanguage(event.target.value as User['language'])}>
          <option value="nl">{t('language.nl')}</option><option value="en">{t('language.en')}</option>
        </select>
        <label htmlFor="user-role">{t("Users.role")}</label>
        <select id="user-role" value={role} onChange={(event) => setRole(event.target.value as User['role'])}>
          <option value="competition_manager">{t("Users.competition_manager")}</option><option value="admin">{t("Users.administrator")}</option>
        </select>
      </fieldset>
      {error && <p className="error" role="alert">{message(error)}</p>}
      <div className="modal-actions">
        {user && user.username !== 'admin' && <button type="button" className="danger" onClick={() => { void remove(); }} disabled={pending}>{t("Users.remove_user")}</button>}
        <button type="button" className="secondary" onClick={onClose} disabled={pending}>{t("PasswordChangeForm.cancel")}</button>
        <button type="submit" disabled={pending}>{pending ? t("CompetitionDetailsModal.saving") : user ? t("Users.save_user") : t("Users.add_user")}</button>
      </div>
    </form>
  </dialog>;
}
