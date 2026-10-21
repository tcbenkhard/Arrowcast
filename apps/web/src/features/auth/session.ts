import type { Language } from '../../i18n';

const storageKey = 'arrowcast.admin.jwt';

export interface AdminSession {
  username: string;
  name: string;
  role: 'admin' | 'competition_manager';
  expiresAt: number;
  forceChangePassword: boolean;
  language: Language;
}

export function readAdminToken(storage: Pick<Storage, 'getItem'> = sessionStorage): string | null {
  try {
    return storage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function writeAdminToken(
  token: string | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage,
): void {
  try {
    if (token) storage.setItem(storageKey, token);
    else storage.removeItem(storageKey);
  } catch {
    // Authentication continues in memory when browser storage is unavailable.
  }
}
