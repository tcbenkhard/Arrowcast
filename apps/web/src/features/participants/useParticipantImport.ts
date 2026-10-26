import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest } from '../../lib/http';

interface ImportState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: string | null;
  result: { season: string; participants: number; clubs: number } | null;
  error: string | null;
  available?: boolean;
  message?: string | null;
}

/** Coordinates starting an import and polling its progress, including offline recovery. */
export function useParticipantImport(token: string, onUnauthorized: (message: string) => void) {
  const [state, setState] = useState<ImportState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const starting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await managementRequest('/api/v1/admin/participants/import', token, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          onUnauthorized(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
          return;
        }
        if (!response.ok) throw new Error(t('SettingsPage.status_unavailable'));
        const result = (await response.json()) as ImportState;
        if (controller.signal.aborted) return;
        setState(result);
        setError('');
        timer = setTimeout(
          () => {
            void refresh();
          },
          result.status === 'running' ? 1500 : 3000,
        );
      } catch {
        if (!controller.signal.aborted)
          setError(t('SettingsPage.de_importstatus_kon_niet_worden_opgehaald_controleer_de_verbinding'));
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, onUnauthorized, retry]);

  async function startImport() {
    if (starting.current || state?.status === 'running' || state?.available === false) return;
    starting.current = true;
    setPending(true);
    setError('');
    try {
      const response = await managementRequest('/api/v1/admin/participants/import', token, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) {
        onUnauthorized(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
        return;
      }
      if (response.status === 503) {
        const result = (await response.json()) as ImportState;
        if (result.available === false) {
          setState(result);
          setRetry((value) => value + 1);
          return;
        }
      }
      if (!response.ok && response.status !== 409) throw new Error(t('SettingsPage.import_start_failed'));
      setState({ status: 'running', progress: t('SettingsPage.de_import_wordt_gestart'), result: null, error: null });
      setRetry((value) => value + 1);
    } catch {
      setError(t('SettingsPage.de_import_kon_niet_worden_gestart_controleer_de_importstatus'));
    } finally {
      starting.current = false;
      setPending(false);
    }
  }

  const running = state?.status === 'running';
  function retryStatus() {
    setError('');
    setRetry((value) => value + 1);
  }
  return { state, error, pending, running, startImport, retryStatus };
}
