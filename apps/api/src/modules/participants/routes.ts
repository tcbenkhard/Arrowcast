import { t } from '@arrowcast/contracts/i18n';
import type { FastifyInstance } from 'fastify';
import type { AppDatabase } from '../../db/index.js';
import { createPageFetcher, saveParticipants, scrapeLatestParticipants } from './import.js';
import { internetAvailable } from '../network/connectivity.js';

type ImportResult = Awaited<ReturnType<typeof scrapeLatestParticipants>>;
type Scrape = (progress: (message: string) => void) => Promise<ImportResult>;

export async function participantRoutes(app: FastifyInstance, options: {
  db: AppDatabase; scrape?: Scrape; canImport?: () => Promise<boolean>;
}) {
  let state: {
    status: 'idle' | 'running' | 'completed' | 'failed';
    progress: string | null;
    result: { season: string; participants: number; clubs: number } | null;
    error: string | null;
  } = { status: 'idle', progress: null, result: null, error: null };
  let running: Promise<void> | undefined;
  const canImport = options.canImport ?? internetAvailable;
  const offlineMessage = t('import.internetRequired', {}, 'nl');
  const scrape = options.scrape ?? ((progress) => scrapeLatestParticipants(createPageFetcher(canImport), progress));

  // Finish an active transaction/import before the parent closes the database.
  app.addHook('onClose', async () => { await running; });
  app.get('/participants/import', async () => {
    const available = await canImport();
    return { ...state, available, message: available ? null : offlineMessage };
  });
  app.post('/participants/import', async (_request, reply) => {
    if (!await canImport()) return reply.code(503).send({ ...state, available: false, message: offlineMessage });
    if (state.status === 'running') return reply.code(409).send({ message: t("routes.er_loopt_al_een_deelnemersimport", {}, 'nl') });
    state = { status: 'running', progress: t('import.findingLatest', {}, 'nl'), result: null, error: null };
    running = (async () => {
      try {
        const data = await scrape((message) => { state.progress = message; });
        saveParticipants(options.db, data);
        state = {
          status: 'completed', progress: null, error: null,
          result: { season: data.season, participants: data.participants.length, clubs: data.clubs.length },
        };
      } catch (error) {
        app.log.error({ err: error }, 'Deelnemersimport mislukt');
        state = { status: 'failed', progress: null, result: null,
          error: t("routes.importeren_is_mislukt_er_zijn_geen_gegevens_opgeslagen_probeer", {}, 'nl') };
      }
    })();
    return reply.code(202).send({ status: 'running', available: true });
  });
}
