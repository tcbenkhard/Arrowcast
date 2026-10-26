import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { bowTypes, clubs, competitionParticipants, competitions, participants, targetTypes } from '../../db/schema.js';
import type { ImportedClub } from './types.js';

const participantFields = {
  id: participants.id,
  federationNumber: participants.federationNumber,
  name: participants.name,
  clubNumber: participants.clubNumber,
  clubName: clubs.name,
};
type Participant = typeof participants.$inferInsert;
type Registration = typeof competitionParticipants.$inferInsert;

/** Owns participant directory, membership and competition registration persistence. */
export class ParticipantsDatabaseClient extends DatabaseClient {
  private directory() {
    return this.db
      .select(participantFields)
      .from(participants)
      .innerJoin(clubs, eq(participants.clubNumber, clubs.clubNumber));
  }

  search(query: string) {
    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    const match = terms.map((term) => `"${term}"*`).join(' AND ');
    const byNumber = sql`instr(${participants.federationNumber}, ${query}) > 0`;
    return this.directory()
      .where(
        match
          ? sql`(${byNumber} OR ${participants.id} IN (
        SELECT p.id FROM participants p JOIN participants_search s ON s.rowid = p.rowid
        WHERE participants_search MATCH ${match}
      ))`
          : byNumber,
      )
      .orderBy(
        sql`CASE WHEN ${participants.federationNumber} = ${query} THEN 0 ELSE 1 END`,
        participants.name,
        participants.id,
      )
      .limit(20)
      .all();
  }

  listClubs() {
    return this.db.select().from(clubs).orderBy(clubs.name, clubs.clubNumber).all();
  }

  listBowTypes() {
    return this.db.select().from(bowTypes).orderBy(bowTypes.name).all();
  }

  listTargetTypes() {
    return this.db.select().from(targetTypes).all();
  }

  findCompetition(id: string) {
    return this.db
      .select({ id: competitions.id, status: competitions.status })
      .from(competitions)
      .where(eq(competitions.id, id))
      .get();
  }

  findBowType(name: string) {
    return this.db.select().from(bowTypes).where(eq(bowTypes.name, name)).get();
  }

  findTargetType(name: string) {
    return this.db.select().from(targetTypes).where(eq(targetTypes.name, name)).get();
  }

  findParticipant(id: string) {
    return this.directory().where(eq(participants.id, id)).get();
  }

  findByFederationNumber(number: string) {
    return this.db.select().from(participants).where(eq(participants.federationNumber, number)).get();
  }

  findClub(number: string) {
    return this.db.select().from(clubs).where(eq(clubs.clubNumber, number)).get();
  }

  private registrationSelection(competitionId: string, participantIds: string[]) {
    return and(
      eq(competitionParticipants.competitionId, competitionId),
      inArray(competitionParticipants.participantId, participantIds),
    );
  }

  findRegistrations(competitionId: string, participantIds: string[]) {
    return this.db
      .select()
      .from(competitionParticipants)
      .where(this.registrationSelection(competitionId, participantIds))
      .all();
  }

  changeTarget(competitionId: string, participantIds: string[], targetType: string) {
    return this.db
      .update(competitionParticipants)
      .set({ targetType })
      .where(this.registrationSelection(competitionId, participantIds))
      .returning({ participantId: competitionParticipants.participantId })
      .all();
  }

  setCheckedIn(competitionId: string, participantId: string, checkedIn: boolean) {
    return this.db
      .update(competitionParticipants)
      .set({ checkedIn })
      .where(this.registrationSelection(competitionId, [participantId]))
      .returning()
      .get();
  }

  removeRegistrations(competitionId: string, participantIds: string[]) {
    return this.db
      .delete(competitionParticipants)
      .where(this.registrationSelection(competitionId, participantIds))
      .returning({ participantId: competitionParticipants.participantId })
      .all();
  }

  listRegistrations(competitionId: string) {
    return this.db
      .select({
        ...participantFields,
        bowType: competitionParticipants.bowType,
        targetType: competitionParticipants.targetType,
        checkedIn: competitionParticipants.checkedIn,
        laneId: competitionParticipants.laneId,
        targetLetter: competitionParticipants.targetLetter,
      })
      .from(participants)
      .innerJoin(clubs, eq(participants.clubNumber, clubs.clubNumber))
      .innerJoin(competitionParticipants, eq(competitionParticipants.participantId, participants.id))
      .where(eq(competitionParticipants.competitionId, competitionId))
      .orderBy(participants.name, participants.id)
      .all();
  }

  addRegistration(registration: Registration) {
    return this.db.insert(competitionParticipants).values(registration).onConflictDoNothing().returning().get();
  }

  upsertRegistration(registration: Pick<Registration, 'competitionId' | 'participantId' | 'bowType' | 'targetType'>) {
    this.db
      .insert(competitionParticipants)
      .values(registration)
      .onConflictDoUpdate({
        target: [competitionParticipants.competitionId, competitionParticipants.participantId],
        set: { bowType: registration.bowType, targetType: registration.targetType },
      })
      .run();
  }

  addClub(club: ImportedClub) {
    this.db.insert(clubs).values(club).onConflictDoNothing().run();
  }

  upsertClub(club: ImportedClub) {
    this.db
      .insert(clubs)
      .values(club)
      .onConflictDoUpdate({ target: clubs.clubNumber, set: { name: club.name } })
      .run();
  }

  addParticipant(person: Participant) {
    this.db.insert(participants).values(person).run();
  }

  upsertParticipant(person: Participant) {
    this.db
      .insert(participants)
      .values(person)
      .onConflictDoUpdate({
        target: participants.federationNumber,
        set: { name: person.name, clubNumber: person.clubNumber },
      })
      .run();
  }

  updateClub(participantId: string, clubNumber: string) {
    this.db.update(participants).set({ clubNumber }).where(eq(participants.id, participantId)).run();
  }
}
