import { Router } from 'express';
import { z } from 'zod';
import { BRIEF_SECTION_LABELS, BRIEF_SECTION_ORDER } from '../../shared/types.js';
import type { Brief } from '../../shared/types.js';
import { AccessDenied } from '../auth/authorize.js';
import { approveBrief, generateBrief, reviewBriefItem } from '../domain/brief.js';
import { asyncRoute, audit, currentUser, requireUser, type ApiContext } from './context.js';

const createSchema = z.object({
  audienceId: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const reviewSchema = z.object({
  action: z.enum(['confirm', 'edit', 'dismiss']),
  note: z.string().max(2000).nullable().optional(),
});

function renderMarkdown(ctx: ApiContext, brief: Brief): string {
  const audience = ctx.store.getAudience(brief.audienceId);
  const org = ctx.store.getOrganization(brief.orgId);
  const staff = new Map(ctx.store.listUsers(brief.orgId).map((u) => [u.id, u.name]));
  const lines: string[] = [
    `# Daily huddle brief — ${brief.date}`,
    '',
    `**Organization:** ${org?.name ?? brief.orgId}`,
    `**Audience:** ${audience?.name ?? brief.audienceId}${audience?.sensitive ? ' (restricted)' : ''}`,
    `**Approved by:** ${brief.approvedBy ? (staff.get(brief.approvedBy) ?? brief.approvedBy) : 'not approved'}`,
    `**AI provider:** ${brief.ai.label}${brief.ai.available ? '' : ' — unavailable for this brief'}`,
    '',
    'This export contains only sources approved for the audience named above. Do not widen it.',
    '',
  ];

  for (const section of BRIEF_SECTION_ORDER) {
    const items = brief.items.filter((i) => i.section === section && i.reviewState !== 'dismissed');
    lines.push(`## ${BRIEF_SECTION_LABELS[section]}`);
    if (items.length === 0) {
      lines.push('', 'Nothing to flag.', '');
      continue;
    }
    lines.push('');
    for (const item of items) {
      const origin = item.origin === 'ai' ? 'AI interpretation, reviewed' : 'Computed in code';
      lines.push(`- **${item.title}**`);
      lines.push(`  ${item.detail}`);
      if (item.clarifyingQuestion) lines.push(`  Question to ask: ${item.clarifyingQuestion}`);
      lines.push(`  Sources: ${item.sourceUpdateIds.join(', ') || 'none'} · ${origin} · ${item.reviewState}`);
    }
    lines.push('');
  }

  lines.push('---', '', 'Synthetic demonstration data. Not a medical record.');
  return lines.join('\n');
}

export function briefsRouter(ctx: ApiContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.get(
    '/briefs',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const audienceId = typeof req.query.audienceId === 'string' ? req.query.audienceId : undefined;
      res.json(ctx.store.listBriefsVisibleTo(user, { audienceId }));
    }),
  );

  router.get(
    '/briefs/:id',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const brief = ctx.store.getBriefVisibleTo(user, id);
      if (!brief) {
        audit(ctx, user, 'brief.read', 'brief', id, 'deny', 'not_visible');
        res.status(404).json({ error: 'not_found', message: 'No such brief.' });
        return;
      }
      audit(ctx, user, 'brief.read', 'brief', id, 'allow', 'ok');
      res.json(brief);
    }),
  );

  router.post(
    '/briefs',
    asyncRoute(async (req, res) => {
      const user = currentUser(res);
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: 'An audienceId is required.' });
        return;
      }
      const date = parsed.data.date ?? ctx.clock.today();
      const brief = await generateBrief({
        store: ctx.store,
        provider: ctx.provider,
        clock: ctx.clock,
        user,
        audienceId: parsed.data.audienceId,
        date,
      });
      audit(ctx, user, 'brief.generate', 'brief', brief.id, 'allow', `sources_${brief.sourceUpdateIds.length}`);
      ctx.logger.info('briefs.generate', {
        userId: user.id,
        briefId: brief.id,
        audienceId: brief.audienceId,
        sources: brief.sourceUpdateIds.length,
        aiAvailable: brief.ai.available,
        aiRejected: brief.ai.itemsRejected,
      });
      res.status(201).json(brief);
    }),
  );

  router.post(
    '/briefs/:id/items/:itemId/review',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', message: 'An action of confirm, edit, or dismiss is required.' });
        return;
      }
      const brief = reviewBriefItem(
        ctx.store,
        ctx.clock,
        user,
        String(req.params.id),
        String(req.params.itemId),
        parsed.data.action,
        parsed.data.note ?? null,
      );
      audit(ctx, user, `brief.item.${parsed.data.action}`, 'brief_item', String(req.params.itemId), 'allow', 'ok');
      res.json(brief);
    }),
  );

  router.post(
    '/briefs/:id/approve',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const brief = approveBrief(ctx.store, ctx.clock, user, String(req.params.id));
      audit(ctx, user, 'brief.approve', 'brief', brief.id, 'allow', 'ok');
      ctx.logger.info('briefs.approve', { userId: user.id, briefId: brief.id });
      res.json(brief);
    }),
  );

  /** Exports carry the same audience boundary as the brief itself. */
  router.get(
    '/briefs/:id/export',
    asyncRoute((req, res) => {
      const user = currentUser(res);
      const id = String(req.params.id);
      const brief = ctx.store.getBriefVisibleTo(user, id);
      if (!brief) {
        audit(ctx, user, 'brief.export', 'brief', id, 'deny', 'not_visible');
        res.status(404).json({ error: 'not_found', message: 'No such brief.' });
        return;
      }
      if (brief.status !== 'approved') {
        throw new AccessDenied(
          'brief_not_approved',
          brief.status === 'invalidated'
            ? 'This brief was invalidated because one of its sources changed. Regenerate it.'
            : 'Only an approved brief can be exported.',
          409,
        );
      }
      audit(ctx, user, 'brief.export', 'brief', id, 'allow', 'ok');
      ctx.logger.info('briefs.export', { userId: user.id, briefId: id });
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="huddle-${brief.date}-${brief.id}.md"`);
      res.send(renderMarkdown(ctx, brief));
    }),
  );

  return router;
}
