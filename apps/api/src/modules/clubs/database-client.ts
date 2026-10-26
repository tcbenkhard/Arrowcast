import { eq } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { clubSettings, clubs, participants } from '../../db/schema.js';

export class ClubSettingsDatabaseClient extends DatabaseClient {
  selected() {
    return (
      this.db
        .select({ clubNumber: clubs.clubNumber, name: clubs.name })
        .from(clubSettings)
        .innerJoin(clubs, eq(clubs.clubNumber, clubSettings.clubNumber))
        .where(eq(clubSettings.id, 1))
        .get() ?? null
    );
  }

  find(clubNumber: string) {
    return this.db.select().from(clubs).where(eq(clubs.clubNumber, clubNumber)).get();
  }

  create(clubNumber: string, name: string) {
    this.db.insert(clubs).values({ clubNumber, name }).onConflictDoNothing().run();
  }

  select(clubNumber: string | null) {
    this.db
      .insert(clubSettings)
      .values({ id: 1, clubNumber })
      .onConflictDoUpdate({ target: clubSettings.id, set: { clubNumber } })
      .run();
  }

  memberFilter() {
    const number = this.db.select().from(clubSettings).where(eq(clubSettings.id, 1)).get()?.clubNumber;
    return number ? eq(participants.clubNumber, number) : undefined;
  }
}
