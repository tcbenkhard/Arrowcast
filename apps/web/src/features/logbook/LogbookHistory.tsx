import type { LogbookHistoryEntry } from '@arrowcast/contracts';
import { calculateRoundTotal } from '@arrowcast/scoring';
import { useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { getLanguage, t } from '../../i18n';
import { ScoreSheet } from '../scoring/ScoreSheet';

function HistorySheetModal({ entry, onClose }: { entry: LogbookHistoryEntry; onClose: () => void }) {
  const dialog = useModal(onClose, false);
  return (
    <dialog ref={dialog} className="range-modal" aria-labelledby="logbook-sheet-title">
      <div className="section-header">
        <h2 id="logbook-sheet-title">{t('ScoringPage.scoresheet')}</h2>
        <button type="button" className="secondary" onClick={onClose}>
          {t('logbook.close')}
        </button>
      </div>
      <p>{new Date(entry.completedAt).toLocaleString(getLanguage())}</p>
      <ScoreSheet
        rounds={entry.rounds.map((arrows, index) => ({
          roundNumber: index + 1,
          arrows,
          total: calculateRoundTotal(arrows),
        }))}
        numberOfRounds={entry.rounds.length}
        arrowsPerRound={3}
        currentRoundNumber={entry.rounds.length}
        selectedRound={0}
        disabled
        onSelectRound={() => {}}
      />
      <p>
        {t('logbook.score')}: <strong>{entry.total}</strong>
      </p>
    </dialog>
  );
}

export function LogbookHistory({ entries }: { entries: LogbookHistoryEntry[] }) {
  const [selected, setSelected] = useState<LogbookHistoryEntry | null>(null);
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
            <tr key={entry.id} onClick={() => setSelected(entry)} className="logbook-history-row">
              <td>
                <button
                  type="button"
                  className="range-edit-button"
                  aria-haspopup="dialog"
                  onClick={() => setSelected(entry)}
                >
                  {new Date(entry.completedAt).toLocaleString(getLanguage())}
                </button>
              </td>
              <td>{entry.total}</td>
              <td>{(entry.total / 30).toLocaleString(getLanguage(), { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && <HistorySheetModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
