import { useState } from 'react';
import { t } from '../../i18n';
import { ScoreKeypad } from '../scoring/ScoreKeypad';

export function SecurityCodeEntry({
  pin,
  confirming,
  disabled,
  onPinChange,
}: {
  pin: string;
  confirming: boolean;
  disabled: boolean;
  onPinChange: (value: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const value = pin;
  const values = Array.from({ length: 6 }, (_, slot) => value[slot] ?? null);
  function change(next: (string | null)[]) {
    onPinChange(next.filter((digit) => digit !== null).join(''));
  }
  return (
    <div
      className="score-entry security-code-entry"
      onKeyDown={(event) => {
        if (disabled || (event.target instanceof HTMLButtonElement && ['Enter', ' '].includes(event.key))) return;
        if (/^[0-9]$/.test(event.key)) {
          event.preventDefault();
          const activeIndex = Math.min(index, value.length);
          change(values.map((digit, slot) => (slot === activeIndex ? event.key : digit)));
          setIndex(Math.min(activeIndex + 1, 5));
        }
        if (event.key === 'Backspace' && value.length > 0) {
          event.preventDefault();
          const activeIndex = Math.min(index, value.length);
          const clearIndex = values[activeIndex] === null ? activeIndex - 1 : activeIndex;
          change(values.map((digit, slot) => (slot === clearIndex ? null : digit)));
          setIndex(clearIndex);
        }
      }}
    >
      <p className="security-code-help">{t('logbook.codeLength')}</p>
      <ScoreKeypad
        mode="pin"
        label={t(confirming ? 'logbook.confirmPin' : 'logbook.pin')}
        arrows={values}
        arrowIndex={Math.min(index, value.length)}
        setArrowIndex={setIndex}
        disabled={disabled}
        onChange={change}
      />
    </div>
  );
}
