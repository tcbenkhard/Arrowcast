import { useState } from 'react';
import type { ReactNode } from 'react';

export function SettingsCard({ id, title, defaultExpanded = false, children }: {
  id: string;
  title: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return <section className="panel collapsible-panel" aria-labelledby={`${id}-heading`}>
    <div className="section-header collapsible-panel-header">
      <h3 id={`${id}-heading`}>{title}</h3>
      <button type="button" className="panel-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
        aria-expanded={expanded} aria-controls={`${id}-content`} onClick={() => setExpanded((value) => !value)}>
        <svg className="panel-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </div>
    <div id={`${id}-content`} className="collapsible-panel-content" hidden={!expanded}>{children}</div>
  </section>;
}
