import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { ApplicationError } from '../../shared/errors.js';
import { TargetTypeDatabaseClient } from './database-client.js';

export class TargetTypeService {
  private readonly targetTypes: TargetTypeDatabaseClient;

  constructor(private readonly context: DatabaseContext) {
    this.targetTypes = new TargetTypeDatabaseClient(context);
  }

  list() {
    return this.targetTypes.list();
  }

  create(name: string) {
    const created = this.targetTypes.create(name);
    if (!created) {
      throw new ApplicationError(t('TargetTypesPage.a_target_type_with_this_name_already_exists'), 409);
    }
    return created.name;
  }

  remove(names: string[]) {
    return this.context.transaction((context) => new TargetTypeService(context).removeInTransaction(names));
  }

  private removeInTransaction(names: string[]) {
    if (this.targetTypes.areInUse(names)) {
      throw new ApplicationError(
        t('TargetTypesPage.een_of_meer_geselecteerde_target_types_zijn_in_gebruik', {}, 'nl'),
        409,
      );
    }
    return this.targetTypes.remove(names);
  }
}
