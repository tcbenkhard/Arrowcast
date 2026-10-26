import { existsSync } from 'node:fs';
import { sendControlCommand } from '../../shared/control-client.js';

export class PublicAccessControlClient {
  available() {
    return existsSync('/usr/local/lib/arrowcast/public-access.py');
  }

  command(body?: unknown) {
    return sendControlCommand({
      socketPath: '/run/arrowcast-public/control.sock',
      path: body ? '/configure' : '/status',
      method: body ? 'POST' : 'GET',
      timeoutMessage: 'Public access service timed out.',
      jsonHeaders: true,
      body,
    });
  }
}
