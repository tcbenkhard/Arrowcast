import type { ReactNode } from 'react';
import { t } from '../../i18n';

export function AppliedSettings({
  children,
  onEdit,
  actions,
}: {
  children: ReactNode;
  onEdit: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="applied-settings">
      <button type="button" className="applied-settings-edit" onClick={onEdit}>
        <strong>{t('Settings.currentSettings')}</strong>
        <span className="applied-settings-values">{children}</span>
        <small>{t('Settings.clickToEdit')}</small>
      </button>
      {actions}
    </div>
  );
}
