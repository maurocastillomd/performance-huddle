import type { Audience, Brief, Decision, Permission, StaffUser, Update } from '../../shared/types.js';

/**
 * Every authorization decision in the application is made by one of these
 * predicates. They are pure functions of the caller's directory record and the
 * stored resource. Nothing here reads a request body, a header, or model output.
 */

export class AccessDenied extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function sameOrg(user: StaffUser, resource: { orgId: string }): boolean {
  return user.orgId === resource.orgId;
}

export function inAudience(user: StaffUser, audienceId: string): boolean {
  return user.audienceIds.includes(audienceId);
}

export function hasPermission(user: StaffUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

/** Reading an update requires the same organization and membership of its audience. */
export function canReadUpdate(user: StaffUser, update: Update): boolean {
  if (user.disabled) return false;
  if (!sameOrg(user, update)) return false;
  if (!inAudience(user, update.audienceId)) return false;
  if (update.status === 'withdrawn') {
    // A withdrawn update stays visible to its author and to approvers so the
    // trail is not lost, but it never reaches a brief or the model.
    return update.authorId === user.id || hasPermission(user, 'approve');
  }
  return true;
}

export function canReadBrief(user: StaffUser, brief: Brief): boolean {
  if (user.disabled) return false;
  return sameOrg(user, brief) && inAudience(user, brief.audienceId);
}

export function canReadDecision(user: StaffUser, decision: Decision): boolean {
  if (user.disabled) return false;
  return sameOrg(user, decision) && inAudience(user, decision.audienceId);
}

export function canSubmitTo(user: StaffUser, audience: Audience): boolean {
  return (
    !user.disabled &&
    sameOrg(user, audience) &&
    inAudience(user, audience.id) &&
    hasPermission(user, 'submit')
  );
}

/** Generating, editing and approving a brief are reviewer actions. */
export function canReviewAudience(user: StaffUser, audience: Audience): boolean {
  return (
    !user.disabled &&
    sameOrg(user, audience) &&
    inAudience(user, audience.id) &&
    hasPermission(user, 'approve')
  );
}

export function assert(condition: boolean, code: string, message: string, status = 403): void {
  if (!condition) throw new AccessDenied(code, message, status);
}

/**
 * Being able to read a source does not authorize republishing it to a wider
 * group. A brief may only cite sources whose audience is exactly the brief's
 * audience, checked here rather than trusted from anywhere upstream.
 */
export function assertSourcesMatchAudience(audienceId: string, sources: Update[]): void {
  const strays = sources.filter((s) => s.audienceId !== audienceId);
  if (strays.length > 0) {
    throw new AccessDenied(
      'audience_escalation',
      `Refused: ${strays.length} source update(s) belong to a different audience than the brief. A brief may only cite sources approved for its own audience.`,
    );
  }
}
