import { t } from '@arrowcast/contracts/i18n';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ScoringMutation, ScoringStanding } from '@arrowcast/contracts';
import { calculateAverageScore } from '@arrowcast/scoring';
import type { AppDatabase } from '../../db/index.js';
import {
  arrowScores,
  competitionParticipants,
  competitions,
  laneScoringGrants,
  lanes,
  participants,
  roundScores,
  scorecards,
  scoringSessions,
} from '../../db/schema.js';
import {
  hashToken,
  initializeLaneScoring,
  issueLaneCodes,
  newToken,
  revokeGrants,
  saveScores,
  ScoringError,
  scoringContext,
  validGrant,
  restoreLaneCodes,
} from './service.js';

const grantParams = {
  type: 'object',
  additionalProperties: false,
  required: ['grantId'],
  properties: { grantId: { type: 'string', format: 'uuid' } },
};
const competitionParams = {
  type: 'object',
  required: ['competitionId'],
  properties: { competitionId: { type: 'string', minLength: 1 } },
};
const cookieName = 'arrowcast.scoring';
const cookiePath = (id: string) => `/api/v1/scoring/${id}`;

export async function scoringRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  await app.register(cookie);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ScoringError) return reply.code(error.statusCode).send({ message: error.message });
    throw error;
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    // A required non-simple header prevents cross-origin form/CSRF requests. No CORS is enabled.
    if (
      request.method !== 'GET' &&
      (request.headers['x-arrowcast-scoring'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site')
    ) {
      return reply.code(403).send({ message: t('routes.open_scoring_on_this_website_to_save_scores') });
    }
  });
  function authorize(request: FastifyRequest, grantId: string) {
    const grant = validGrant(db, grantId);
    const token = request.cookies[cookieName];
    const session = token
      ? db
          .select()
          .from(scoringSessions)
          .where(eq(scoringSessions.tokenHash, hashToken(token)))
          .get()
      : undefined;
    if (!session || session.grantId !== grantId || session.revokedAt !== null || session.expiresAt <= Date.now()) {
      throw new ScoringError(401, t('routes.scan_the_lane_qr_code_to_open_a_scoring'));
    }
    return { grant, session };
  }

  app.post<{ Params: { grantId: string }; Body: { token: string } }>(
    '/:grantId/exchange',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        params: grantParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' } },
        },
      },
    },
    async (request, reply) => {
      const grant = validGrant(db, request.params.grantId);
      if (hashToken(request.body.token) !== grant.tokenHash)
        throw new ScoringError(401, t('routes.invalid_lane_scoring_code'));
      const context = scoringContext(db, grant);
      const token = newToken();
      const now = Date.now();
      const expiresAt = Math.min(grant.expiresAt, now + 86400_000);
      db.insert(scoringSessions)
        .values({ id: randomUUID(), grantId: grant.id, tokenHash: hashToken(token), createdAt: now, expiresAt })
        .run();
      reply.setCookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'strict',
        path: cookiePath(grant.id),
        secure: request.protocol === 'https' || request.headers.origin?.startsWith('https://') === true,
        maxAge: Math.floor((expiresAt - now) / 1000),
      });
      return context;
    },
  );
  app.get<{ Params: { grantId: string } }>(
    '/:grantId/context',
    { schema: { params: grantParams } },
    async (request) => {
      const { grant } = authorize(request, request.params.grantId);
      return db.transaction((tx) => scoringContext(tx, grant));
    },
  );
  app.post<{ Params: { grantId: string }; Body: ScoringMutation }>(
    '/:grantId/scores',
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        params: grantParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['submissionId', 'expectedVersion', 'participantId', 'roundNumber', 'arrows', 'submit'],
          properties: {
            submissionId: { type: 'string', format: 'uuid' },
            expectedVersion: { type: 'integer', minimum: 0 },
            participantId: { type: 'string', minLength: 1, maxLength: 100 },
            roundNumber: { type: 'integer', minimum: 1, maximum: 1000 },
            arrows: {
              type: 'array',
              minItems: 1,
              maxItems: 36,
              items: {
                anyOf: [
                  { type: 'null' },
                  { type: 'string', enum: ['M', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
                ],
              },
            },
            submit: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { session } = authorize(request, request.params.grantId);
      return db.transaction((tx) => saveScores(tx, request.params.grantId, session.id, request.body));
    },
  );
}

export async function adminScoringRoutes(app: FastifyInstance, { db }: { db: AppDatabase }) {
  const findCompetition = (id: string) => db.select().from(competitions).where(eq(competitions.id, id)).get();
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    {
      schema: { params: competitionParams },
    },
    async (request, reply) => {
      const competition = findCompetition(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      if (competition.status !== 'Check-in' && competition.status !== 'Active') return [];
      return db
        .select({
          id: laneScoringGrants.id,
          laneId: laneScoringGrants.laneId,
          laneNumber: lanes.number,
          token: laneScoringGrants.token,
          expiresAt: laneScoringGrants.expiresAt,
        })
        .from(laneScoringGrants)
        .innerJoin(lanes, eq(lanes.id, laneScoringGrants.laneId))
        .where(
          and(eq(laneScoringGrants.competitionId, request.params.competitionId), isNull(laneScoringGrants.revokedAt)),
        )
        .orderBy(lanes.number)
        .all()
        .filter((grant) => grant.expiresAt > Date.now())
        .filter(
          (grant, _, grants) => grant.token || !grants.some((other) => other.laneId === grant.laneId && other.token),
        )
        .map(({ token, id, ...grant }) => ({
          ...grant,
          grantId: id,
          ...(token ? { path: `/scoring/${request.params.competitionId}/${grant.laneId}/${id}#token=${token}` } : {}),
        }));
    },
  );
  app.post<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes/restore',
    {
      schema: { params: competitionParams },
    },
    async (request, reply) => {
      const competition = findCompetition(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      if (competition.status !== 'Check-in' && competition.status !== 'Active') {
        return reply.code(409).send({ message: t('routes.scoring_has_not_started') });
      }
      db.transaction((tx) => restoreLaneCodes(tx, competition.id));
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-standings',
    {
      schema: { params: competitionParams },
    },
    async (request, reply) => {
      const competition = findCompetition(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      return db.transaction((tx) => {
        const people = tx
          .select({
            participantId: participants.id,
            name: participants.name,
            laneNumber: lanes.number,
            targetLetter: competitionParticipants.targetLetter,
          })
          .from(competitionParticipants)
          .innerJoin(participants, eq(participants.id, competitionParticipants.participantId))
          .leftJoin(lanes, eq(lanes.id, competitionParticipants.laneId))
          .where(eq(competitionParticipants.competitionId, competition.id))
          .all();
        const scores = tx
          .select({ participantId: scorecards.participantId, roundId: roundScores.id, symbol: arrowScores.symbol })
          .from(scorecards)
          .innerJoin(roundScores, and(eq(roundScores.scorecardId, scorecards.id), eq(roundScores.status, 'submitted')))
          .leftJoin(arrowScores, eq(arrowScores.roundScoreId, roundScores.id))
          .where(eq(scorecards.competitionId, competition.id))
          .all();
        const totals = new Map<string, { rounds: Set<string>; total: number }>();
        for (const score of scores) {
          const total = totals.get(score.participantId) ?? { rounds: new Set<string>(), total: 0 };
          total.rounds.add(score.roundId);
          total.total += score.symbol && score.symbol !== 'M' ? Number(score.symbol) : 0;
          totals.set(score.participantId, total);
        }
        return people
          .map((person): ScoringStanding => {
            const total = totals.get(person.participantId);
            const enteredRounds = total?.rounds.size ?? 0;
            const totalScore = total?.total ?? 0;
            return {
              ...person,
              enteredRounds,
              totalRounds: competition.numberOfRounds,
              totalScore,
              averageScore: calculateAverageScore(totalScore, enteredRounds, competition.arrowsPerRound),
            };
          })
          .sort((a, b) => b.averageScore - a.averageScore || a.name.localeCompare(b.name, 'nl'));
      });
    },
  );
  app.post<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    {
      schema: { params: competitionParams },
    },
    async (request, reply) => {
      const competition = findCompetition(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      if (competition.status !== 'Check-in' && competition.status !== 'Active')
        return reply.code(409).send({ message: t('routes.start_checkin_before_issuing_scoring_codes') });
      return db.transaction((tx) => {
        if (competition.status === 'Active') initializeLaneScoring(tx, competition.id);
        return issueLaneCodes(tx, competition.id);
      });
    },
  );
  app.delete<{ Params: { competitionId: string } }>(
    '/competitions/:competitionId/scoring-codes',
    {
      schema: { params: competitionParams },
    },
    async (request, reply) => {
      if (!findCompetition(request.params.competitionId))
        return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      revokeGrants(db, request.params.competitionId);
      return reply.code(204).send();
    },
  );
  app.patch<{ Params: { competitionId: string }; Body: { scoringLocked: boolean } }>(
    '/competitions/:competitionId/scoring-lock',
    {
      schema: {
        params: competitionParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['scoringLocked'],
          properties: { scoringLocked: { type: 'boolean' } },
        },
      },
    },
    async (request, reply) => {
      const competition = findCompetition(request.params.competitionId);
      if (!competition) return reply.code(404).send({ message: t('CompetitionDetailPage.competition_not_found') });
      db.update(competitions).set(request.body).where(eq(competitions.id, competition.id)).run();
      return request.body;
    },
  );
}
