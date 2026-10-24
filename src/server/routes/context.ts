import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { StaffUser } from '../../shared/types.js';
import { AccessDenied } from '../auth/authorize.js';
import type { IdentityResolver } from '../auth/identity.js';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../data/store.js';
import type { AiProvider } from '../ai/contract.js';
import type { Logger } from '../log/logger.js';

export interface ApiContext {
  store: Store;
  config: AppConfig;
  clock: Clock;
  provider: AiProvider;
  identity: IdentityResolver;
  logger: Logger;
}

declare module 'express-serve-static-core' {
  interface Locals {
    user?: StaffUser;
  }
}

export function currentUser(res: Response): StaffUser {
  const user = res.locals.user;
  if (!user) throw new AccessDenied('unauthenticated', 'Sign in first.', 401);
  return user;
}

/**
 * Resolves identity from the configured provider on every request. There is no
 * session cache of memberships: the directory is the only source.
 */
export function requireUser(ctx: ApiContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    ctx.identity
      .resolve(req)
      .then((user) => {
        if (!user) {
          ctx.logger.info('auth.deny', { path: req.path, reason: 'no_identity' });
          res.status(401).json({ error: 'unauthenticated', message: 'Sign in first.' });
          return;
        }
        res.locals.user = user;
        next();
      })
      .catch(next);
  };
}

export function asyncRoute(handler: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

/** Records the outcome of an authorization-relevant action. Identifiers only. */
export function audit(
  ctx: ApiContext,
  user: StaffUser,
  action: string,
  resourceType: string,
  resourceId: string,
  decision: 'allow' | 'deny',
  reason: string,
): void {
  ctx.store.recordAudit({
    at: ctx.clock.now().toISOString(),
    actorId: user.id,
    orgId: user.orgId,
    action,
    resourceType,
    resourceId,
    decision,
    reason,
  });
}
