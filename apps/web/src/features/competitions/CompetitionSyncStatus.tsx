import { Icon } from '../../components/Icon';
import { t, useLanguage } from '../../i18n';
import './competition-sync.css';

export function CompetitionSyncStatus({
  syncedAt,
  compact = false,
}: {
  syncedAt: number | null | undefined;
  compact?: boolean;
}) {
  const language = useLanguage();
  if (syncedAt == null) return null;
  const date = new Date(syncedAt);
  const label = t('CompetitionSyncStatus.syncedOn', {
    date: new Intl.DateTimeFormat(language, { dateStyle: 'short' }).format(date),
    time: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  });

  return compact ? (
    <span className="competition-sync-status" role="img" aria-label={label} title={label}>
      <Icon name="refresh" />
    </span>
  ) : (
    <span className="competition-sync-status">
      <Icon name="refresh" />
      <time dateTime={date.toISOString()}>{label}</time>
    </span>
  );
}
