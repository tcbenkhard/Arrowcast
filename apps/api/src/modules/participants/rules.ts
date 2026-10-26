import { t } from '@arrowcast/contracts/i18n';
import { ApplicationError } from '../../shared/errors.js';

export function requireParticipantCompetition<T>(competition: T | undefined): T {
  if (!competition) throw new ApplicationError(t('CompetitionDetailPage.competition_not_found'), 404);
  return competition;
}

export function requireScheduledRegistration(competition: { status: string }, operation: 'add' | 'remove') {
  if (competition.status !== 'Scheduled') {
    throw new ApplicationError(
      t(
        operation === 'add'
          ? 'management.participants_can_only_be_added_before_checkin'
          : 'management.participants_can_only_be_removed_before_checkin',
      ),
      409,
    );
  }
}
