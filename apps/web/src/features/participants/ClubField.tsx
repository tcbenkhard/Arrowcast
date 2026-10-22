import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';

type Club = { clubNumber: string; name: string };

export function ClubField({
  clubs,
  clubNumber,
  clubName,
  onChange,
}: {
  clubs: Club[];
  clubNumber: string;
  clubName: string;
  onChange: (number: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(false);
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const suggestions = useRef<HTMLUListElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = clubs.filter((club) =>
    terms.every((term) => normalize(`${club.clubNumber} ${club.name}`).includes(term)),
  );
  const open = !!terms.length && !selected && !creating;
  const knownClub = clubs.find((club) => club.clubNumber === clubNumber.trim());
  useEffect(() => {
    suggestions.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  useEffect(() => {
    if (creating) {
      if (clubNumber) nameInput.current?.focus();
      else numberInput.current?.focus();
    }
  }, [creating]);

  function choose(index: number) {
    if (index === 0) {
      const numeric = /^\d+$/.test(query.trim());
      onChange(numeric ? query.trim() : '', numeric ? '' : query.trim());
      setCreating(true);
    } else {
      const club = matches[index - 1];
      if (!club) return;
      onChange(club.clubNumber, club.name);
      setQuery(`${club.name} (${club.clubNumber})`);
      setSelected(true);
      searchInput.current?.focus();
    }
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || event.nativeEvent.isComposing || event.repeat) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (value + (event.key === 'ArrowDown' ? 1 : matches.length)) % (matches.length + 1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
    if (event.key === 'Tab' && !event.shiftKey && active > 0) choose(active);
  }

  return (
    <div className="participant-search-field">
      {!creating ? (
        <>
          <label htmlFor="participant-club-search">{t('participants.searchClub')}</label>
          <div className="participant-combobox">
            <input
              ref={searchInput}
              id="participant-club-search"
              role="combobox"
              required
              autoComplete="off"
              maxLength={200}
              value={query}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? 'club-suggestions' : undefined}
              aria-activedescendant={open ? `club-option-${active}` : undefined}
              onKeyDown={navigate}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setSelected(false);
                onChange('', '');
                const searchTerms = normalize(value).trim().split(/\s+/).filter(Boolean);
                setActive(
                  searchTerms.length &&
                    clubs.some((club) =>
                      searchTerms.every((term) => normalize(`${club.clubNumber} ${club.name}`).includes(term)),
                    )
                    ? 1
                    : 0,
                );
              }}
            />
            {open && (
              <ul
                ref={suggestions}
                id="club-suggestions"
                role="listbox"
                aria-label={t('participants.clubSuggestions')}
                className="participant-suggestions"
              >
                <li role="presentation">
                  <button
                    type="button"
                    id="club-option-0"
                    role="option"
                    aria-selected={active === 0}
                    tabIndex={-1}
                    onClick={() => choose(0)}
                  >
                    {t('participants.newClub')}
                  </button>
                </li>
                {matches.map((club, index) => (
                  <li role="presentation" key={club.clubNumber}>
                    <button
                      type="button"
                      id={`club-option-${index + 1}`}
                      role="option"
                      aria-selected={active === index + 1}
                      tabIndex={-1}
                      onClick={() => choose(index + 1)}
                    >
                      {club.name} ({club.clubNumber})
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <label htmlFor="participant-club-number">{t('participants.clubNumber')}</label>
          <input
            ref={numberInput}
            id="participant-club-number"
            required
            maxLength={200}
            value={clubNumber}
            onChange={(event) => onChange(event.target.value, clubName)}
          />
          <label htmlFor="participant-club-name">{t('participants.clubName')}</label>
          <input
            ref={nameInput}
            id="participant-club-name"
            required
            maxLength={200}
            value={knownClub?.name ?? clubName}
            readOnly={!!knownClub}
            onChange={(event) => onChange(clubNumber, event.target.value)}
          />
        </>
      )}
    </div>
  );
}
