import { Router } from 'express';
import { hasPermission } from '../auth/authorize.js';
import { asyncRoute, currentUser, requireUser, type ApiContext } from './context.js';

/** Search, notifications, and the audit trail. Each carries the same boundary as a read. */
export function insightsRouter(ctx: ApiContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.get(
    '/search',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().toLowerCase();
      if (q.length < 2) {
        res.json({ query: q, results: [] });
        return;
      }
      // The candidate set is filtered by audience before the query is applied,
      // so a search term can never confirm the existence of a hidden record.
      const results = ctx.store
        .listUpdatesVisibleTo(user)
        .filter((u) => {
          const athlete = ctx.store.getAthlete(u.athleteId);
          return (
            u.body.toLowerCase().includes(q) ||
            (u.requestedAction ?? '').toLowerCase().includes(q) ||
            (athlete?.name ?? '').toLowerCase().includes(q)
          );
        })
        .slice(0, 50);
      ctx.logger.info('search.run', { userId: user.id, orgId: user.orgId, results: results.length });
      res.json({ query: q, results });
    }),
  );

  /**
   * Notifications are derived from records the caller can already read. There is
   * no separate delivery path that could bypass the audience check.
   */
  router.get(
    '/notifications',
    asyncRoute((_req, res) => {
      const user = currentUser(res);
      const today = ctx.clock.today();
      const items: { id: string; kind: string; text: string; audienceId: string }[] = [];

      for (const b of ctx.store.listBriefsVisibleTo(user)) {
        if (b.status === 'draft') {
          const pending = b.items.filter((i) => i.reviewState === 'needs_review').length;
          if (pending > 0) {
            items.push({
              id: `n-${b.id}`,
              kind: 'brief_pending',
              text: `Brief ${b.id} for ${b.date} has ${pending} item(s) waiting for review.`,
              audienceId: b.audienceId,
            });
          }
        }
        if (b.status === 'invalidated') {
          items.push({
            id: `n-${b.id}-inv`,
            kind: 'brief_invalidated',
            text: `Brief ${b.id} was invalidated. ${b.invalidatedReason ?? ''}`.trim(),
            audienceId: b.audienceId,
          });
        }
      }

      for (const d of ctx.store.listDecisionsVisibleTo(user)) {
        if (d.status !== 'open') continue;
        if (!d.ownerId) {
          items.push({
            id: `n-${d.id}-owner`,
            kind: 'decision_unowned',
            text: `Decision ${d.id} has no owner: ${d.action}`,
            audienceId: d.audienceId,
          });
        }
        if (d.dueDate && d.dueDate < today) {
          items.push({
            id: `n-${d.id}-due`,
            kind: 'decision_overdue',
            text: `Decision ${d.id} was due ${d.dueDate}: ${d.action}`,
            audienceId: d.audienceId,
          });
        }
      }

      res.json(items);
    }),
  );

  router.get(
    '/audit',
    asyncRoute((_req, res) => {
      const user = currentUser(res);
      if (!hasPermission(user, 'approve')) {
        res.status(403).json({ error: 'approval_required', message: 'The audit trail is for approvers.' });
        return;
      }
      res.json(ctx.store.listAudit(user.orgId, 200));
    }),
  );

  return router;
}
