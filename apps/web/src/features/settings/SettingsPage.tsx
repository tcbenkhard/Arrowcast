import { useNavigate } from 'react-router';
import { t } from '../../i18n';
import { ParticipantImport } from '../participants/ParticipantImport';
import { RangesPage } from '../ranges/RangesPage';
import { TargetTypesPage } from '../target-types/TargetTypesPage';
import { Network } from './Network';
import { PublicAccess } from './PublicAccess';
import { SettingsCard } from './SettingsCard';
import { Updates } from './Updates';
import { Users } from './Users';
import { Club } from './Club';
import { ApiKeys } from './ApiKeys';

export function SettingsPage({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const navigate = useNavigate();
  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <h2 id="settings-heading">{t('AdminPage.settings')}</h2>
      <div className="settings-cards">
        <Club token={token} onUnauthorized={onUnauthorized} />
        <RangesPage token={token} onUnauthorized={onUnauthorized} />
        <TargetTypesPage token={token} onUnauthorized={onUnauthorized} />
        <Users token={token} onUnauthorized={onUnauthorized} />
        <Updates token={token} onUnauthorized={onUnauthorized} />
        <Network token={token} onUnauthorized={onUnauthorized} />
        <PublicAccess token={token} onUnauthorized={onUnauthorized} />
        <ApiKeys token={token} onUnauthorized={onUnauthorized} />
        <ParticipantImport token={token} onUnauthorized={onUnauthorized} />
        <SettingsCard id="advanced" icon="settings" title={t('Logs.advanced')}>
          <button onClick={() => navigate('/admin/logs')}>{t('Logs.view')}</button>
        </SettingsCard>
      </div>
    </section>
  );
}
