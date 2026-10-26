import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { managementRequest, requireJson } from '../../lib/http';
import { SettingsCard } from './SettingsCard';

type ClubRecord = { clubNumber: string; name: string };

export function Club({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [clubs, setClubs] = useState<ClubRecord[]>([]);
  const [selected, setSelected] = useState<ClubRecord | null>(null);
  const [query, setQuery] = useState('');
  const [clubNumber, setClubNumber] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const options = {
      signal: controller.signal,
      onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
    };
    void Promise.all([
      managementRequest('/api/v1/admin/clubs', token, options).then(requireJson<ClubRecord[]>),
      managementRequest('/api/v1/admin/settings/club', token, options).then(requireJson<ClubRecord | null>),
    ])
      .then(([known, current]) => {
        if (!controller.signal.aborted) {
          setClubs(known);
          setSelected(current);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t('Club.loadError'));
      });
    return () => controller.abort();
  }, [token, onUnauthorized]);

  async function save(club: ClubRecord | null) {
    setPending(true);
    setError('');
    try {
      const current = await requireJson<ClubRecord | null>(
        await managementRequest('/api/v1/admin/settings/club', token, {
          method: 'PUT',
          json: club ?? { clubNumber: null },
          onUnauthorized: () => onUnauthorized(t('AdminPage.je_sessie_is_verlopen_log_opnieuw_in')),
        }),
      );
      setSelected(current);
      if (current) setClubs((known) => [...known.filter((item) => item.clubNumber !== current.clubNumber), current]);
      setQuery('');
      setClubNumber('');
      setName('');
    } catch {
      setError(t('Club.saveError'));
    } finally {
      setPending(false);
    }
  }
  const search = query.trim().toLocaleLowerCase();
  const matches = search
    ? clubs.filter((club) => `${club.clubNumber} ${club.name}`.toLocaleLowerCase().includes(search)).slice(0, 20)
    : [];
  return (
    <SettingsCard id="club" icon="users" title={t('Club.title')}>
      <p>{t('Club.help')}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{t('logbook.loading')}</p>
      ) : (
        <>
          <p role="status">{selected ? `${selected.clubNumber} · ${selected.name}` : t('Club.none')}</p>
          <fieldset disabled={pending}>
            <label>
              {t('Club.search')}
              <input value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {matches.map((club) => (
              <button type="button" className="secondary" key={club.clubNumber} onClick={() => void save(club)}>
                {club.clubNumber} · {club.name}
              </button>
            ))}
            {search && matches.length === 0 && <p>{t('Club.noMatches')}</p>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save({ clubNumber: clubNumber.trim(), name: name.trim() });
              }}
            >
              <p>{t('Club.manual')}</p>
              <label>
                {t('Club.number')}
                <input
                  required
                  maxLength={200}
                  value={clubNumber}
                  onChange={(event) => setClubNumber(event.target.value)}
                />
              </label>
              <label>
                {t('Club.name')}
                <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <button disabled={!clubNumber.trim() || !name.trim()}>{t('Club.save')}</button>
            </form>
            {selected && (
              <button type="button" className="secondary" onClick={() => void save(null)}>
                {t('Club.clear')}
              </button>
            )}
          </fieldset>
        </>
      )}
    </SettingsCard>
  );
}
