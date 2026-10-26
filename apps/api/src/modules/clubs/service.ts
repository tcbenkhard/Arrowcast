import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { ClubSettingsDatabaseClient } from './database-client.js';

export class ClubSettingsService {
  private readonly clubs: ClubSettingsDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.clubs = new ClubSettingsDatabaseClient(context);
  }

  selected() {
    return this.clubs.selected();
  }

  select(clubNumber: string | null, name?: string) {
    if (clubNumber && !this.clubs.find(clubNumber) && !name) {
      throw new ApplicationError(t('Club.nameRequired'), 400);
    }
    this.context.transaction((context) => {
      const clubs = new ClubSettingsDatabaseClient(context);
      if (clubNumber && name) clubs.create(clubNumber, name);
      clubs.select(clubNumber);
    });
    return this.selected();
  }
}
