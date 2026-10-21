import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/index.js';
import { clubs, competitions, competitionParticipants, participants, ranges } from '../src/db/schema.js';
import { participantManagementRoutes } from '../src/modules/participants/management.js';
import { matchTarget, readParticipantWorkbook } from '../src/modules/participants/xlsx-import.js';
import { buildApp } from '../src/app.js';

const url = '/competitions/one/participants/import';
const example = () => workbook([['185716', 'Timo Benkhard', 'HS Hilversum', 'Recurve', '40cm']], true);
async function fixture() {
  const database = openDatabase(':memory:');
  const db = database.db;
  db.insert(clubs)
    .values([
      { clubNumber: '12', name: 'HS Hilversum' },
      { clubNumber: '13', name: 'Other club' },
    ])
    .run();
  db.insert(ranges).values({ id: 'range', name: 'Range' }).run();
  db.insert(competitions)
    .values({
      id: 'one',
      name: 'Competition',
      date: '2026-12-01',
      startingTime: '09:00',
      endingTime: '12:00',
      rangeId: 'range',
    })
    .run();
  const app = Fastify();
  await app.register(participantManagementRoutes, { db });
  return {
    app,
    db,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}
async function workbook(rows: string[][], blankFirst = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Participants');
  if (blankFirst) sheet.addRow([]);
  sheet.addRow(['Bondsnummer', 'Schutter', 'Vereniging', 'Boog', 'Blazoen']);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}
const row = ['000123', 'Zoë van Dijk', ' hs hilversum ', 'recurve', '40cm'];

test('workbook skips its blank first row and imports and reimports without duplicates', async () => {
  const { app, db, close } = await fixture();
  try {
    const payload = await example();
    assert.equal((await readParticipantWorkbook(payload))[0]!.row, 3);
    for (const created of [1, 0]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/octet-stream' },
        payload,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { imported: 1, created });
    }
    const person = db.select().from(participants).get()!;
    assert.equal(person.federationNumber, '185716');
    assert.equal(person.clubNumber, '12');
    assert.equal(person.name, 'Timo Benkhard');
    assert.equal(db.select().from(competitionParticipants).all().length, 1);
    const registration = db.select().from(competitionParticipants).get()!;
    assert.equal(registration.bowType, 'Recurve');
    assert.equal(registration.targetType, '40 cm blazoen (10-rings)');
  } finally {
    await close();
  }
});

test('existing federation numbers keep their ID and name and receive club, bow and target from the file', async () => {
  const { app, db, close } = await fixture();
  try {
    db.insert(participants)
      .values({ id: 'existing', name: 'Existing name', federationNumber: '000123', clubNumber: '13' })
      .run();
    const response = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/octet-stream' },
      payload: await workbook([row]),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { imported: 1, created: 0 });
    assert.deepEqual(db.select().from(participants).get(), {
      id: 'existing',
      name: 'Existing name',
      federationNumber: '000123',
      clubNumber: '12',
    });
    assert.equal(db.select().from(competitionParticipants).get()!.participantId, 'existing');
  } finally {
    await close();
  }
});

test('invalid mappings and duplicate numbers report row errors and roll back the entire import', async () => {
  const { app, db, close } = await fixture();
  try {
    for (const invalid of [
      ['999', 'New', 'Unknown club', 'Recurve', '40cm'],
      ['999', 'New', 'HS Hilversum', 'Unknown bow', '40cm'],
      ['999', 'New', 'HS Hilversum', 'Recurve', '999cm'],
      row,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/octet-stream' },
        payload: await workbook([row, invalid], true),
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.match(response.json().message, /Regel 4/);
      assert.equal(db.select().from(participants).all().length, 0);
      assert.equal(db.select().from(competitionParticipants).all().length, 0);
    }
    for (const payload of [
      Buffer.from('not xlsx'),
      await workbook([]),
      await workbook([['', 'Missing number', 'HS Hilversum', 'Recurve', '40cm']]),
    ]) {
      assert.equal(
        (await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/octet-stream' }, payload }))
          .statusCode,
        400,
      );
    }
    db.update(competitions).set({ status: 'Check-in' }).where(eq(competitions.id, 'one')).run();
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { 'content-type': 'application/octet-stream' },
          payload: await example(),
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: url.replace('one', 'missing'),
          headers: { 'content-type': 'application/octet-stream' },
          payload: await example(),
        })
      ).statusCode,
      404,
    );
  } finally {
    await close();
  }
});

test('import endpoint requires authentication', async () => {
  const app = buildApp({ jwtSecret: 'xlsx-import-test-secret-at-least-32-bytes', databasePath: ':memory:' });
  try {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin${url}`,
          headers: { 'content-type': 'application/octet-stream' },
          payload: await example(),
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test('target matching accepts spacing and close spelling, prefers the standard face and rejects ambiguity', () => {
  const targets = ['40 cm blazoen (10-rings)', 'Dutch Target 40 cm (3-spot)', '60 cm blazoen (10-rings)'];
  assert.equal(matchTarget('40cm', targets), targets[0]);
  assert.equal(matchTarget(' 40 CM ', targets), targets[0]);
  assert.equal(matchTarget('DT', targets), targets[1]);
  assert.equal(matchTarget(' dt ', targets), targets[1]);
  assert.equal(matchTarget('40cm', ['40cm', targets[1]!, targets[0]!]), targets[0]);
  assert.equal(matchTarget('DT', ['DT', targets[0]!]), undefined);
  assert.equal(matchTarget('40cm', [targets[1]!]), undefined);
  assert.equal(matchTarget('Dutch target 40cm 3spot', targets), targets[1]);
  assert.equal(matchTarget('40 cm blazoen (10-ring)', targets), targets[0]);
  assert.equal(matchTarget('999cm', targets), undefined);
  assert.equal(matchTarget('40cm', ['40 cm face A', '40 cm face B']), undefined);
});
