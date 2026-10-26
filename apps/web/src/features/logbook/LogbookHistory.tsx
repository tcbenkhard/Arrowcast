import type { LogbookHistoryEntry } from '@arrowcast/contracts';
import { getLanguage, t } from '../../i18n';

export function LogbookHistory({ entries }: { entries: LogbookHistoryEntry[] }) {
  return (
    <div className="table-scroll">
      <h3>{t('logbook.history')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('logbook.date')}</th>
            <th>{t('logbook.score')}</th>
            <th>{t('logbook.averageArrow')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.completedAt).toLocaleString(getLanguage())}</td>
              <td>{entry.total}</td>
              <td>{(entry.total / 30).toLocaleString(getLanguage(), { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
