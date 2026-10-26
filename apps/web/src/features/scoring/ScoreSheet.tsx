import { t } from '../../i18n';

export function ScoreSheet({
  rounds: inputRounds,
  numberOfRounds,
  arrowsPerRound,
  currentRoundNumber,
  selectedRound,
  disabled,
  onSelectRound,
}: {
  rounds: { roundNumber: number; arrows: (string | null)[]; total: number }[];
  numberOfRounds: number;
  arrowsPerRound: number;
  currentRoundNumber: number;
  selectedRound: number;
  disabled: boolean;
  onSelectRound: (roundNumber: number) => void;
}) {
  const rounds = new Map(inputRounds.map((round) => [round.roundNumber, round]));
  let cumulativeTotal = 0;
  return (
    <div className="table-scroll participant-scorecard">
      <h3>{t('ScoringPage.scoresheet')}</h3>
      <table aria-label={t('ScoringPage.participant_scores')}>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">{t('ScoringPage.round')}</span>
            </th>
            {Array.from({ length: arrowsPerRound }, (_, index) => (
              <th scope="col" key={index}>
                <span className="visually-hidden">{t('scoring.arrowHeading', { number: index + 1 })}</span>
              </th>
            ))}
            <th scope="col" aria-label={t('ScoringPage.round_total_295')}>
              {t('scoring.subtotalHeading')}
            </th>
            <th scope="col" aria-label={t('ScoringPage.cumulative_total')}>
              {t('scoring.totalHeading')}
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numberOfRounds }, (_, index) => {
            const round = rounds.get(index + 1);
            const hasScores = round?.arrows.some((value) => value !== null);
            const roundDisabled = disabled || index + 1 > currentRoundNumber;
            cumulativeTotal += round?.total ?? 0;
            return (
              <tr
                key={index}
                className={selectedRound === index + 1 ? 'selected-round' : undefined}
                aria-disabled={roundDisabled}
                onClick={() => {
                  if (!roundDisabled) onSelectRound(index + 1);
                }}
              >
                <th scope="row">
                  <button
                    type="button"
                    className="scoresheet-round"
                    aria-label={t('ScoringPage.edit_round', { p0: index + 1 })}
                    aria-pressed={selectedRound === index + 1}
                    disabled={roundDisabled}
                  >
                    {index + 1}
                  </button>
                </th>
                {Array.from({ length: arrowsPerRound }, (_, arrowIndex) => (
                  <td key={arrowIndex}>{round?.arrows[arrowIndex] ?? '—'}</td>
                ))}
                <td>{hasScores ? round!.total : '—'}</td>
                <td>{hasScores ? cumulativeTotal : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
