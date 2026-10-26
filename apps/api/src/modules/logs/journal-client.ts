import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const sources = {
  frontend: ['SYSLOG_IDENTIFIER=arrowcast_web'],
  backend: ['--unit=arrowcast.service'],
  updates: ['--unit=arrowcast-update.service'],
} as const;
export type LogSource = keyof typeof sources;
export const logSources = Object.keys(sources);

export class JournalLogClient {
  async read(source: LogSource): Promise<string> {
    const { stdout } = await execute(
      'journalctl',
      ['--quiet', '--no-pager', '--lines=300', '--output=short-iso', ...sources[source]],
      { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, SYSTEMD_COLORS: '0' } },
    );
    return stdout;
  }
}
