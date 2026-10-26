import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { ParticipantsDatabaseClient } from './database-client.js';
import { requireParticipantCompetition, requireScheduledRegistration } from './rules.js';
import type { AddParticipant } from './types.js';
import { CompetitionParticipantImportService } from './competition-import.js';
import { readParticipantWorkbook } from './workbook.js';

export class ParticipantRegistrationService {
  private readonly participants: ParticipantsDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.participants = new ParticipantsDatabaseClient(context);
  }

  private requireCompetition(id: string) {
    return requireParticipantCompetition(this.participants.findCompetition(id));
  }

  private requireTargetType(name: string) {
    if (!this.participants.findTargetType(name)) throw new ApplicationError(t('participants.existingTarget'), 400);
  }

  async importWorkbook(competitionId: string, workbook: unknown) {
    requireScheduledRegistration(this.requireCompetition(competitionId), 'add');
    if (!Buffer.isBuffer(workbook)) {
      throw new ApplicationError(t('management.upload_een_xlsxbestand', {}, 'nl'), 400);
    }
    const rows = await readParticipantWorkbook(workbook);
    return new CompetitionParticipantImportService(this.context).import(competitionId, rows);
  }

  changeTarget(competitionId: string, participantIds: string[], targetType: string) {
    this.requireCompetition(competitionId);
    this.requireTargetType(targetType);
    return this.context.transaction((scope) =>
      new ParticipantRegistrationService(scope).changeTargetInTransaction(competitionId, participantIds, targetType),
    );
  }

  private changeTargetInTransaction(competitionId: string, participantIds: string[], targetType: string) {
    const registered = this.participants.findRegistrations(competitionId, participantIds);
    if (registered.length !== participantIds.length) {
      throw new ApplicationError(t('management.one_or_more_participants_are_not_registered_for_this'), 404);
    }
    if (registered.some((person) => person.laneId && person.targetType !== targetType)) {
      throw new ApplicationError(t('management.target_changes_would_invalidate_existing_shooting_assignments'), 409);
    }
    const updated = this.participants.changeTarget(competitionId, participantIds, targetType);
    return { updatedParticipantIds: updated.map((row) => row.participantId), targetType };
  }

  checkIn(competitionId: string, participantId: string, checkedIn: boolean) {
    const competition = this.requireCompetition(competitionId);
    if (competition.status !== 'Check-in') {
      throw new ApplicationError(t('management.participants_can_only_check_in_during_checkin'), 409);
    }
    const updated = this.participants.setCheckedIn(competitionId, participantId, checkedIn);
    if (!updated) throw new ApplicationError(t('management.participant_is_not_registered_for_this_competition'), 404);
    return { checkedIn: updated.checkedIn };
  }

  remove(competitionId: string, participantIds: string[]) {
    requireScheduledRegistration(this.requireCompetition(competitionId), 'remove');
    const removed = this.participants.removeRegistrations(competitionId, participantIds);
    return { removedParticipantIds: removed.map((row) => row.participantId) };
  }

  list(competitionId: string) {
    this.requireCompetition(competitionId);
    return this.participants.listRegistrations(competitionId);
  }

  add(competitionId: string, input: AddParticipant) {
    requireScheduledRegistration(this.requireCompetition(competitionId), 'add');
    const { bowType, targetType } = input;
    if (!this.participants.findBowType(bowType)) throw new ApplicationError(t('participants.existingBow'), 400);
    this.requireTargetType(targetType);
    if ('participantId' in input) {
      const person = this.participants.findParticipant(input.participantId);
      if (!person) throw new ApplicationError(t('management.participant_not_found'), 404);
      const added = this.participants.addRegistration({ competitionId, participantId: person.id, bowType, targetType });
      if (!added) throw new ApplicationError(t('management.this_participant_is_already_in_this_competition'), 409);
      return { ...person, bowType, targetType };
    }
    const { federationNumber, clubNumber, clubName } = input;
    const club = this.participants.findClub(clubNumber);
    if (!club && !clubName) throw new ApplicationError(t('participants.clubNameRequired'), 400);
    if (this.participants.findByFederationNumber(federationNumber)) {
      throw new ApplicationError(
        t('management.this_federation_number_already_exists_select_the_existing_participant'),
        409,
      );
    }
    const id = randomUUID();
    this.context.transaction((scope) => {
      const service = new ParticipantRegistrationService(scope);
      if (!club) service.participants.addClub({ clubNumber, name: clubName! });
      service.participants.addParticipant({ id, name: input.name, federationNumber, clubNumber });
      service.participants.addRegistration({ competitionId, participantId: id, bowType, targetType });
    });
    return { ...this.participants.findParticipant(id)!, bowType, targetType };
  }
}
