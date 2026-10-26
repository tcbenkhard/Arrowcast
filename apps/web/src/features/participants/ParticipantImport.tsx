import { message, t } from '../../i18n';
import { SettingsCard } from '../settings/SettingsCard';
import { useParticipantImport } from './useParticipantImport';

export function ParticipantImport({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: (message: string) => void;
}) {
  const { state, error, pending, running, startImport, retryStatus } = useParticipantImport(token, onUnauthorized);
  return (
    <SettingsCard id="participant-import" icon="import" title={t('SettingsPage.deelnemers_importeren')}>
      <p>{t('SettingsPage.importeer_deelnemers_en_verenigingen_uit_de_nieuwste_regiocompetities_van')}</p>
      <button
        disabled={!state || state.available === false || pending || running || !!error}
        onClick={() => {
          void startImport();
        }}
      >
        {t('SettingsPage.importeer_deelnemers_uit_handboogsport')}
      </button>
      {state?.available === false && <p role="status">{message(state.message)}</p>}
      {!state && !error && <p role="status">{t('SettingsPage.importstatus_ophalen')}</p>}
      {(running || pending) && (
        <p role="status" aria-live="polite">
          {t('SettingsPage.bezig_met_importeren')} {message(state?.progress)}
        </p>
      )}
      {state?.status === 'completed' && state.result && (
        <p className="success" role="status">
          {t('import.completed', {
            date: state.result.season,
            participants: state.result.participants,
            clubs: state.result.clubs,
          })}
        </p>
      )}
      {state?.status === 'failed' && (
        <p className="error" role="alert">
          {message(state.error)}
        </p>
      )}
      {error && (
        <div>
          <p className="error" role="alert">
            {message(error)}
          </p>
          <button className="secondary retry-button" onClick={retryStatus}>
            {t('SettingsPage.importstatus_opnieuw_ophalen')}
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
