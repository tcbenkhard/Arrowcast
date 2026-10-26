import { t } from '@arrowcast/contracts/i18n';
import type { DatabaseContext } from '../../db/context.js';
import { NetworkService } from '../network/service.js';
import { createPageFetcher, scrapeLatestParticipants } from './import.js';
import { ParticipantImportService } from './import-service.js';
import type { ParticipantImportState, ScrapedParticipants, ScrapeParticipants } from './types.js';

interface ImportJobDependencies {
  canImport: () => Promise<boolean>;
  scrape: ScrapeParticipants;
  save: (data: ScrapedParticipants) => void;
  onError: (error: unknown) => void;
}

type ImportAvailability = ParticipantImportState & { available: boolean; message: string | null };
type StartResult = { outcome: 'started' | 'running' } | { outcome: 'offline'; state: ImportAvailability };

/** Owns the background import lifecycle independently of its HTTP polling endpoints. */
export class ParticipantImportJob {
  private state: ParticipantImportState = { status: 'idle', progress: null, result: null, error: null };
  private running: Promise<void> | undefined;

  constructor(private readonly dependencies: ImportJobDependencies) {}

  static create(context: DatabaseContext, options: ParticipantImportOptions) {
    const network = new NetworkService();
    const canImport = options.canImport ?? (() => network.internetAvailable());
    const importer = new ParticipantImportService(context);
    return new ParticipantImportJob({
      canImport,
      scrape: options.scrape ?? ((progress) => scrapeLatestParticipants(createPageFetcher(canImport), progress)),
      save: (data) => importer.save(data),
      onError: options.onError ?? (() => {}),
    });
  }

  async status(): Promise<ImportAvailability> {
    return this.snapshot(await this.dependencies.canImport());
  }

  async start(): Promise<StartResult> {
    if (!(await this.dependencies.canImport())) return { outcome: 'offline', state: this.snapshot(false) };
    if (this.state.status === 'running') return { outcome: 'running' };
    this.state = { status: 'running', progress: t('import.findingLatest', {}, 'nl'), result: null, error: null };
    this.running = this.run();
    return { outcome: 'started' };
  }

  async waitForCompletion() {
    await this.running;
  }

  private snapshot(available: boolean): ImportAvailability {
    return { ...this.state, available, message: available ? null : t('import.internetRequired', {}, 'nl') };
  }

  private async run() {
    try {
      const data = await this.dependencies.scrape((message) => {
        this.state.progress = message;
      });
      this.dependencies.save(data);
      this.state = {
        status: 'completed',
        progress: null,
        error: null,
        result: { season: data.season, participants: data.participants.length, clubs: data.clubs.length },
      };
    } catch (error) {
      this.dependencies.onError(error);
      this.state = {
        status: 'failed',
        progress: null,
        result: null,
        error: t('routes.importeren_is_mislukt_er_zijn_geen_gegevens_opgeslagen_probeer', {}, 'nl'),
      };
    }
  }
}

export interface ParticipantImportOptions {
  scrape?: ScrapeParticipants;
  canImport?: () => Promise<boolean>;
  onError?: (error: unknown) => void;
}
