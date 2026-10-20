import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { load } from 'cheerio';
import type { AppDatabase } from '../../db/index.js';
import { clubs, participants } from '../../db/schema.js';

const origin = 'https://mijn.handboogsport.nl';
type Club = { clubNumber: string; name: string };
type Participant = { federationNumber: string; name: string; clubNumber: string };
export type ImportData = { clubs: Club[]; participants: Participant[] };
type FetchPage = (url: string) => Promise<string>;

function sourceUrl(path: string, base = origin): string {
  const url = new URL(path, base);
  if (url.origin !== origin || !url.pathname.startsWith('/bondscompetities/')) {
    throw new Error(`Onverwachte bron-URL: ${url.href}`);
  }
  return url.href;
}

export function latestCompetitions(html: string): { season: string; urls: string[] } {
  const $ = load(html);
  const competitions = new Map<string, string[]>();
  $('a[href]').each((_, element) => {
    const path = $(element).attr('href')!;
    const match = new URL(path, origin).pathname.match(/^\/bondscompetities\/(?:indoor|25m1pijl)-(\d{4})-(\d{4})\/$/);
    if (!match) return;
    const season = `${match[1]}-${match[2]}`;
    competitions.set(season, [...(competitions.get(season) ?? []), sourceUrl(path)]);
  });
  const season = [...competitions.keys()].sort().at(-1);
  if (!season) throw new Error('Geen actuele competitie gevonden op de bronwebsite.');
  return { season, urls: [...new Set(competitions.get(season)!)] };
}

function numberedName(value: string) {
  return value.replace(/\s+/g, ' ').trim().match(/^\[(\d+)\]\s*(\S.*)$/);
}

export function parseRegion(html: string): ImportData {
  const $ = load(html);
  if (!$('h1').text().includes('Regiocompetitie individueel')) {
    throw new Error('Onverwachte pagina: geen individuele regiocompetitie.');
  }
  const clubMap = new Map<string, Club>();
  $('input[name="ver"][value^="ver_"]').each((_, element) => {
    const match = numberedName($(element).closest('label').text());
    if (!match) throw new Error('Verenigingsfilter heeft een onbekend formaat.');
    clubMap.set(match[1]!, { clubNumber: match[1]!, name: match[2]!.replace(/\s+\([^()]*\)$/, '') });
  });
  const people: Participant[] = [];
  $('tr').each((_, row) => {
    const cells = $(row).children('td');
    const person = numberedName(cells.eq(1).text());
    if (!person) return;
    const club = numberedName(cells.eq(2).text());
    if (!club) throw new Error(`Vereniging ontbreekt bij bondsnummer ${person[1]}.`);
    clubMap.set(club[1]!, { clubNumber: club[1]!, name: club[2]! });
    people.push({ federationNumber: person[1]!, name: person[2]!, clubNumber: club[1]! });
  });
  // Empty regions/boogtypen are valid; a changed results table must not silently disappear.
  if (!people.length && $('th').toArray().some((cell) => $(cell).text().trim() === 'Sporter')) {
    throw new Error('Deelnemerstabel gevonden maar geen deelnemers herkend.');
  }
  return { clubs: [...clubMap.values()], participants: people };
}

export async function scrapeLatestParticipants(
  fetchPage: FetchPage,
  progress: (message: string) => void = () => {},
): Promise<ImportData & { season: string; pages: number }> {
  const latest = latestCompetitions(await fetchPage(`${origin}/bondscompetities/`));
  const clubMap = new Map<string, Club>();
  const participantMap = new Map<string, Participant>();
  let pages = 0;
  for (const competitionUrl of latest.urls) {
    const $ = load(await fetchPage(competitionUrl));
    const path = $('a[href]').toArray().map((a) => $(a).attr('href')!)
      .find((href) => href.includes('/regio-individueel/'));
    if (!path) throw new Error(`Geen regiocompetitie gevonden: ${competitionUrl}`);
    const firstUrl = sourceUrl(path, competitionUrl);
    const firstHtml = await fetchPage(firstUrl);
    const filters = load(firstHtml);
    const template = filters('#filters').attr('data-url');
    const bows = filters('input[name="filter_1"]').toArray().map((el) => filters(el).attr('data-url'));
    const regions = filters('input[name="filter_2"]').toArray().map((el) => filters(el).attr('data-url'));
    if (!template?.includes('~1') || !template.includes('~2') || !bows.length || !regions.length
      || [...bows, ...regions].some((value) => !value || !/^[a-z0-9]+$/.test(value))) {
      throw new Error('Regio- of boogfilters hebben een onbekend formaat.');
    }
    for (const region of regions) {
      for (const bow of bows) {
        const url = sourceUrl(template.replace('~1', bow!).replace('~2', region!));
        const data = parseRegion(await fetchPage(url));
        pages++;
        for (const club of data.clubs) clubMap.set(club.clubNumber, club);
        for (const person of data.participants) {
          const existing = participantMap.get(person.federationNumber);
          if (existing && (existing.name !== person.name || existing.clubNumber !== person.clubNumber)) {
            throw new Error(`Tegenstrijdige gegevens voor bondsnummer ${person.federationNumber}; niets opgeslagen.`);
          }
          participantMap.set(person.federationNumber, person);
        }
        progress(`${latest.season}: regio ${region}, ${bow}: ${data.participants.length} deelnemers`);
      }
    }
  }
  if (!participantMap.size) throw new Error('Geen deelnemers gevonden; niets opgeslagen.');
  return { season: latest.season, pages, clubs: [...clubMap.values()], participants: [...participantMap.values()] };
}

export function saveParticipants(db: AppDatabase, data: ImportData) {
  db.transaction((tx) => {
    for (const club of data.clubs) {
      tx.insert(clubs).values(club).onConflictDoUpdate({ target: clubs.clubNumber, set: { name: club.name } }).run();
    }
    for (const person of data.participants) {
      tx.insert(participants).values({ id: randomUUID(), ...person }).onConflictDoUpdate({
        target: participants.federationNumber, set: { name: person.name, clubNumber: person.clubNumber },
      }).run();
    }
  });
}

export function createPageFetcher(canFetch: () => Promise<boolean> = async () => true): FetchPage {
  let lastRequest = 0;
  return async (url) => {
    // Sequential requests, at most two per second; stop on HTTP errors.
    await setTimeout(Math.max(0, 500 - (Date.now() - lastRequest)));
    if (!await canFetch()) throw new Error('Internetverbinding niet beschikbaar; deelnemersimport gestopt.');
    lastRequest = Date.now();
    const response = await fetch(sourceUrl(url), {
      headers: { 'User-Agent': 'ArrowcastParticipantImport/1.0', Accept: 'text/html' },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Bronwebsite gaf HTTP ${response.status}: ${url}`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error(`Geen HTML ontvangen: ${url}`);
    return response.text();
  };
}
