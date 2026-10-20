import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  username: text('username').primaryKey(),
  name: text('name').notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'competition_manager'] }).notNull().default('admin'),
  forceChangePassword: integer('force_change_password', { mode: 'boolean' }).notNull().default(false),
  sessionVersion: integer('session_version').notNull().default(0),
});

export const clubs = sqliteTable('clubs', {
  clubNumber: text('club_number').primaryKey(),
  name: text('name').notNull(),
}, (table) => [
  check('clubs_number_not_blank', sql`length(trim(${table.clubNumber})) > 0`),
  check('clubs_name_not_blank', sql`length(trim(${table.name})) > 0`),
]);

export const participants = sqliteTable('participants', {
  id: text('id').primaryKey(),
  federationNumber: text('federation_number').notNull().unique(),
  name: text('name').notNull(),
  clubNumber: text('club_number').notNull().references(() => clubs.clubNumber),
}, (table) => [
  index('participants_club_number_index').on(table.clubNumber),
  check('participants_federation_number_not_blank', sql`length(trim(${table.federationNumber})) > 0`),
  check('participants_name_not_blank', sql`length(trim(${table.name})) > 0`),
]);

export const bowTypes = sqliteTable('bow_types', {
  name: text('name').primaryKey(),
}, (table) => [
  uniqueIndex('bow_types_name_case_insensitive_unique').on(sql`lower(${table.name})`),
  check('bow_types_name_valid', sql`length(trim(${table.name})) BETWEEN 1 AND 100 AND ${table.name} = trim(${table.name})`),
]);

export const targetTypes = sqliteTable('target_types', {
  name: text('name').primaryKey(),
}, (table) => [
  uniqueIndex('target_types_name_case_insensitive_unique').on(sql`lower(${table.name})`),
  check('target_types_name_valid', sql`length(trim(${table.name})) BETWEEN 1 AND 100 AND ${table.name} = trim(${table.name})`),
]);

export const ranges = sqliteTable('ranges', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
}, (table) => [check('ranges_name_not_blank', sql`length(trim(${table.name})) > 0`)]);

export const rangeDistances = sqliteTable('range_distances', {
  rangeId: text('range_id').notNull().references(() => ranges.id, { onDelete: 'cascade' }),
  distanceMeters: real('distance_meters').notNull(),
}, (table) => [
  primaryKey({ columns: [table.rangeId, table.distanceMeters] }),
  check('range_distances_positive', sql`${table.distanceMeters} > 0`),
]);

export const lanes = sqliteTable('lanes', {
  id: text('id').primaryKey(),
  rangeId: text('range_id').notNull().references(() => ranges.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
}, (table) => [
  unique('lanes_range_number_unique').on(table.rangeId, table.number),
  unique('lanes_id_range_unique').on(table.id, table.rangeId),
  check('lanes_number_positive_integer', sql`${table.number} > 0 AND typeof(${table.number}) = 'integer'`),
]);

export const competitionStatuses = ['Scheduled', 'Check-in', 'Active', 'Closed'] as const;

export const competitions = sqliteTable('competitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  date: text('date').notNull(),
  startingTime: text('starting_time').notNull(),
  endingTime: text('ending_time').notNull(),
  rangeId: text('range_id').notNull().references(() => ranges.id),
  status: text('status', { enum: competitionStatuses }).notNull().default('Scheduled'),
  numberOfRounds: integer('number_of_rounds').notNull().default(10),
  arrowsPerRound: integer('arrows_per_round').notNull().default(3),
  defaultTargetType: text('default_target_type').references(() => targetTypes.name),
  scoringLocked: integer('scoring_locked', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  unique('competitions_id_range_unique').on(table.id, table.rangeId),
  index('competitions_date_time_index').on(table.date, table.startingTime),
  check('competitions_name_not_blank', sql`length(trim(${table.name})) > 0`),
  check('competitions_time_order', sql`${table.endingTime} > ${table.startingTime}`),
  check('competitions_status_valid', sql`${table.status} IN ('Scheduled', 'Check-in', 'Active', 'Closed')`),
  check('competitions_rounds_valid', sql`typeof(${table.numberOfRounds}) = 'integer' AND ${table.numberOfRounds} BETWEEN 1 AND 1000`),
  check('competitions_arrows_valid', sql`typeof(${table.arrowsPerRound}) = 'integer' AND ${table.arrowsPerRound} BETWEEN 1 AND 36`),
  check('competitions_scoring_lock_valid', sql`${table.scoringLocked} IN (0, 1)`),
]);

export const competitionLanes = sqliteTable('competition_lanes', {
  competitionId: text('competition_id').notNull(),
  rangeId: text('range_id').notNull(),
  laneId: text('lane_id').notNull(),
  distanceMeters: real('distance_meters').notNull(),
  targetType: text('target_type'),
  numberOfTargets: integer('number_of_targets').notNull().default(1),
}, (table) => [
  check('competition_lanes_target_type_not_blank', sql`${table.targetType} IS NULL OR (length(trim(${table.targetType})) > 0 AND length(${table.targetType}) <= 100)`),
  check('competition_lanes_target_count_positive_integer', sql`${table.numberOfTargets} IS NULL OR (${table.numberOfTargets} BETWEEN 1 AND 2 AND typeof(${table.numberOfTargets}) = 'integer')`),
  primaryKey({ columns: [table.competitionId, table.laneId] }),
  foreignKey({ columns: [table.competitionId, table.rangeId], foreignColumns: [competitions.id, competitions.rangeId] }).onDelete('cascade'),
  foreignKey({ columns: [table.laneId, table.rangeId], foreignColumns: [lanes.id, lanes.rangeId] }),
  foreignKey({ columns: [table.rangeId, table.distanceMeters], foreignColumns: [rangeDistances.rangeId, rangeDistances.distanceMeters] }),
]);

export const competitionParticipants = sqliteTable('competition_participants', {
  competitionId: text('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  participantId: text('participant_id').notNull().references(() => participants.id),
  bowType: text('bow_type').references(() => bowTypes.name),
  targetType: text('target_type').references(() => targetTypes.name),
  checkedIn: integer('checked_in', { mode: 'boolean' }).notNull().default(false),
  laneId: text('lane_id'),
  targetLetter: text('target_letter', { enum: ['A', 'B', 'C', 'D'] }),
}, (table) => [
  primaryKey({ columns: [table.competitionId, table.participantId] }),
  foreignKey({ columns: [table.competitionId, table.laneId], foreignColumns: [competitionLanes.competitionId, competitionLanes.laneId] }),
  unique('competition_participants_place_unique').on(table.competitionId, table.laneId, table.targetLetter),
  check('competition_participants_check_in_boolean', sql`${table.checkedIn} IN (0, 1)`),
  check('competition_participants_place_valid', sql`(${table.laneId} IS NULL AND ${table.targetLetter} IS NULL) OR (${table.laneId} IS NOT NULL AND ${table.targetLetter} IS NOT NULL AND ${table.targetLetter} IN ('A', 'B', 'C', 'D'))`),
]);

export const laneScoringGrants = sqliteTable('lane_scoring_grants', {
  token: text('token'),
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull(),
  laneId: text('lane_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
}, (table) => [
  foreignKey({ columns: [table.competitionId, table.laneId], foreignColumns: [competitionLanes.competitionId, competitionLanes.laneId] }),
  index('lane_scoring_grants_scope_index').on(table.competitionId, table.laneId),
]);

export const scoringSessions = sqliteTable('scoring_sessions', {
  id: text('id').primaryKey(),
  grantId: text('grant_id').notNull().references(() => laneScoringGrants.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
});

export const laneScoringState = sqliteTable('lane_scoring_state', {
  competitionId: text('competition_id').notNull(),
  laneId: text('lane_id').notNull(),
  currentRoundNumber: integer('current_round_number').notNull().default(1),
  currentParticipantId: text('current_participant_id'),
  participantOrder: text('participant_order', { mode: 'json' }).$type<string[]>().notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.competitionId, table.laneId] }),
  foreignKey({ columns: [table.competitionId, table.laneId], foreignColumns: [competitionLanes.competitionId, competitionLanes.laneId] }),
  foreignKey({ columns: [table.competitionId, table.currentParticipantId], foreignColumns: [competitionParticipants.competitionId, competitionParticipants.participantId] }),
  check('lane_scoring_state_round_positive', sql`${table.currentRoundNumber} > 0 AND typeof(${table.currentRoundNumber}) = 'integer'`),
]);

export const scorecards = sqliteTable('scorecards', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull(),
  participantId: text('participant_id').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  unique('scorecards_participant_unique').on(table.competitionId, table.participantId),
  foreignKey({ columns: [table.competitionId, table.participantId], foreignColumns: [competitionParticipants.competitionId, competitionParticipants.participantId] }),
]);

export const roundScores = sqliteTable('round_scores', {
  id: text('id').primaryKey(),
  scorecardId: text('scorecard_id').notNull().references(() => scorecards.id),
  roundNumber: integer('round_number').notNull(),
  status: text('status', { enum: ['draft', 'submitted'] }).notNull().default('draft'),
  submittedAt: integer('submitted_at'),
}, (table) => [
  unique('round_scores_number_unique').on(table.scorecardId, table.roundNumber),
  check('round_scores_round_valid', sql`${table.roundNumber} > 0 AND typeof(${table.roundNumber}) = 'integer'`),
  check('round_scores_status_valid', sql`${table.status} IN ('draft', 'submitted')`),
]);

export const arrowScores = sqliteTable('arrow_scores', {
  roundScoreId: text('round_score_id').notNull().references(() => roundScores.id),
  arrowIndex: integer('arrow_index').notNull(),
  symbol: text('symbol').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roundScoreId, table.arrowIndex] }),
  check('arrow_scores_index_valid', sql`${table.arrowIndex} > 0 AND typeof(${table.arrowIndex}) = 'integer'`),
  check('arrow_scores_symbol_valid', sql`${table.symbol} IN ('M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10')`),
]);

export const scoringMutations = sqliteTable('scoring_mutations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => scoringSessions.id),
  requestHash: text('request_hash').notNull(),
  result: text('result', { mode: 'json' }).$type<{ version: number }>().notNull(),
  createdAt: integer('created_at').notNull(),
});

export const scoreChanges = sqliteTable('score_changes', {
  id: text('id').primaryKey(),
  scorecardId: text('scorecard_id').notNull().references(() => scorecards.id),
  sessionId: text('session_id').notNull().references(() => scoringSessions.id),
  mutationId: text('mutation_id').notNull().references(() => scoringMutations.id),
  roundNumber: integer('round_number').notNull(),
  before: text('before', { mode: 'json' }).$type<(string | null)[]>().notNull(),
  after: text('after', { mode: 'json' }).$type<(string | null)[]>().notNull(),
  submitted: integer('submitted', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
});
