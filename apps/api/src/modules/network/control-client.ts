import { existsSync } from 'node:fs';
import { t } from '@arrowcast/contracts/i18n';
import { sendControlCommand } from '../../shared/control-client.js';

export class NetworkControlClient {
  available() {
    return existsSync('/usr/local/lib/arrowcast/network.py');
  }

  command(body?: unknown) {
    return sendControlCommand({
      socketPath: '/run/arrowcast-network/control.sock',
      path: body ? '/connect' : '/status',
      method: body ? 'POST' : 'GET',
      timeoutMessage: t('routes.network_service_timed_out'),
      jsonHeaders: true,
      body,
    });
  }
}
