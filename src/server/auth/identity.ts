import type { Request } from 'express';
import type { StaffUser } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../data/store.js';
import { verifyEntraToken, httpJwks, type JwksSource } from './entra.js';
import { SESSION_COOKIE, parseCookies, verifySession } from './session.js';

export interface IdentityResolver {
  readonly kind: 'demo' | 'entra';
  resolve(req: Request): Promise<StaffUser | null>;
}

/**
 * Demo identity. Switching users sets a signed cookie holding a user id; the
 * server then reads that user from its own directory. A role, an audience, or
 * an organization sent by the client is ignored everywhere, always.
 *
 * loadConfig refuses to start with this enabled when NODE_ENV=production.
 */
export class DemoIdentityResolver implements IdentityResolver {
  readonly kind = 'demo' as const;
  constructor(
    private readonly store: Store,
    private readonly secret: string,
  ) {}

  async resolve(req: Request): Promise<StaffUser | null> {
    const cookies = parseCookies(req.headers.cookie);
    const userId = verifySession(cookies[SESSION_COOKIE], this.secret);
    if (!userId) return null;
    const user = this.store.findUser(userId);
    if (!user || user.disabled) return null;
    return user;
  }
}

/**
 * Production identity from a Teams SSO token.
 * UNVERIFIED against a live tenant. The directory mapping below is the part
 * every organization has to supply: a link from an Entra object id to a staff
 * record with departments and audience memberships.
 */
export class EntraIdentityResolver implements IdentityResolver {
  readonly kind = 'entra' as const;
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly jwks: JwksSource,
  ) {}

  async resolve(req: Request): Promise<StaffUser | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    if (!this.config.entra) return null;
    try {
      const claims = await verifyEntraToken(header.slice(7), this.config.entra, this.jwks);
      // The organization comes from the directory record, never from the request.
      const user = this.store.findUserByEntraObjectId(claims.oid);
      if (!user || user.disabled) return null;
      return user;
    } catch {
      return null;
    }
  }
}

export function createIdentityResolver(store: Store, config: AppConfig): IdentityResolver {
  if (config.teamsSso && config.entra) {
    return new EntraIdentityResolver(store, config, httpJwks(config.entra.tenantId));
  }
  return new DemoIdentityResolver(store, config.sessionSecret);
}
