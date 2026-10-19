import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  username: text('username').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin'] }).notNull().default('admin'),
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
}, (table) => [
  unique('competitions_id_range_unique').on(table.id, table.rangeId),
  index('competitions_date_time_index').on(table.date, table.startingTime),
  check('competitions_name_not_blank', sql`length(trim(${table.name})) > 0`),
  check('competitions_time_order', sql`${table.endingTime} > ${table.startingTime}`),
  check('competitions_status_valid', sql`${table.status} IN ('Scheduled', 'Check-in', 'Active', 'Closed')`),
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
