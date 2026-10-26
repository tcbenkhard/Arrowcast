import { DatabaseConnection } from '../db/index.js';
import { createPageFetcher, scrapeLatestParticipants } from '../modules/participants/import.js';
import { ParticipantImportService } from '../modules/participants/import-service.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run'))
    throw new Error('Gebruik: npm run db:import-participants -- [--dry-run]');
  const data = await scrapeLatestParticipants(createPageFetcher(), console.log);
  if (args.includes('--dry-run')) {
    console.log(
      `Proefimport ${data.season}: ${data.participants.length} unieke deelnemers, ${data.clubs.length} verenigingen; niets opgeslagen.`,
    );
    return;
  }
  const database = new DatabaseConnection(process.env.DATABASE_PATH?.trim() || 'data/arrowcast.sqlite');
  try {
    new ParticipantImportService(database.context).save(data);
    console.log(
      `Import ${data.season} voltooid: ${data.participants.length} unieke deelnemers en ${data.clubs.length} verenigingen opgeslagen (${data.pages} uitslagenpagina's).`,
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Import mislukt.');
  process.exitCode = 1;
});
