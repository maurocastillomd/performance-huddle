import { Router } from 'express';
import { z } from 'zod';
import type { Update } from '../../shared/types.js';
import { AccessDenied, canSubmitTo, hasPermission } from '../auth/authorize.js';
import { asyncRoute, audit, currentUser, requireUser, type ApiContext } from './context.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.');

const plannedBlockSchema = z.object({
  date: isoDate,
  start: hhmm,
  end: hhmm,
  label: z.string().min(1).max(120),
});

const createSchema = z.object({
  athleteId: z.string().min(1).max(64),
  department: z.enum(['strength_conditioning', 'sports_science', 'medical', 'nutrition', 'coaching']),
  body: z.string().min(1).max(4000),
  requestedAction: z.string().max(300).nullable().optional(),
  requestedActionOwnerId: z.string().max(64).nullable().optional(),
  audienceId: z.string().min(1).max(64),
  reviewDate: isoDate,
  plannedBlock: plannedBlockSchema.nullable().optional(),
  supersedesUpdateId: z.string().max(64).nullable().optional(),
});

const reviseSchema = z.object({
  body: z.string().min(1).max(4000),
  note: z.string().min(1).max(300),
});

const moveSchema = z.object({ audienceId: z.string().min(1).max(64) });

export function updatesRouter(ctx: ApiContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.get(
    '/updates',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const audienceId = typeof req.query.audienceId === 'string' ? req.query.audienceId : undefined;
      const athleteId = typeof req.query.athleteId === 'string' ? req.query.athleteId : undefined;
      const rows = ctx.store.listUpdatesVisibleTo(user, { audienceId, athleteId });
      ctx.logger.info('updates.list', { userId: user.id, orgId: user.orgId, count: rows.length });
      res.json(rows);
    }),
  );

  router.get(
    '/updates/:id',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const row = ctx.store.getUpdateVisibleTo(user, id);
      if (!row) {
        // A record outside the caller's audience is indistinguishable from one
        // that does not exist. Nothing in the response confirms it is there.
        audit(ctx, user, 'update.read', 'update', id, 'deny', 'not_visible');
        ctx.logger.info('updates.deny', { userId: user.id, updateId: id, reason: 'not_visible' });
        res.status(404).json({ error: 'not_found', message: 'No such update.' });
        return;
      }
      audit(ctx, user, 'update.read', 'update', id, 'allow', 'ok');
      res.json(row);
    }),
  );

  router.post(
    '/updates',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid update.' });
        return;
      }
      const input = parsed.data;

      const audience = ctx.store.getAudience(input.audienceId);
      if (!audience || !canSubmitTo(user, audience)) {
        audit(ctx, user, 'update.create', 'audience', input.audienceId, 'deny', 'not_permitted');
        throw new AccessDenied(
          'submit_denied',
          'Submitting to that audience needs submit permission and membership of it.',
        );
      }

      const athlete = ctx.store.getAthlete(input.athleteId);
      if (!athlete || athlete.orgId !== user.orgId) {
        throw new AccessDenied('athlete_not_found', 'No such athlete on this roster.', 404);
      }

      if (input.requestedActionOwnerId) {
        const owner = ctx.store.findUser(input.requestedActionOwnerId);
        if (!owner || owner.orgId !== user.orgId) {
          throw new AccessDenied('owner_not_found', 'The named owner is not on this staff.', 400);
        }
      }

      if (input.supersedesUpdateId) {
        const prior = ctx.store.getUpdateVisibleTo(user, input.supersedesUpdateId);
        if (!prior || prior.audienceId !== input.audienceId) {
          throw new AccessDenied(
            'supersede_denied',
            'An update can only replace one you can read in the same audience.',
            400,
          );
        }
      }

      if (input.plannedBlock && input.plannedBlock.start >= input.plannedBlock.end) {
        res.status(400).json({ error: 'invalid_body', message: 'A planned block must end after it starts.' });
        return;
      }

      const update: Update = {
        id: ctx.store.nextId('U9'),
        orgId: user.orgId,
        athleteId: input.athleteId,
        department: input.department,
        body: input.body,
        requestedAction: input.requestedAction?.trim() || null,
        requestedActionOwnerId: input.requestedActionOwnerId || null,
        audienceId: input.audienceId,
        reviewDate: input.reviewDate,
        authorId: user.id,
        createdAt: ctx.clock.now().toISOString(),
        status: 'approved',
        supersedesUpdateId: input.supersedesUpdateId || null,
        plannedBlock: input.plannedBlock ?? null,
        revisions: [],
      };
      ctx.store.insertUpdate(update);
      audit(ctx, user, 'update.create', 'update', update.id, 'allow', 'ok');
      ctx.logger.info('updates.create', {
        userId: user.id,
        orgId: user.orgId,
        updateId: update.id,
        audienceId: update.audienceId,
      });
      res.status(201).json(update);
    }),
  );

  router.post(
    '/updates/:id/revisions',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const existing = ctx.store.getUpdateVisibleTo(user, id);
      if (!existing) {
        res.status(404).json({ error: 'not_found', message: 'No such update.' });
        return;
      }
      if (existing.authorId !== user.id) {
        throw new AccessDenied('not_author', 'Only the author revises an update. Submit a new one instead.');
      }
      const parsed = reviseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: 'A revised body and a note are required.' });
        return;
      }
      existing.revisions.push({
        revisedAt: ctx.clock.now().toISOString(),
        revisedBy: user.id,
        note: parsed.data.note,
        previousBody: existing.body,
      });
      existing.body = parsed.data.body;
      ctx.store.replaceUpdate(existing);
      audit(ctx, user, 'update.revise', 'update', id, 'allow', 'ok');
      res.json(existing);
    }),
  );

  /** Withdrawing a source invalidates every brief that cited it. */
  router.post(
    '/updates/:id/withdraw',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const existing = ctx.store.getUpdateVisibleTo(user, id);
      if (!existing) {
        res.status(404).json({ error: 'not_found', message: 'No such update.' });
        return;
      }
      if (existing.authorId !== user.id && !hasPermission(user, 'approve')) {
        throw new AccessDenied('withdraw_denied', 'Withdrawing needs to be the author or an approver.');
      }
      existing.status = 'withdrawn';
      ctx.store.replaceUpdate(existing);
      const invalidated = ctx.store.invalidateBriefsCiting(
        id,
        `Source ${id} was withdrawn. This brief no longer reflects its sources.`,
      );
      audit(ctx, user, 'update.withdraw', 'update', id, 'allow', `briefs_invalidated_${invalidated.length}`);
      ctx.logger.info('updates.withdraw', { userId: user.id, updateId: id, invalidated: invalidated.length });
      res.json({ update: existing, invalidatedBriefIds: invalidated.map((b) => b.id) });
    }),
  );

  /** Moving a source to a different audience invalidates every brief that cited it. */
  router.post(
    '/updates/:id/audience',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      if (!hasPermission(user, 'approve')) {
        throw new AccessDenied('approval_required', 'Changing the audience of a source needs approval permission.');
      }
      const existing = ctx.store.getUpdateVisibleTo(user, id);
      if (!existing) {
        res.status(404).json({ error: 'not_found', message: 'No such update.' });
        return;
      }
      const parsed = moveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: 'An audienceId is required.' });
        return;
      }
      const target = ctx.store.getAudience(parsed.data.audienceId);
      if (!target || target.orgId !== user.orgId || !user.audienceIds.includes(target.id)) {
        throw new AccessDenied('audience_denied', 'You are not a member of the target audience.');
      }
      existing.audienceId = target.id;
      ctx.store.replaceUpdate(existing);
      const invalidated = ctx.store.invalidateBriefsCiting(
        id,
        `Source ${id} moved to a different audience. This brief no longer reflects its sources.`,
      );
      audit(ctx, user, 'update.move_audience', 'update', id, 'allow', `briefs_invalidated_${invalidated.length}`);
      res.json({ update: existing, invalidatedBriefIds: invalidated.map((b) => b.id) });
    }),
  );

  return router;
}
