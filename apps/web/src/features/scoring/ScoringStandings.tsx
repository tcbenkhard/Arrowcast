import { CorrectionModal } from './ScoreCorrection';
import { t, message } from '../../i18n';
import { managementRequest } from '../../lib/http';
import { useEffect, useState } from 'react';
import type { ScoringStanding } from '@arrowcast/contracts';
import { arrowScoreValue } from '@arrowcast/scoring';

export function ScoringStandings({
  competitionId,
  token,
  onUnauthorized,
  showAssignment = false,
  canCorrect = false,
  onScoresCorrected,
}: {
  competitionId: string;
  token: string;
  onUnauthorized: (message: string) => void;
  showAssignment?: boolean;
  canCorrect?: boolean;
  onScoresCorrected?: () => void;
}) {
  const [standings, setStandings] = useState<ScoringStanding[] | null>(null);
  const [selected, setSelected] = useState<ScoringStanding | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await managementRequest(
          `/api/v1/admin/competitions/${encodeURIComponent(competitionId)}/scoring-standings`,
          token,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in'));
          return;
        }
        if (!response.ok) throw new Error(t('CompetitionDetailPage.loading_failed'));
        const result = (await response.json()) as ScoringStanding[];
        if (!controller.signal.aborted) {
          setStandings(
            result.map((person) => ({
              ...person,
              lastArrows: [...(person.lastArrows ?? [])].sort((a, b) => arrowScoreValue(b) - arrowScoreValue(a)),
            })),
          );
          setError('');
        }
      } catch {
        if (!controller.signal.aborted) setError(t('ScoringStandings.could_not_refresh_scores_please_try_again'));
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void load();
          }, 5000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [competitionId, token, onUnauthorized, retry]);
  return (
    <>
      {canCorrect && selected && (
        <CorrectionModal
          competitionId={competitionId}
          token={token}
          onUnauthorized={onUnauthorized}
          participantId={selected.participantId}
          name={selected.name}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setNotice(t('ScoreCorrection.saved'));
            setRetry((value) => value + 1);
            onScoresCorrected?.();
          }}
        />
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div>
          <p className="error" role="alert">
            {message(error)}
          </p>
          <button className="secondary" onClick={() => setRetry((value) => value + 1)}>
            {t('CompetitionDetailPage.try_again')}
          </button>
        </div>
      )}
      {!standings ? (
        <p role="status">{t('ScoringStandings.loading_scores')}</p>
      ) : standings.length === 0 ? (
        <p>{t('ScoringStandings.no_participants_assigned')}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table aria-label={t('ScoringStandings.scoring_standings')}>
              <thead>
                <tr>
                  <th scope="col">{t('ScoringStandings.participant')}</th>
                  {showAssignment && <th scope="col">{t('CompetitionParticipants.assignment')}</th>}
                  <th scope="col">{t('ScoringPage.round')}</th>
                  <th scope="col">{t('ScoringStandings.total_score')}</th>
                  <th scope="col" aria-sort="descending">
                    {t('ScoringStandings.average_score')}
                  </th>
                  <th scope="col">{t('ScoringStandings.last_arrows')}</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((person) => (
                  <tr key={person.participantId}>
                    <th scope="row">
                      {canCorrect ? (
                        <button
                          type="button"
                          className="score-correction-participant"
                          onClick={() => {
                            setNotice('');
                            setSelected(person);
                          }}
                          title={t('ScoreCorrection.title')}
                        >
                          {person.name}
                        </button>
                      ) : (
                        person.name
                      )}
                    </th>
                    {showAssignment && (
                      <td>
                        {person.laneNumber != null && person.targetLetter
                          ? `${person.laneNumber} ${person.targetLetter}`
                          : '\u2014'}
                      </td>
                    )}
                    <td>{person.checkedIn === false ? '\u2014' : `${person.enteredRounds}/${person.totalRounds}`}</td>
                    <td>{person.checkedIn === false ? t('ScoringStandings.absent') : person.totalScore}</td>
                    <td>{person.checkedIn === false ? '\u2014' : person.averageScore.toFixed(2)}</td>
                    <td>
                      <span className="standings-last-arrows">
                        {Array.from({ length: 3 }, (_, index) => (
                          <span key={index}>{person.lastArrows?.[index] ?? '\u2014'}</span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
