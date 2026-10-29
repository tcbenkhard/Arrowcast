import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/Icon';
import { t } from '../../i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';

export function SettingsCard({
  id,
  title,
  icon,
  defaultExpanded = false,
  forceExpanded = false,
  onExpandedChange,
  children,
}: {
  id: string;
  title: string;
  icon: IconName;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const [manuallyExpanded, setExpanded] = useState(defaultExpanded);
  const expanded = forceExpanded || manuallyExpanded;

  return (
    <section className="panel collapsible-panel" aria-labelledby={`${id}-heading`}>
      <div className="section-header collapsible-panel-header">
        <h3 id={`${id}-heading`} className="with-icon">
          <Icon name={icon} />
          {title}
        </h3>
        <button
          type="button"
          className="panel-toggle"
          aria-label={t('panel.toggle', {
            action: expanded ? t('CompetitionDetailPage.collapse') : t('CompetitionDetailPage.expand'),
            title,
          })}
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          disabled={forceExpanded}
          onClick={() => {
            setExpanded(!expanded);
            onExpandedChange?.(!expanded);
          }}
        >
          <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </button>
      </div>
      <div id={`${id}-content`} className="collapsible-panel-content" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
