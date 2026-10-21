import { t } from '../../i18n';
import { useState } from 'react';
import type { ReactNode } from 'react';

export function SettingsCard({
  id,
  title,
  defaultExpanded = false,
  forceExpanded = false,
  children,
}: {
  id: string;
  title: string;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
  children: ReactNode;
}) {
  const [manuallyExpanded, setExpanded] = useState(defaultExpanded);
  const expanded = forceExpanded || manuallyExpanded;

  return (
    <section className="panel collapsible-panel" aria-labelledby={`${id}-heading`}>
      <div className="section-header collapsible-panel-header">
        <h3 id={`${id}-heading`}>{title}</h3>
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
          onClick={() => setExpanded((value) => !value)}
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
