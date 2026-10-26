import { calculateRoundTotal } from '@arrowcast/scoring';
import { t } from '../../i18n';

const buttons = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'M'];

export function ScoreKeypad({
  arrows,
  arrowIndex,
  setArrowIndex,
  disabled,
  onChange,
  mode = 'score',
  label,
}: {
  arrows: (string | null)[];
  arrowIndex: number;
  setArrowIndex: (index: number) => void;
  disabled: boolean;
  onChange: (arrows: (string | null)[]) => void;
  mode?: 'score' | 'pin';
  label?: string;
}) {
  return (
    <>
      <div className="scoring-arrow-row">
        <div
          className={`scoring-arrow-slots${arrows.length <= 6 ? ' scoring-arrow-slots-single-row' : ''}`}
          role="group"
          aria-label={label ?? t('ScoringPage.arrow_scores')}
        >
          {arrows.map((symbol, index) => (
            <button
              type="button"
              key={index}
              className={index === arrowIndex ? 'selected' : 'secondary'}
              aria-label={
                mode === 'pin'
                  ? t('logbook.codeDigit', { number: index + 1 })
                  : t('ScoringPage.arrow', {
                      p0: index + 1,
                      p1: symbol ?? t('ScoringPage.not_entered'),
                    })
              }
              aria-pressed={index === arrowIndex}
              disabled={disabled}
              onClick={() => setArrowIndex(index)}
            >
              {mode === 'pin' && symbol !== null ? '●' : (symbol ?? '—')}
            </button>
          ))}
        </div>
        {mode === 'score' && (
          <p className="scoring-subtotal">
            <span>{t('ScoringPage.round_total')}</span>
            <strong>{calculateRoundTotal(arrows)}</strong>
          </p>
        )}
      </div>
      <div
        className="scoring-keypad"
        role="group"
        aria-label={mode === 'pin' ? t('logbook.codeKeypad') : t('ScoringPage.score_keypad')}
      >
        {(mode === 'pin' ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] : buttons).map((symbol) => (
          <button
            type="button"
            key={symbol}
            disabled={disabled}
            aria-label={
              mode === 'pin'
                ? t('logbook.digit', { digit: symbol })
                : symbol === 'M'
                  ? t('ScoringPage.score_miss')
                  : t('ScoringPage.score', { p0: symbol })
            }
            onClick={() => {
              onChange(arrows.map((value, index) => (index === arrowIndex ? symbol : value)));
              setArrowIndex(Math.min(arrowIndex + 1, arrows.length - 1));
            }}
          >
            {symbol === 'M' ? t('ScoringPage.miss') : symbol}
          </button>
        ))}
        <button
          type="button"
          className="scoring-backspace"
          aria-label={t('ScoringPage.backspace')}
          disabled={disabled || (arrows[arrowIndex] === null && arrowIndex === 0)}
          onClick={() => {
            const indexToClear = arrows[arrowIndex] === null ? arrowIndex - 1 : arrowIndex;
            onChange(arrows.map((value, index) => (index === indexToClear ? null : value)));
            setArrowIndex(indexToClear);
          }}
        >
          ←
        </button>
      </div>
    </>
  );
}
