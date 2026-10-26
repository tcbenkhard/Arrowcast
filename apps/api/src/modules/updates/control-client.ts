import { existsSync } from 'node:fs';
import { t } from '@arrowcast/contracts/i18n';
import { sendControlCommand } from '../../shared/control-client.js';

export type UpdateCommand = 'status' | 'install' | 'check';

export class UpdateControlClient {
  available() {
    return existsSync('/etc/arrowcast/update.json');
  }

  command(command: UpdateCommand) {
    return sendControlCommand({
      socketPath: '/run/arrowcast-update/control.sock',
      path: `/${command}`,
      method: command === 'status' ? 'GET' : 'POST',
      timeoutMessage: t('updates.timeout'),
    });
  }
}
