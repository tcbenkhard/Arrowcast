import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useRef, useState } from 'react';
import { TargetTypesPage } from '../target-types/TargetTypesPage';
import { RangesPage } from '../ranges/RangesPage';
import { SettingsCard } from './SettingsCard';
import { ArrowcastHostname } from './ArrowcastHostname';
import { Updates } from './Updates';
import { Network } from './Network';
import { Users } from './Users';

interface ImportState {
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: string | null;
  result: { season: string; participants: number; clubs: number } | null;
  error: string | null;
  available?: boolean;
  message?: string | null;
}

export function SettingsPage({ token, onUnauthorized }: {
  token: string;
  onUnauthorized: (message: string) => void;
}) {
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
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in")); return; }
        if (!response.ok) throw new Error(t("SettingsPage.status_unavailable"));
        const result = await response.json() as ImportState;
        if (controller.signal.aborted) return;
        setState(result); setError('');
        timer = setTimeout(() => { void refresh(); }, result.status === 'running' ? 1500 : 3000);
      } catch {
        if (!controller.signal.aborted) setError(t("SettingsPage.de_importstatus_kon_niet_worden_opgehaald_controleer_de_verbinding"));
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, onUnauthorized, retry]);

  async function startImport() {
    if (starting.current || state?.status === 'running' || state?.available === false) return;
    starting.current = true;
    setPending(true); setError('');
    try {
      const response = await managementRequest('/api/v1/admin/participants/import', token, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) { onUnauthorized(t("AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in")); return; }
      if (response.status === 503) {
        const result = await response.json() as ImportState;
        if (result.available === false) { setState(result); setRetry((value) => value + 1); return; }
      }
      if (!response.ok && response.status !== 409) throw new Error(t("SettingsPage.import_start_failed"));
      setState({ status: 'running', progress: t("SettingsPage.de_import_wordt_gestart"), result: null, error: null });
      setRetry((value) => value + 1);
    } catch {
      setError(t("SettingsPage.de_import_kon_niet_worden_gestart_controleer_de_importstatus"));
    } finally {
      starting.current = false; setPending(false);
    }
  }

  const running = state?.status === 'running';
  return <section className="settings-page" aria-labelledby="settings-heading">
    <h2 id="settings-heading">{t("AdminPage.settings")}</h2>
    <div className="settings-cards">
      <RangesPage token={token} onUnauthorized={onUnauthorized} />
      <TargetTypesPage token={token} onUnauthorized={onUnauthorized} />
      <Users token={token} onUnauthorized={onUnauthorized} />
      <Updates token={token} onUnauthorized={onUnauthorized} />
      <Network token={token} onUnauthorized={onUnauthorized} />
      <ArrowcastHostname />
      <SettingsCard id="participant-import" title={t("SettingsPage.deelnemers_importeren")}>
        <p>{t("SettingsPage.importeer_deelnemers_en_verenigingen_uit_de_nieuwste_regiocompetities_van")}</p>
        <button disabled={!state || state.available === false || pending || running || !!error} onClick={() => { void startImport(); }}>
          {t("SettingsPage.importeer_deelnemers_uit_handboogsport")}</button>
        {state?.available === false && <p role="status">{message(state.message)}</p>}
        {(!state && !error) && <p role="status">{t("SettingsPage.importstatus_ophalen")}</p>}
        {(running || pending) && <p role="status" aria-live="polite">{t("SettingsPage.bezig_met_importeren")} {message(state?.progress)}</p>}
        {state?.status === 'completed' && state.result && <p className="success" role="status">
          {t('import.completed', { date: state.result.season, participants: state.result.participants, clubs: state.result.clubs })}</p>}
        {state?.status === 'failed' && <p className="error" role="alert">{message(state.error)}</p>}
        {error && <div><p className="error" role="alert">{message(error)}</p>
          <button className="secondary retry-button" onClick={() => { setError(''); setRetry((value) => value + 1); }}>{t("SettingsPage.importstatus_opnieuw_ophalen")}</button>
        </div>}
      </SettingsCard>
    </div>
  </section>;
}
