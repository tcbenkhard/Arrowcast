import type { ScoreCorrectionSheet } from '@arrowcast/contracts';
import { calculateRoundTotal } from '@arrowcast/scoring';
import { useEffect, useState } from 'react';
import { useModal } from '../../hooks/useModal';
import { message, t } from '../../i18n';
import { managementRequest } from '../../lib/http';

interface Props {
  competitionId: string;
  token: string;
  onUnauthorized: (message: string) => void;
  onSaved: () => void;
  participantId: string;
  name: string;
  onClose: () => void;
}

export function CorrectionModal({
  competitionId,
  token,
  onUnauthorized,
  participantId,
  name,
  onClose,
  onSaved,
}: Props) {
  const [sheet, setSheet] = useState<ScoreCorrectionSheet | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useModal(onClose, pending);
  const url = `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/participants/${encodeURIComponent(participantId)}/score-correction`;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await managementRequest(url, token, { signal: controller.signal, cache: 'no-store' });
        if (response.status === 401) {
          onUnauthorized(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
          return;
        }
        if (!response.ok) throw new Error(t('CompetitionDetailPage.loading_failed'));
        const result = (await response.json()) as ScoreCorrectionSheet;
        if (!controller.signal.aborted) setSheet(result);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => controller.abort();
  }, [url, token, onUnauthorized]);
  let cumulative = 0;
  return (
    <dialog ref={dialog} className="range-modal score-correction-modal" aria-labelledby="score-correction-title">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!sheet || pending) return;
          setPending(true);
          setError('');
          try {
            const response = await managementRequest(url, token, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sheet),
            });
            if (response.status === 401) {
              onUnauthorized(t('AdminPage.je_sessie_is_verlopen_of_ongeldig_log_opnieuw_in'));
              return;
            }
            if (!response.ok) {
              const result = (await response.json()) as { message?: string };
              throw new Error(result.message ?? t('ScoreCorrection.invalid'));
            }
            onSaved();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <h2 id="score-correction-title">
          {t('ScoringPage.scoresheet')}: {name}
        </h2>
        {error && (
          <p className="error" role="alert">
            {message(error)}
          </p>
        )}
        {!sheet ? (
          <p role="status">{t('CompetitionDetailPage.loading_competition_details')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('ScoringPage.round')}</th>
                  {sheet.rounds[0]?.map((_, index) => (
                    <th key={index}>{t('scoring.arrowHeading', { number: index + 1 })}</th>
                  ))}
                  <th>{t('scoring.subtotalHeading')}</th>
                  <th>{t('scoring.totalHeading')}</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rounds.map((arrows, roundIndex) => {
                  const total = calculateRoundTotal(arrows);
                  cumulative += total;
                  return (
                    <tr key={roundIndex}>
                      <th scope="row">{roundIndex + 1}</th>
                      {arrows.map((arrow, arrowIndex) => (
                        <td key={arrowIndex}>
                          <input
                            aria-label={`${t('ScoringPage.round')} ${roundIndex + 1}, ${t('scoring.arrowHeading', { number: arrowIndex + 1 })}`}
                            value={arrow ?? ''}
                            pattern="M|[1-9]|10"
                            maxLength={2}
                            disabled={pending}
                            onChange={(event) => {
                              const value = event.target.value.toUpperCase();
                              setSheet({
                                ...sheet,
                                rounds: sheet.rounds.map((round, index) =>
                                  index === roundIndex
                                    ? round.map((score, index) => (index === arrowIndex ? value || null : score))
                                    : round,
                                ),
                              });
                            }}
                          />
                        </td>
                      ))}
                      <td>{total}</td>
                      <td>{cumulative}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" disabled={pending} onClick={onClose}>
            {t('PasswordChangeForm.cancel')}
          </button>
          <button type="submit" disabled={!sheet || pending}>
            {t('CompetitionDetailsModal.save_changes')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
