import { NetworkService } from '../network/service.js';
import { PublicAccessService } from './service.js';

export class ScoringOriginService {
  constructor(
    private readonly network: Pick<NetworkService, 'statusIfAvailable'> = new NetworkService(),
    private readonly publicAccess: Pick<PublicAccessService, 'status'> = new PublicAccessService(),
  ) {}

  async origin() {
    try {
      const network = await this.network.statusIfAvailable();
      if (network) {
        const state = network.body as { mode?: string };
        if (network.code !== 200 || !['hotspot', 'wifi', 'ethernet'].includes(state.mode ?? '')) {
          return { code: 503, body: { message: 'Network service unavailable. Try again shortly.' } };
        }
        if (state.mode === 'hotspot') {
          return { code: 200, body: { origin: 'http://10.42.0.1', hotspot: true } };
        }
      }
      const result = await this.publicAccess.status();
      const state = result.body as { origin?: string | null };
      return { code: result.code, body: { origin: state.origin ?? null } };
    } catch {
      return { code: 503, body: { message: 'Network service unavailable. Try again shortly.' } };
    }
  }
}
