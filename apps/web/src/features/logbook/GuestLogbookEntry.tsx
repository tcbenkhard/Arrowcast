import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { LanguageSelect } from '../../components/LanguageSelect';
import { t } from '../../i18n';
import { ScoreKeypad } from '../scoring/ScoreKeypad';
import { ScoreSheet } from '../scoring/ScoreSheet';

const emptyRounds = (): (string | null)[][] => Array.from({ length: 10 }, () => [null, null, null]);
const total = (arrows: (string | null)[]) =>
  arrows.reduce<number>((sum, arrow) => sum + (arrow === 'M' ? 0 : Number(arrow)), 0);

// Guest scores live only in this component's memory and disappear when it unmounts.
export function GuestLogbookEntry({ onExit }: { onExit: () => void }) {
  const [rounds, setRounds] = useState(emptyRounds);
  const [round, setRound] = useState(0);
  const [arrowIndex, setArrowIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const complete = rounds.every((values) => values.every((arrow) => arrow !== null));

  function chooseRound(index: number) {
    setRound(index);
    const empty = rounds[index]!.findIndex((arrow) => arrow === null);
    setArrowIndex(empty < 0 ? 2 : empty);
  }

  return (
    <main className="scoring-page">
      <section className="panel">
        <div className="logbook-entry-header">
          <h1>{t('logbook.title')}</h1>
          <button
            type="button"
            className="danger logbook-exit"
            aria-label={t('logbook.exit')}
            title={t('logbook.exit')}
            onClick={() => {
              if (window.confirm(t('logbook.confirmExit'))) onExit();
            }}
          >
            <Icon name="exit" />
          </button>
        </div>
        <h2>{t('logbook.guest')}</h2>
        {finished ? (
          <>
            <p role="status">
              {t('logbook.guestResult', { total: rounds.reduce((sum, arrows) => sum + total(arrows), 0) })}
            </p>
            <button
              onClick={() => {
                setRounds(emptyRounds());
                setRound(0);
                setArrowIndex(0);
                setFinished(false);
              }}
            >
              {t('logbook.newEntry')}
            </button>
          </>
        ) : (
          <div className="score-entry">
            <p>{t('scoring.roundProgress', { round: round + 1, rounds: 10, arrows: 3 })}</p>
            <ScoreKeypad
              arrows={rounds[round]!}
              arrowIndex={arrowIndex}
              setArrowIndex={setArrowIndex}
              disabled={false}
              onChange={(arrows) => setRounds(rounds.map((values, index) => (index === round ? arrows : values)))}
            />
            <button
              className="scoring-save"
              disabled={rounds[round]!.some((arrow) => arrow === null)}
              onClick={() => {
                if (complete) setFinished(true);
                else chooseRound(rounds.findIndex((values) => values.includes(null)));
              }}
            >
              {t(complete ? 'logbook.finish' : 'logbook.guestNextRound')}
            </button>
          </div>
        )}
        <ScoreSheet
          rounds={rounds.map((arrows, index) => ({ roundNumber: index + 1, arrows, total: total(arrows) }))}
          numberOfRounds={10}
          arrowsPerRound={3}
          currentRoundNumber={10}
          selectedRound={round + 1}
          disabled={finished}
          onSelectRound={(number) => chooseRound(number - 1)}
        />
      </section>
      <footer className="scoring-footer">
        <LanguageSelect flags />
      </footer>
    </main>
  );
}
