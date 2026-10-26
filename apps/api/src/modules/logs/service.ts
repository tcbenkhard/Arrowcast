import { t } from '@arrowcast/contracts/i18n';
import { JournalLogClient, type LogSource } from './journal-client.js';

export { logSources, type LogSource } from './journal-client.js';

export class LogService {
  constructor(private readonly client: Pick<JournalLogClient, 'read'> = new JournalLogClient()) {}

  async read(source: LogSource) {
    try {
      return { code: 200, body: { text: await this.client.read(source) } };
    } catch {
      return { code: 503, body: { message: t('Logs.unavailable') } };
    }
  }
}
