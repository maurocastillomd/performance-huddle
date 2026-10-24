import { Router } from 'express';
import { z } from 'zod';
import type { SessionInfo } from '../../shared/types.js';
import { SESSION_COOKIE, signSession } from '../auth/session.js';
import { asyncRoute, audit, currentUser, requireUser, type ApiContext } from './context.js';

const switchSchema = z.object({ userId: z.string().min(1).max(64) });

export function sessionRouter(ctx: ApiContext): Router {
  const router = Router();

  /**
   * Public bootstrap. It exposes the demo roster only while demo identity is
   * enabled, which loadConfig refuses in production. In production this returns
   * no staff information at all.
   */
  router.get('/config', (_req, res) => {
    res.json({
      demoMode: ctx.config.demoIdentity,
      aiProviderKind: ctx.provider.kind,
      aiProviderLabel: ctx.provider.label,
      teamsSso: ctx.config.teamsSso,
      demoUsers: ctx.config.demoIdentity
        ? [...ctx.store.listUsers('org-riverbend'), ...ctx.store.listUsers('org-harbor')].map((u) => ({
            id: u.id,
            name: u.name,
            title: u.title,
            orgId: u.orgId,
            orgName: ctx.store.getOrganization(u.orgId)?.name ?? u.orgId,
            permissions: u.permissions,
            audiences: ctx.store.audiencesFor(u).map((a) => a.name),
          }))
        : [],
    });
  });

  /** Demo-only identity switch. Refused unless demo identity is enabled. */
  router.post('/session', (req, res) => {
    if (!ctx.config.demoIdentity) {
      res.status(404).json({
        error: 'demo_identity_disabled',
        message: 'Demo identity switching is not available on this deployment.',
      });
      return;
    }
    const parsed = switchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', message: 'A userId is required.' });
      return;
    }
    const user = ctx.store.findUser(parsed.data.userId);
    if (!user || user.disabled) {
      ctx.logger.info('session.deny', { userId: parsed.data.userId, reason: 'unknown_or_disabled' });
      res.status(401).json({ error: 'unknown_user', message: 'No such active staff record.' });
      return;
    }
    res.cookie(SESSION_COOKIE, signSession(user.id, ctx.config.sessionSecret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.env === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
    ctx.logger.info('session.start', { userId: user.id, orgId: user.orgId });
    res.json({ ok: true });
  });

  router.delete('/session', (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  router.get(
    '/session',
    requireUser(ctx),
    asyncRoute((_req, res) => {
      const user = currentUser(res);
      const org = ctx.store.getOrganization(user.orgId);
      const info: SessionInfo = {
        user: {
          id: user.id,
          name: user.name,
          title: user.title,
          department: user.department,
          orgId: user.orgId,
          orgName: org?.name ?? user.orgId,
          permissions: user.permissions,
          audiences: ctx.store.audiencesFor(user),
        },
        demoMode: ctx.config.demoIdentity,
        aiProviderLabel: ctx.provider.label,
        aiProviderKind: ctx.provider.kind,
      };
      audit(ctx, user, 'session.read', 'session', user.id, 'allow', 'ok');
      res.json(info);
    }),
  );

  return router;
}
