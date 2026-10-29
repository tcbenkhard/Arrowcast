import { PublicAccessControlClient } from './control-client.js';

export interface PublicAccessSettings {
  enabled: boolean;
  domain: string;
  email: string;
  accessMode?: 'public' | 'ddns';
  ddnsToken?: string;
  action?: 'prepare-ddns';
}

export class PublicAccessService {
  constructor(private readonly client = new PublicAccessControlClient()) {}

  async configure(settings: PublicAccessSettings) {
    try {
      return await this.client.command(settings);
    } catch {
      return { code: 503, body: { message: 'Public access service unavailable.' } };
    }
  }

  async status() {
    try {
      return await this.client.command();
    } catch {
      if (!this.client.available()) {
        return { code: 200, body: { available: false, origin: null } };
      }
      return { code: 503, body: { message: 'Public access service unavailable.' } };
    }
  }
}
