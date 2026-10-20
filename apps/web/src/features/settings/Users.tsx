import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useModal } from '../../hooks/useModal';
import { SettingsCard } from './SettingsCard';

interface User {
  name: string;
  username: string;
  role: 'admin' | 'competition_manager';
  forceChangePassword: boolean;
}
interface AuthProps {
  token: string;
  onUnauthorized: (message: string) => void;
}
const roleNames = { admin: 'Administrator', competition_manager: 'Competition manager' };
const expiredMessage = 'Je sessie is verlopen of ongeldig. Log opnieuw in.';

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
        const response = await fetch('/api/v1/admin/users', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized(expiredMessage); return; }
        if (!response.ok) throw new Error('Could not load users. Please try again.');
        const result = await response.json() as User[];
        if (!controller.signal.aborted) setUsers(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load users.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token, onUnauthorized, retry]);

  return <SettingsCard id="users" title="Users">
    <div className="section-header">
      <p className="muted">Manage users and their access to ArrowCast.</p>
      <button ref={addButton} onClick={(event) => open('new', event.currentTarget)}>Add</button>
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {loading ? <p role="status">Loading users...</p> : error ? <div>
      <p className="error" role="alert">{error}</p>
      <button className="secondary retry-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
    </div> : <div className="table-scroll"><table>
      <thead><tr><th scope="col">Name</th><th scope="col">Username</th><th scope="col">Role</th></tr></thead>
      <tbody>{users.map((user) => <tr key={user.username} className="user-row" onClick={(event) => open(user, event.currentTarget.querySelector('button')!)}>
        <th scope="row"><button className="user-edit-button">{user.name || user.username}</button></th>
        <td>{user.username}</td><td>{roleNames[user.role]}</td>
      </tr>)}</tbody>
    </table></div>}
    {editing !== null && <UserModal token={token} onUnauthorized={onUnauthorized}
      user={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
      onRemoved={(user) => {
        setUsers((current) => current.filter((item) => item.username !== user.username));
        setNotice(`User "${user.name}" removed.`); setEditing(null);
      }}
      onSaved={(user) => {
        setUsers((current) => [...current.filter((item) => item.username !== (editing === 'new' ? user.username : editing.username)), user]
          .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username)));
        setNotice(`User "${user.name}" saved.`); setEditing(null);
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useModal(onClose, pending);

  async function remove() {
    if (!user || pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(user.username)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      const result = await response.json() as { sessionRevoked?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? 'Could not remove the user. Please try again.');
      if (result.sessionRevoked) { onUnauthorized('Your account was removed.'); return; }
      onRemoved(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove the user. Please try again.');
    } finally { setPending(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (!name.trim() || !username.trim() || ((!user || password) && password.trim().length < 8)) {
      setError('Enter a name, username and a password with at least 8 characters.'); return;
    }
    setPending(true);
    try {
      const response = await fetch(user ? `/api/v1/admin/users/${encodeURIComponent(user.username)}` : '/api/v1/admin/users', {
        method: user ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), username: username.trim(), role, ...((!user || password) ? { password } : {}) }),
      });
      if (response.status === 401) { onUnauthorized(expiredMessage); return; }
      const result = await response.json() as User & { user?: User; sessionRevoked?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? 'Could not save the user. Please try again.');
      setPassword('');
      if (result.sessionRevoked) { onUnauthorized('Your account was updated. Please log in again.'); return; }
      onSaved(result.user ?? result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the user. Please try again.');
    } finally { setPending(false); }
  }

  return <dialog ref={dialog} className="range-modal" aria-labelledby="user-modal-title">
    <h2 id="user-modal-title">{user ? 'Edit user' : 'Add user'}</h2>
    <form onSubmit={(event) => { void submit(event); }} aria-busy={pending}>
      <fieldset disabled={pending}>
        <label htmlFor="user-name">Name</label>
        <input id="user-name" autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="user-username">Username</label>
        <input id="user-username" required maxLength={100} autoComplete="off" readOnly={user?.username === 'admin'} value={username} onChange={(event) => setUsername(event.target.value)} />
        {user?.username === 'admin' ? <p className="muted">Log in as admin and use Change password in your profile to change this password.</p> : <>
        <label htmlFor="user-password">{user ? 'Reset password' : 'Initial password'}</label>
        <input id="user-password" type="password" required={!user} minLength={8} maxLength={1024} autoComplete="new-password"
          aria-describedby="user-password-help" value={password} onChange={(event) => setPassword(event.target.value)} />
        <small id="user-password-help" className="muted">{user ? 'Leave blank to keep the current password. A reset requires a password change at next login.'
          : 'Use at least 8 characters. The user must change this password at first login.'}</small>
        </>}
        <label htmlFor="user-role">Role</label>
        <select id="user-role" value={role} onChange={(event) => setRole(event.target.value as User['role'])}>
          <option value="competition_manager">Competition manager</option><option value="admin">Administrator</option>
        </select>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        {user && user.username !== 'admin' && <button type="button" className="danger" onClick={() => { void remove(); }} disabled={pending}>Remove user</button>}
        <button type="button" className="secondary" onClick={onClose} disabled={pending}>Cancel</button>
        <button type="submit" disabled={pending}>{pending ? 'Saving...' : user ? 'Save user' : 'Add user'}</button>
      </div>
    </form>
  </dialog>;
}
