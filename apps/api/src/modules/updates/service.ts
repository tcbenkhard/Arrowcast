import { t } from '@arrowcast/contracts/i18n';
import { UpdateControlClient, type UpdateCommand } from './control-client.js';

export type { UpdateCommand } from './control-client.js';

export class UpdateService {
  constructor(private readonly client = new UpdateControlClient()) {}

  async execute(command: UpdateCommand) {
    try {
      return await this.client.command(command);
    } catch {
      if (command === 'status' && !this.client.available()) {
        return {
          code: 200,
          body: {
            status: 'disabled',
            currentVersion: 'development',
            availableVersion: null,
            message: t('updates.configuredImage'),
          },
        };
      }
      return { code: 503, body: { message: t('updates.onlyConfiguredImage') } };
    }
  }
}
