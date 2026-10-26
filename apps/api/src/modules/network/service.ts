import { t } from '@arrowcast/contracts/i18n';
import { NetworkControlClient } from './control-client.js';

export interface NetworkSettings {
  ssid: string;
  password: string;
}

const unavailable = () => ({
  code: 503,
  body: { message: t('routes.network_service_unavailable_try_again_shortly') },
});

export class NetworkService {
  constructor(private readonly client = new NetworkControlClient()) {}

  async status() {
    try {
      return await this.client.command();
    } catch {
      if (!this.client.available()) {
        return {
          code: 200,
          body: {
            mode: 'disabled',
            busy: false,
            ssid: null,
            address: null,
            message: t('routes.network_settings_are_available_on_configured_raspberry_pi_images'),
          },
        };
      }
      return unavailable();
    }
  }

  async connect(settings: NetworkSettings) {
    try {
      return await this.client.command(settings);
    } catch {
      return unavailable();
    }
  }

  async statusIfAvailable() {
    return this.client.available() ? this.client.command() : null;
  }

  async internetAvailable(): Promise<boolean> {
    // Network management is a Pi capability; keep local development usable without its broker.
    try {
      const result = await this.statusIfAvailable();
      return (
        result === null ||
        (result.code === 200 && (result.body as { internetAvailable?: boolean })?.internetAvailable === true)
      );
    } catch {
      return false;
    }
  }
}
