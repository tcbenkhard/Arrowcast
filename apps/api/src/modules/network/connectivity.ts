import { existsSync } from 'node:fs';
import { networkCommand } from './routes.js';

export async function internetAvailable(): Promise<boolean> {
  // Network management is a Pi capability; keep local development usable without its broker.
  if (!existsSync('/usr/local/lib/arrowcast/network.py')) return true;
  try {
    const result = await networkCommand();
    return result.code === 200 && (result.body as { internetAvailable?: boolean })?.internetAvailable === true;
  } catch {
    return false;
  }
}
