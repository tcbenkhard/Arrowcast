import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db/index.js';
import { clubs, participants } from '../src/db/schema.js';
import { createPageFetcher, latestCompetitions, parseRegion, saveParticipants, scrapeLatestParticipants } from '../src/modules/participants/import.js';

test('page fetcher stops before requesting the source when internet access is lost', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  await assert.rejects(createPageFetcher(async () => false)('https://mijn.handboogsport.nl/bondscompetities/'), /Internetverbinding/);
  assert.equal(request.mock.callCount(), 0);
});

const regionHtml = `<h1>Regiocompetitie individueel</h1>
  <h2 id="filters" data-url="/bondscompetities/uitslagen/indoor-2026-2027/regio-individueel/~2/~1/">Filters</h2>
  <input name="filter_1" data-url="r"><input name="filter_1" data-url="bb">
  <input name="filter_2" data-url="101"><input name="filter_2" data-url="102">
  <label><input name="ver" value="ver_0012"><span>[0012]&nbsp;Boog &amp; Pijl (Utrecht)</span></label>
  <label><input name="ver" value="ver_0013"><span>[0013] Andere club (Ede)</span></label>
  <table><tr><th></th><th>Sporter</th><th>Vereniging</th></tr>
  <tr><td>1</td><td>[000123] Zoë van Dijk</td><td><span>[0012] Boog &amp; Pijl</span></td></tr></table>`;

test('source parsing preserves numbers, accents and entities and includes clubs without participants', () => {
  assert.deepEqual(parseRegion(regionHtml), {
    clubs: [{ clubNumber: '0012', name: 'Boog & Pijl' }, { clubNumber: '0013', name: 'Andere club' }],
    participants: [{ federationNumber: '000123', name: 'Zoë van Dijk', clubNumber: '0012' }],
  });
  assert.throws(() => parseRegion('<h1>Inloggen</h1>'), /Onverwachte pagina/);
  assert.throws(() => parseRegion(regionHtml.replace('[0012] Boog &amp; Pijl', 'onbekend')), /Vereniging ontbreekt/);
});

test('discovers latest season and visits every region and bow, deduplicating memberships', async () => {
  const index = '<a href="/bondscompetities/indoor-2025-2026/">Oud</a><a href="/bondscompetities/indoor-2026-2027/">Actueel</a>';
  assert.equal(latestCompetitions(index).season, '2026-2027');
  const requests: string[] = [];
  const data = await scrapeLatestParticipants(async (url) => {
    requests.push(url);
    if (url.endsWith('/bondscompetities/')) return index;
    if (url.endsWith('/bondscompetities/indoor-2026-2027/')) {
      return '<a href="/bondscompetities/uitslagen/indoor-2026-2027/regio-individueel/r/">Regio</a>';
    }
    return regionHtml;
  });
  assert.equal(data.pages, 4);
  assert.equal(data.participants.length, 1);
  for (const region of ['101', '102']) for (const bow of ['r', 'bb']) {
    assert.ok(requests.some((url) => url.endsWith(`/regio-individueel/${region}/${bow}/`)));
  }
  assert.throws(() => latestCompetitions('<h1>Onderhoud</h1>'), /Geen actuele competitie/);
});

test('reimport updates membership and name while preserving IDs and unrelated data; failures roll back', () => {
  const database = openDatabase(':memory:');
  try {
    const data = parseRegion(regionHtml);
    saveParticipants(database.db, data);
    const first = database.db.select().from(participants).get()!;
    saveParticipants(database.db, { clubs: data.clubs, participants: [{ ...data.participants[0]!, name: 'Nieuwe naam', clubNumber: '0013' }] });
    assert.deepEqual(database.db.select().from(participants).get(), { ...first, name: 'Nieuwe naam', clubNumber: '0013' });
    assert.equal(database.db.select().from(clubs).all().length, 2);
    assert.throws(() => saveParticipants(database.db, {
      clubs: [{ clubNumber: '0014', name: 'Rollback' }],
      participants: [{ federationNumber: '999', name: 'Ongeldig', clubNumber: 'unknown' }],
    }), /FOREIGN KEY constraint failed/);
    assert.equal(database.db.select().from(clubs).all().length, 2);
    assert.equal(database.db.select().from(participants).all().length, 1);
  } finally { database.close(); }
});
