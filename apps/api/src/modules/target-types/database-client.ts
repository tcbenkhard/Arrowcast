import { asc, inArray, sql } from 'drizzle-orm';
import { DatabaseClient } from '../../db/context.js';
import { competitionLanes, competitionParticipants, competitions, targetTypes } from '../../db/schema.js';

export class TargetTypeDatabaseClient extends DatabaseClient {
  list() {
    return this.db
      .select()
      .from(targetTypes)
      .orderBy(asc(sql`lower(${targetTypes.name})`))
      .all()
      .map((type) => type.name);
  }

  create(name: string) {
    return this.db.insert(targetTypes).values({ name }).onConflictDoNothing().returning().get();
  }

  areInUse(names: string[]) {
    const used = this.db
      .select({ name: competitionLanes.targetType })
      .from(competitionLanes)
      .where(inArray(competitionLanes.targetType, names))
      .get();
    const usedByParticipant = this.db
      .select({ name: competitionParticipants.targetType })
      .from(competitionParticipants)
      .where(inArray(competitionParticipants.targetType, names))
      .get();
    const usedAsDefault = this.db
      .select({ name: competitions.defaultTargetType })
      .from(competitions)
      .where(inArray(competitions.defaultTargetType, names))
      .get();
    return !!(used || usedByParticipant || usedAsDefault);
  }

  remove(names: string[]) {
    return this.db
      .delete(targetTypes)
      .where(inArray(targetTypes.name, names))
      .returning()
      .all()
      .map((type) => type.name);
  }
}
