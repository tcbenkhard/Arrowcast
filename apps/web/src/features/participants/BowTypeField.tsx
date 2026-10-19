import { useState } from 'react';

export function BowTypeField({ types, value, confirmed, disabled, onChange, onConfirm }: {
  types: string[]; value: string; confirmed: boolean; disabled: boolean;
  onChange: (value: string) => void; onConfirm: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = types.filter((type) => type.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  function confirm(type: string) {
    onConfirm(type); setOpen(false); setActive(0);
  }
  return <div className="participant-search-field">
    <label htmlFor="participant-bow-type">Bow type</label>
    <input id="participant-bow-type" role="combobox" aria-autocomplete="list" autoComplete="off"
      aria-expanded={open} aria-controls={open ? 'bow-type-suggestions' : undefined}
      aria-activedescendant={open && options[active] ? `bow-type-option-${active}` : undefined}
      value={value} disabled={disabled} placeholder="Select a bow type"
      onFocus={() => { if (!confirmed) setOpen(true); }} onBlur={() => setOpen(false)}
      onChange={(event) => { onChange(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) { setOpen(true); setActive(0); }
          else if (options.length) setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (open || !confirmed) { if (options[active]) confirm(options[active]!); }
        }
      }} />
    {open && <ul id="bow-type-suggestions" role="listbox" aria-label="Bow type suggestions" className="participant-suggestions">
      {options.map((type, index) => <li role="presentation" key={type}>
        <button type="button" tabIndex={-1} id={`bow-type-option-${index}`} role="option" aria-selected={active === index}
          onMouseDown={(event) => event.preventDefault()} onClick={() => confirm(type)}>{type}</button>
      </li>)}
    </ul>}
    {open && !options.length && <p className="muted participant-search-hint">No matching bow types.</p>}
  </div>;
}
