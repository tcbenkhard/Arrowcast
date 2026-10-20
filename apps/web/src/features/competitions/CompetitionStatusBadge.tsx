import { t } from '../../i18n';
import type { CompetitionStatus } from './status';

const statusClasses: Record<CompetitionStatus, string> = {
  Scheduled: 'scheduled',
  'Check-in': 'check-in',
  Active: 'active',
  Closed: 'closed',
};

export function CompetitionStatusBadge({ status }: { status: CompetitionStatus }) {
  return <span className={`competition-status-badge competition-status-badge--${statusClasses[status]}`}>{t(`status.${status}`)}</span>;
}
