import { t } from '../../i18n';
export function BowTypeField({
  types,
  value,
  disabled,
  onChange,
}: {
  types: string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="participant-search-field">
      <label htmlFor="participant-bow-type">{t('BowTypeField.bow_type')}</label>
      <select
        id="participant-bow-type"
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {t('BowTypeField.select_a_bow_type')}
        </option>
        {types.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </div>
  );
}
