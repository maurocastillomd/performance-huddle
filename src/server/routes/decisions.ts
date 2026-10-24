import { Router } from 'express';
import { z } from 'zod';
import type { Decision } from '../../shared/types.js';
import { AccessDenied, canReviewAudience, hasPermission } from '../auth/authorize.js';
import { asyncRoute, audit, currentUser, requireUser, type ApiContext } from './context.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const createSchema = z.object({
  audienceId: z.string().min(1).max(64),
  athleteId: z.string().max(64).nullable().optional(),
  action: z.string().min(1).max(300),
  ownerId: z.string().max(64).nullable().optional(),
  rationale: z.string().min(1).max(1000),
  dueDate: isoDate.nullable().optional(),
  reviewDate: isoDate.nullable().optional(),
  sourceUpdateIds: z.array(z.string().max(64)).max(10).optional(),
  briefId: z.string().max(64).nullable().optional(),
  supersedesDecisionId: z.string().max(64).nullable().optional(),
});

const patchSchema = z.object({
  ownerId: z.string().max(64).nullable().optional(),
  status: z.enum(['open', 'completed']).optional(),
  dueDate: isoDate.nullable().optional(),
  reviewDate: isoDate.nullable().optional(),
});

export function decisionsRouter(ctx: ApiContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.get(
    '/decisions',
    asyncRoute((_req, res) => {
      res.json(ctx.store.listDecisionsVisibleTo(currentUser(res)));
    }),
  );

  /**
   * Recording a decision is an approval action. The model has no route here:
   * nothing in this handler reads model output.
   */
  router.post(
    '/decisions',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid decision.' });
        return;
      }
      const input = parsed.data;
      const audience = ctx.store.getAudience(input.audienceId);
      if (!audience || !canReviewAudience(user, audience)) {
        audit(ctx, user, 'decision.create', 'audience', input.audienceId, 'deny', 'not_permitted');
        throw new AccessDenied('approval_required', 'Recording a decision needs approval permission for that audience.');
      }

      if (input.ownerId) {
        const owner = ctx.store.findUser(input.ownerId);
        if (!owner || owner.orgId !== user.orgId) {
          throw new AccessDenied('owner_not_found', 'The named owner is not on this staff.', 400);
        }
      }

      // Sources are re-checked here: a decision may only cite what the caller
      // can read in this audience, whatever the client sent.
      const sourceIds = (input.sourceUpdateIds ?? []).filter((id) => {
        const u = ctx.store.getUpdateVisibleTo(user, id);
        return !!u && u.audienceId === input.audienceId;
      });

      let supersedes: Decision | null = null;
      if (input.supersedesDecisionId) {
        supersedes = ctx.store.getDecisionVisibleTo(user, input.supersedesDecisionId);
        if (!supersedes || supersedes.audienceId !== input.audienceId) {
          throw new AccessDenied('supersede_denied', 'You can only replace a decision you can read in this audience.', 400);
        }
      }

      const decision: Decision = {
        id: ctx.store.nextId('D9'),
        orgId: user.orgId,
        audienceId: input.audienceId,
        athleteId: input.athleteId ?? null,
        action: input.action,
        ownerId: input.ownerId ?? null,
        rationale: input.rationale,
        dueDate: input.dueDate ?? null,
        reviewDate: input.reviewDate ?? null,
        status: 'open',
        createdBy: user.id,
        createdAt: ctx.clock.now().toISOString(),
        completedAt: null,
        supersedesDecisionId: supersedes?.id ?? null,
        supersededByDecisionId: null,
        sourceUpdateIds: sourceIds,
        briefId: input.briefId ?? null,
      };
      ctx.store.saveDecision(decision);

      if (supersedes) {
        supersedes.status = 'superseded';
        supersedes.supersededByDecisionId = decision.id;
        ctx.store.saveDecision(supersedes);
      }

      audit(ctx, user, 'decision.create', 'decision', decision.id, 'allow', 'ok');
      ctx.logger.info('decisions.create', {
        userId: user.id,
        decisionId: decision.id,
        audienceId: decision.audienceId,
        hasOwner: decision.ownerId !== null,
      });
      res.status(201).json(decision);
    }),
  );

  router.patch(
    '/decisions/:id',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const decision = ctx.store.getDecisionVisibleTo(user, id);
      if (!decision) {
        res.status(404).json({ error: 'not_found', message: 'No such decision.' });
        return;
      }
      if (!hasPermission(user, 'approve')) {
        audit(ctx, user, 'decision.update', 'decision', id, 'deny', 'not_permitted');
        throw new AccessDenied('approval_required', 'Changing a decision needs approval permission.');
      }
      if (decision.status === 'superseded') {
        throw new AccessDenied('decision_superseded', 'A superseded decision is a record. Edit the one that replaced it.', 409);
      }
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: 'Nothing valid to change.' });
        return;
      }
      const patch = parsed.data;
      if (patch.ownerId !== undefined) {
        if (patch.ownerId) {
          const owner = ctx.store.findUser(patch.ownerId);
          if (!owner || owner.orgId !== user.orgId) {
            throw new AccessDenied('owner_not_found', 'The named owner is not on this staff.', 400);
          }
        }
        decision.ownerId = patch.ownerId;
      }
      if (patch.dueDate !== undefined) decision.dueDate = patch.dueDate;
      if (patch.reviewDate !== undefined) decision.reviewDate = patch.reviewDate;
      if (patch.status) {
        decision.status = patch.status;
        decision.completedAt = patch.status === 'completed' ? ctx.clock.now().toISOString() : null;
      }
      ctx.store.saveDecision(decision);
      audit(ctx, user, 'decision.update', 'decision', id, 'allow', 'ok');
      res.json(decision);
    }),
  );

  return router;
}
