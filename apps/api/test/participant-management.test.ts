import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/index.js';
import { clubs, competitions, participants, ranges, targetTypes } from '../src/db/schema.js';
import { saveParticipants } from '../src/modules/participants/import.js';
import { participantManagementRoutes } from '../src/modules/participants/management.js';

async function fixture() {
  const database = openDatabase(':memory:');
  database.db.insert(targetTypes).values({ name: 'Initial face' }).run();
  database.db.insert(clubs).values({ clubNumber: '0012', name: 'Testclub' }).run();
  database.db.insert(ranges).values({ id: 'range', name: 'Range' }).run();
  database.db.insert(competitions).values(['one', 'two'].map((id) => ({ id, name: id,
    date: '2026-11-01', startingTime: '09:00', endingTime: '12:00', rangeId: 'range' }))).run();
  const app = Fastify({ ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  await app.register(participantManagementRoutes, { db: database.db });
  return { app, database, close: async () => { await app.close(); database.close(); } };
}

test('fulltext search matches multiple words, accents and number fragments and follows import updates', async () => {
  const { app, database, close } = await fixture();
  try {
    const data = { clubs: [{ clubNumber: '0012', name: 'Testclub' }], participants: [
      { name: 'Zoë van Dijk', federationNumber: '000123', clubNumber: '0012' },
      { name: 'Alex van Dam', federationNumber: '000124', clubNumber: '0012' },
    ] };
    saveParticipants(database.db, data);
    for (const query of ['zoe', 'dijk zo', '000123', '0123']) {
      const response = await app.inject({ url: `/participants?q=${encodeURIComponent(query)}` });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().length, 1);
      assert.equal(response.json()[0].name, 'Zoë van Dijk');
      assert.equal(response.json()[0].clubName, 'Testclub');
    }
    for (const query of ['', '  ', 'zoe dam', '" OR *', '%', '_']) {
      const response = await app.inject({ url: `/participants?q=${encodeURIComponent(query)}` });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), []);
    }
    saveParticipants(database.db, { ...data, participants: [{ ...data.participants[0]!, name: 'Updated Archer' }] });
    assert.equal((await app.inject({ url: '/participants?q=zoe' })).json().length, 0);
    assert.equal((await app.inject({ url: '/participants?q=arch' })).json().length, 1);
    database.db.delete(participants).where(eq(participants.federationNumber, '000123')).run();
    assert.deepEqual((await app.inject({ url: '/participants?q=arch' })).json(), []);
    assert.equal((await app.inject({ url: `/participants?q=${'a'.repeat(201)}` })).statusCode, 400);
  } finally { await close(); }
});

test('adds existing and new participants to specific competitions and rejects duplicates and invalid data', async () => {
  const { app, database, close } = await fixture();
  const url = '/competitions/one/participants';
  try {
    database.db.insert(participants).values({ id: 'existing', name: 'Existing Archer', federationNumber: '0001', clubNumber: '0012' }).run();
    assert.deepEqual((await app.inject({ url })).json(), []);
    database.db.insert(targetTypes).values({ name: 'Custom face' }).run();
    for (const status of ['Check-in', 'Active', 'Closed'] as const) {
      database.db.update(competitions).set({ status }).where(eq(competitions.id, 'one')).run();
      for (const payload of [
        { participantId: 'existing', bowType: 'Recurve', targetType: 'Custom face' },
        { name: 'New Archer', federationNumber: '0002', clubNumber: '0012', bowType: 'Compound', targetType: 'Custom face' },
      ]) {
        const blocked = await app.inject({ method: 'POST', url, payload });
        assert.equal(blocked.statusCode, 409);
        assert.equal(blocked.json().message, 'Participants can only be added before check-in.');
      }
      assert.deepEqual((await app.inject({ url })).json(), []);
      assert.equal(database.db.select().from(participants).all().length, 1);
    }
    database.db.update(competitions).set({ status: 'Scheduled' }).where(eq(competitions.id, 'one')).run();
    const invalidTarget = await app.inject({ method: 'POST', url, payload: { participantId: 'existing', bowType: 'Recurve', targetType: 'Unknown face' } });
    assert.equal(invalidTarget.statusCode, 400);
    const added = await app.inject({ method: 'POST', url, payload: { participantId: 'existing', bowType: 'Recurve', targetType: 'Custom face' } });
    assert.equal(added.statusCode, 201);
    assert.equal(added.json().federationNumber, '0001');
    assert.equal(added.json().bowType, 'Recurve');
    assert.equal(added.json().targetType, 'Custom face');
    assert.equal((await app.inject({ url })).json()[0].targetType, 'Custom face');
    assert.equal((await app.inject({ method: 'POST', url, payload: { participantId: 'existing', bowType: 'Recurve', targetType: 'Initial face' } })).statusCode, 409);
    assert.deepEqual((await app.inject({ url: '/competitions/two/participants' })).json(), []);
    assert.equal((await app.inject({ method: 'POST', url: '/competitions/two/participants', payload: { participantId: 'existing', bowType: 'Barebow', targetType: 'Initial face' } })).statusCode, 201);
    assert.equal((await app.inject({ url: '/competitions/two/participants' })).json()[0].bowType, 'Barebow');
    assert.equal((await app.inject({ url: '/competitions/two/participants' })).json()[0].targetType, 'Initial face');
    assert.equal((await app.inject({ url })).json()[0].bowType, 'Recurve');
    const newPerson = { name: '  New Archer  ', federationNumber: '0002', clubNumber: '0012', bowType: 'Compound', targetType: 'Custom face' };
    const created = await app.inject({ method: 'POST', url, payload: newPerson });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().name, 'New Archer');
    assert.equal(created.json().bowType, 'Compound');
    assert.equal(created.json().targetType, 'Custom face');
    assert.equal((await app.inject({ url: '/participants?q=new' })).json()[0].id, created.json().id);
    assert.equal((await app.inject({ url })).json().length, 2);
    assert.equal((await app.inject({ method: 'POST', url, payload: newPerson })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url, payload: { participantId: 'missing', bowType: 'Recurve', targetType: 'Initial face' } })).statusCode, 404);
    for (const payload of [{ participantId: 'existing', bowType: 'Recurve' },
      { participantId: 'existing', bowType: 'Recurve', targetType: null },
      { ...newPerson, targetType: null }, { ...newPerson, targetType: undefined },
      {}, { name: ' ', federationNumber: '3', clubNumber: '0012' },
      { ...newPerson, federationNumber: 123 }, { participantId: 'existing', name: 'extra' },
      { participantId: 'existing' }, { participantId: 'existing', bowType: 'unknown', targetType: 'Initial face' }]) {
      assert.equal((await app.inject({ method: 'POST', url, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'POST', url, payload: { ...newPerson, federationNumber: '0003', clubNumber: 'missing' } })).statusCode, 400);
    assert.equal(database.db.select().from(participants).all().length, 2);
    assert.equal((await app.inject({ method: 'POST', url: '/competitions/missing/participants', payload: { ...newPerson, federationNumber: '0004' } })).statusCode, 404);
    assert.equal(database.db.select().from(participants).all().length, 2);
  } finally { await close(); }
});

test('bulk unregister removes only selected entries from the chosen competition and preserves participants', async () => {
  const { app, database, close } = await fixture();
  const url = '/competitions/one/participants';
  try {
    for (const [index, id] of ['first', 'second', 'third'].entries()) {
      database.db.insert(participants).values({ id, name: id, federationNumber: `000${index}`, clubNumber: '0012' }).run();
      for (const competition of ['one', 'two']) {
        assert.equal((await app.inject({ method: 'POST', url: `/competitions/${competition}/participants`,
          payload: { participantId: id, bowType: 'Recurve', targetType: 'Initial face' } })).statusCode, 201);
      }
    }
    for (const payload of [{}, { participantIds: [] }, { participantIds: ['first', 'first'] },
      { participantIds: [123] }, { participantIds: [' '] }, { participantIds: ['first'], extra: true }]) {
      assert.equal((await app.inject({ method: 'DELETE', url, payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'DELETE', url: '/competitions/missing/participants', payload: { participantIds: ['first'] } })).statusCode, 404);
    const registered = (await app.inject({ url })).json();
    for (const status of ['Check-in', 'Active', 'Closed'] as const) {
      database.db.update(competitions).set({ status }).where(eq(competitions.id, 'one')).run();
      const blocked = await app.inject({ method: 'DELETE', url, payload: { participantIds: ['first', 'second'] } });
      assert.equal(blocked.statusCode, 409);
      assert.equal(blocked.json().message, 'Participants can only be removed before check-in.');
      assert.deepEqual((await app.inject({ url })).json(), registered);
    }
    database.db.update(competitions).set({ status: 'Scheduled' }).where(eq(competitions.id, 'one')).run();
    const removed = await app.inject({ method: 'DELETE', url, payload: { participantIds: ['first', 'second'] } });
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json().removedParticipantIds.sort(), ['first', 'second']);
    assert.deepEqual((await app.inject({ url })).json().map((p: { id: string }) => p.id), ['third']);
    assert.equal((await app.inject({ url: '/competitions/two/participants' })).json().length, 3);
    assert.equal(database.db.select().from(participants).all().length, 3);
    assert.equal((await app.inject({ url: '/participants?q=first' })).json().length, 1);
    const repeated = await app.inject({ method: 'DELETE', url, payload: { participantIds: ['first', 'second'] } });
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.json().removedParticipantIds, []);
    assert.equal((await app.inject({ method: 'POST', url, payload: { participantId: 'first', bowType: 'Barebow', targetType: 'Initial face' } })).statusCode, 201);
  } finally { await close(); }
});


test('bulk target changes validate the entire selection and affect only the chosen competition', async () => {
  const { app, database, close } = await fixture();
  const url = '/competitions/one/participants';
  try {
    database.db.insert(targetTypes).values({ name: 'Custom face' }).run();
    for (const id of ['first', 'second', 'third']) {
      database.db.insert(participants).values({ id, name: id, federationNumber: id, clubNumber: '0012' }).run();
      for (const competition of ['one', 'two']) {
        assert.equal((await app.inject({ method: 'POST', url: `/competitions/${competition}/participants`,
          payload: { participantId: id, bowType: 'Recurve', targetType: 'Initial face' } })).statusCode, 201);
      }
    }
    for (const payload of [{}, { participantIds: [], targetType: null },
      { participantIds: ['first', 'first'], targetType: null },
      { participantIds: ['first'], targetType: 'Unknown face' },
      { participantIds: ['first'], targetType: ' ' }, { participantIds: ['first'], targetType: 42 }]) {
      assert.equal((await app.inject({ method: 'PATCH', url, payload })).statusCode, 400);
    }
    const missing = await app.inject({ method: 'PATCH', url,
      payload: { participantIds: ['first', 'missing'], targetType: 'Custom face' } });
    assert.equal(missing.statusCode, 404);
    assert.ok((await app.inject({ url })).json().every((person: { targetType: string | null }) => person.targetType === 'Initial face'));
    assert.equal((await app.inject({ method: 'PATCH', url: '/competitions/missing/participants',
      payload: { participantIds: ['first'], targetType: 'Initial face' } })).statusCode, 404);
    const updated = await app.inject({ method: 'PATCH', url,
      payload: { participantIds: ['first', 'second'], targetType: ' Custom face ' } });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.json().updatedParticipantIds.sort(), ['first', 'second']);
    assert.equal(updated.json().targetType, 'Custom face');
    assert.deepEqual((await app.inject({ url })).json().map((person: { targetType: string | null }) => person.targetType),
      ['Custom face', 'Custom face', 'Initial face']);
    assert.ok((await app.inject({ url: '/competitions/two/participants' })).json().every((person: { targetType: string | null }) => person.targetType === 'Initial face'));
    assert.equal((await app.inject({ method: 'PATCH', url,
      payload: { participantIds: ['first', 'second'], targetType: null } })).statusCode, 400);
    assert.deepEqual((await app.inject({ url })).json().map((person: { targetType: string | null }) => person.targetType), ['Custom face', 'Custom face', 'Initial face']);
  } finally { await close(); }
});
