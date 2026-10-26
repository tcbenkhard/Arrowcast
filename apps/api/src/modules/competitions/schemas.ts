import { competitionStatuses } from '../../db/schema.js';

const time = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const numberOfRounds = { type: 'integer', minimum: 1, maximum: 1000 };
const arrowsPerRound = { type: 'integer', minimum: 1, maximum: 36 };
const defaultTargetType = {
  anyOf: [{ type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, { type: 'null' }],
};
const params = {
  type: 'object',
  required: ['competitionId'],
  properties: { competitionId: { type: 'string', minLength: 1 } },
};
const inputProperties = {
  name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
  startingTime: time,
  endingTime: time,
  defaultTargetType,
  numberOfRounds,
  arrowsPerRound,
  rangeId: { type: 'string', minLength: 1 },
  lanes: {
    type: 'array',
    minItems: 1,
    maxItems: 1000,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['laneId', 'distanceMeters'],
      properties: { laneId: { type: 'string', minLength: 1 }, distanceMeters: { type: 'number', exclusiveMinimum: 0 } },
    },
  },
};
const detailProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  date: { type: 'string' },
  startingTime: time,
  endingTime: time,
  status: { type: 'string', enum: [...competitionStatuses] },
  defaultTargetType: { type: ['string', 'null'] },
  numberOfRounds,
  arrowsPerRound,
  scoringLocked: { type: 'boolean' },
  range: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: { id: { type: 'string' }, name: { type: 'string' } },
  },
};
const detail = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'date', 'startingTime', 'endingTime', 'range', 'status'],
  properties: detailProperties,
};
const lane = {
  type: 'object',
  additionalProperties: false,
  required: ['laneId', 'number', 'distanceMeters', 'targetType', 'numberOfTargets'],
  properties: {
    laneId: { type: 'string' },
    number: { type: 'integer' },
    distanceMeters: { type: 'number' },
    targetType: { type: ['string', 'null'] },
    numberOfTargets: { type: 'integer' },
  },
};

export const competitionListSchema = { response: { 200: { type: 'array', items: detail } } };
export const competitionDetailSchema = { params, response: { 200: detail } };
export const competitionUpdateSchema = {
  params,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'date', 'startingTime', 'endingTime', 'defaultTargetType', 'numberOfRounds', 'arrowsPerRound'],
    properties: inputProperties,
  },
  response: { 200: detail },
};
export const competitionDeleteSchema = { params };
export const competitionStatusSchema = {
  params,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: { status: detailProperties.status },
  },
  response: {
    200: {
      ...detail,
      properties: {
        ...detailProperties,
        qrCodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              grantId: { type: 'string' },
              laneId: { type: 'string' },
              laneNumber: { type: 'integer' },
              path: { type: 'string' },
              expiresAt: { type: 'integer' },
            },
          },
        },
      },
    },
  },
};
export const competitionScoringSchema = {
  params,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['numberOfRounds', 'arrowsPerRound'],
    properties: { numberOfRounds, arrowsPerRound },
  },
  response: { 200: detail },
};
export const competitionReassignSchema = { params };
export const competitionLanesSchema = { params, response: { 200: { type: 'array', items: lane } } };
export const competitionLaneUpdateSchema = {
  params: {
    ...params,
    required: ['competitionId', 'laneId'],
    properties: { ...params.properties, laneId: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['targetType', 'numberOfTargets'],
    properties: {
      targetType: defaultTargetType,
      numberOfTargets: { anyOf: [{ type: 'integer', minimum: 1, maximum: 2 }, { type: 'null' }] },
    },
  },
  response: { 200: lane },
};
export const competitionCreateSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'date', 'startingTime', 'endingTime', 'rangeId', 'lanes'],
    properties: inputProperties,
  },
  response: {
    201: {
      ...detail,
      required: ['id', 'name', 'date', 'startingTime', 'endingTime', 'range', 'lanes', 'status'],
      properties: {
        ...detailProperties,
        lanes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['laneId', 'number', 'distanceMeters'],
            properties: { laneId: { type: 'string' }, number: { type: 'integer' }, distanceMeters: { type: 'number' } },
          },
        },
      },
    },
  },
};
