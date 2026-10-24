import type {
  Athlete,
  Audience,
  Brief,
  Decision,
  Organization,
  StaffUser,
  Update,
} from '../../shared/types.js';
import { canReadBrief, canReadDecision, canReadUpdate } from '../auth/authorize.js';

export interface AuditRecord {
  at: string;
  actorId: string;
  orgId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allow' | 'deny';
  /** A short machine reason. Never free text from a submitted note. */
  reason: string;
}

export interface SeedBundle {
  organizations: Organization[];
  audiences: Audience[];
  users: StaffUser[];
  athletes: Athlete[];
  updates: Update[];
  decisions: Decision[];
}

/**
 * In-memory repository. Everything a caller can read goes through a `visibleTo`
 * method so unauthorized rows are never loaded into a response, an export, or
 * an AI request. See docs/DATA-HANDLING.md for the production swap.
 */
export class Store {
  private organizations = new Map<string, Organization>();
  private audiences = new Map<string, Audience>();
  private users = new Map<string, StaffUser>();
  private athletes = new Map<string, Athlete>();
  private updates = new Map<string, Update>();
  private briefs = new Map<string, Brief>();
  private decisions = new Map<string, Decision>();
  private audit: AuditRecord[] = [];
  private counters = new Map<string, number>();

  constructor(seed: SeedBundle) {
    for (const o of seed.organizations) this.organizations.set(o.id, o);
    for (const a of seed.audiences) this.audiences.set(a.id, a);
    for (const u of seed.users) this.users.set(u.id, structuredClone(u));
    for (const a of seed.athletes) this.athletes.set(a.id, a);
    for (const u of seed.updates) this.updates.set(u.id, structuredClone(u));
    for (const d of seed.decisions) this.decisions.set(d.id, structuredClone(d));
  }

  nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${String(n).padStart(3, '0')}`;
  }

  // ---------------------------------------------------------------- directory
  /**
   * The directory is re-read on every request. There is no cached copy of a
   * user's memberships anywhere, so a revocation takes effect on the next call.
   */
  findUser(id: string): StaffUser | null {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }

  /** Directory lookup by Entra object id. Never scoped by a client-supplied hint. */
  findUserByEntraObjectId(oid: string): StaffUser | null {
    for (const u of this.users.values()) {
      if (u.entraObjectId && u.entraObjectId === oid) return structuredClone(u);
    }
    return null;
  }

  listUsers(orgId: string): StaffUser[] {
    return [...this.users.values()].filter((u) => u.orgId === orgId).map((u) => structuredClone(u));
  }

  revokeAudience(userId: string, audienceId: string): void {
    const u = this.users.get(userId);
    if (!u) return;
    u.audienceIds = u.audienceIds.filter((a) => a !== audienceId);
  }

  grantAudience(userId: string, audienceId: string): void {
    const u = this.users.get(userId);
    if (!u || u.audienceIds.includes(audienceId)) return;
    u.audienceIds.push(audienceId);
  }

  setUserDisabled(userId: string, disabled: boolean): void {
    const u = this.users.get(userId);
    if (u) u.disabled = disabled;
  }

  getOrganization(id: string): Organization | null {
    return this.organizations.get(id) ?? null;
  }

  getAudience(id: string): Audience | null {
    return this.audiences.get(id) ?? null;
  }

  audiencesFor(user: StaffUser): Audience[] {
    return user.audienceIds
      .map((id) => this.audiences.get(id))
      .filter((a): a is Audience => !!a && a.orgId === user.orgId);
  }

  athletesFor(user: StaffUser): Athlete[] {
    return [...this.athletes.values()]
      .filter((a) => a.orgId === user.orgId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getAthlete(id: string): Athlete | null {
    return this.athletes.get(id) ?? null;
  }

  // ----------------------------------------------------------------- updates
  /** Unfiltered read. Only for internal integrity work, never for a response. */
  getUpdateUnchecked(id: string): Update | null {
    const u = this.updates.get(id);
    return u ? structuredClone(u) : null;
  }

  getUpdateVisibleTo(user: StaffUser, id: string): Update | null {
    const u = this.updates.get(id);
    if (!u) return null;
    return canReadUpdate(user, u) ? structuredClone(u) : null;
  }

  listUpdatesVisibleTo(
    user: StaffUser,
    filter: { audienceId?: string; athleteId?: string; sinceIso?: string } = {},
  ): Update[] {
    return [...this.updates.values()]
      .filter((u) => canReadUpdate(user, u))
      .filter((u) => (filter.audienceId ? u.audienceId === filter.audienceId : true))
      .filter((u) => (filter.athleteId ? u.athleteId === filter.athleteId : true))
      .filter((u) => (filter.sinceIso ? u.createdAt >= filter.sinceIso : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((u) => structuredClone(u));
  }

  insertUpdate(update: Update): Update {
    this.updates.set(update.id, structuredClone(update));
    return structuredClone(update);
  }

  replaceUpdate(update: Update): Update {
    this.updates.set(update.id, structuredClone(update));
    return structuredClone(update);
  }

  // ------------------------------------------------------------------ briefs
  getBriefUnchecked(id: string): Brief | null {
    const b = this.briefs.get(id);
    return b ? structuredClone(b) : null;
  }

  getBriefVisibleTo(user: StaffUser, id: string): Brief | null {
    const b = this.briefs.get(id);
    if (!b) return null;
    return canReadBrief(user, b) ? structuredClone(b) : null;
  }

  listBriefsVisibleTo(user: StaffUser, filter: { audienceId?: string } = {}): Brief[] {
    return [...this.briefs.values()]
      .filter((b) => canReadBrief(user, b))
      .filter((b) => (filter.audienceId ? b.audienceId === filter.audienceId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => structuredClone(b));
  }

  saveBrief(brief: Brief): Brief {
    this.briefs.set(brief.id, structuredClone(brief));
    return structuredClone(brief);
  }

  /**
   * A brief is a claim about a set of sources. When one of those sources is
   * withdrawn or moved to a narrower audience the claim no longer holds, so
   * every brief citing it is invalidated and drops out of reads and exports.
   */
  invalidateBriefsCiting(updateId: string, reason: string): Brief[] {
    const touched: Brief[] = [];
    for (const b of this.briefs.values()) {
      if (b.status === 'invalidated') continue;
      if (!b.sourceUpdateIds.includes(updateId)) continue;
      b.status = 'invalidated';
      b.invalidatedReason = reason;
      touched.push(structuredClone(b));
    }
    return touched;
  }

  // --------------------------------------------------------------- decisions
  listDecisionsVisibleTo(user: StaffUser): Decision[] {
    return [...this.decisions.values()]
      .filter((d) => canReadDecision(user, d))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => structuredClone(d));
  }

  getDecisionVisibleTo(user: StaffUser, id: string): Decision | null {
    const d = this.decisions.get(id);
    if (!d) return null;
    return canReadDecision(user, d) ? structuredClone(d) : null;
  }

  saveDecision(decision: Decision): Decision {
    this.decisions.set(decision.id, structuredClone(decision));
    return structuredClone(decision);
  }

  // ------------------------------------------------------------------- audit
  recordAudit(record: AuditRecord): void {
    this.audit.push(record);
    if (this.audit.length > 2000) this.audit.splice(0, this.audit.length - 2000);
  }

  listAudit(orgId: string, limit = 100): AuditRecord[] {
    return this.audit
      .filter((a) => a.orgId === orgId)
      .slice(-limit)
      .reverse();
  }
}
