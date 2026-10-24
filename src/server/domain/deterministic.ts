import type {
  Athlete,
  BriefSectionKey,
  Decision,
  ItemFlag,
  StaffUser,
  Update,
} from '../../shared/types.js';
import { DEPARTMENT_LABELS } from '../../shared/types.js';
import { daysBetween, minutesOfDay } from '../clock.js';

/**
 * Everything in this file is arithmetic and string comparison on stored fields.
 * No model is involved, and none of it can be influenced by the text of a note.
 */

export interface DetectedItem {
  section: BriefSectionKey;
  title: string;
  detail: string;
  sourceUpdateIds: string[];
  athleteId: string | null;
  relatedDecisionId: string | null;
  flags: ItemFlag[];
}

/**
 * Patterns that look like an attempt to give the assistant instructions through
 * a submitted note. Matching only adds a visible marker for a person; it never
 * changes what the workflow does.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|earlier|above)\s+(instructions|rules|prompts)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier|above)/i,
  /system\s+(instruction|prompt|message)/i,
  /\byou\s+are\s+now\s+(a|an|the)\b/i,
  /\bnew\s+instructions\s*:/i,
  /do\s+not\s+mention\s+this/i,
  /on\s+behalf\s+of\s+the\s+(performance\s+coordinator|reviewer|approver|coordinator)/i,
  /mark\s+(every|all)\s+(item|brief|decision)/i,
  /\bapprove\s+the\s+(daily\s+)?brief\b/i,
];

export function detectUntrustedContent(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

function nameOf(athletes: Map<string, Athlete>, id: string): string {
  return athletes.get(id)?.name ?? id;
}

function staffName(users: Map<string, StaffUser>, id: string | null): string {
  if (!id) return 'nobody';
  return users.get(id)?.name ?? id;
}

function baseFlags(update: Update, sensitiveAudience: boolean): ItemFlag[] {
  const flags: ItemFlag[] = [];
  if (sensitiveAudience) flags.push('sensitive_source');
  if (detectUntrustedContent(update.body)) flags.push('untrusted_content');
  return flags;
}

export interface DeterministicContext {
  updates: Update[];
  decisions: Decision[];
  athletes: Map<string, Athlete>;
  users: Map<string, StaffUser>;
  today: string;
  /** Only updates created at or after this timestamp count as "changed". */
  sinceIso: string;
  sensitiveAudience: boolean;
}

/** New updates, revisions, and instructions that replace an earlier one. */
export function whatChanged(ctx: DeterministicContext): DetectedItem[] {
  const items: DetectedItem[] = [];
  const byId = new Map(ctx.updates.map((u) => [u.id, u]));

  for (const u of ctx.updates) {
    if (u.status !== 'approved') continue;
    const isNew = u.createdAt >= ctx.sinceIso;
    const newRevisions = u.revisions.filter((r) => r.revisedAt >= ctx.sinceIso);
    if (!isNew && newRevisions.length === 0) continue;

    const athlete = nameOf(ctx.athletes, u.athleteId);
    const dept = DEPARTMENT_LABELS[u.department];

    if (u.supersedesUpdateId) {
      const prior = byId.get(u.supersedesUpdateId);
      items.push({
        section: 'whatChanged',
        title: `${dept} replaced an earlier instruction for ${athlete}`,
        detail: prior
          ? `${u.id} replaces ${prior.id}. Earlier instruction: "${prior.body}" The earlier version no longer stands.`
          : `${u.id} replaces an earlier instruction that is not in this audience.`,
        sourceUpdateIds: prior ? [u.id, prior.id] : [u.id],
        athleteId: u.athleteId,
        relatedDecisionId: null,
        flags: baseFlags(u, ctx.sensitiveAudience),
      });
      continue;
    }

    if (isNew) {
      items.push({
        section: 'whatChanged',
        title: `${dept} update on ${athlete}`,
        detail: u.requestedAction
          ? `Requested action: ${u.requestedAction} (owner: ${staffName(ctx.users, u.requestedActionOwnerId)}).`
          : 'No action requested.',
        sourceUpdateIds: [u.id],
        athleteId: u.athleteId,
        relatedDecisionId: null,
        flags: baseFlags(u, ctx.sensitiveAudience),
      });
    } else {
      const last = newRevisions[newRevisions.length - 1]!;
      items.push({
        section: 'whatChanged',
        title: `${dept} revised an update on ${athlete}`,
        detail: `Revision note: ${last.note}`,
        sourceUpdateIds: [u.id],
        athleteId: u.athleteId,
        relatedDecisionId: null,
        flags: baseFlags(u, ctx.sensitiveAudience),
      });
    }
  }
  return items;
}

/** Two planned blocks for the same athlete on the huddle date that overlap in time. */
export function scheduleConflicts(ctx: DeterministicContext): DetectedItem[] {
  const items: DetectedItem[] = [];
  const withBlocks = ctx.updates.filter(
    (u) => u.status === 'approved' && u.plannedBlock && u.plannedBlock.date === ctx.today,
  );

  const byAthlete = new Map<string, Update[]>();
  for (const u of withBlocks) {
    const list = byAthlete.get(u.athleteId) ?? [];
    list.push(u);
    byAthlete.set(u.athleteId, list);
  }

  for (const [athleteId, list] of byAthlete) {
    const sorted = [...list].sort(
      (a, b) => minutesOfDay(a.plannedBlock!.start) - minutesOfDay(b.plannedBlock!.start),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const aStart = minutesOfDay(a.plannedBlock!.start);
        const aEnd = minutesOfDay(a.plannedBlock!.end);
        const bStart = minutesOfDay(b.plannedBlock!.start);
        const bEnd = minutesOfDay(b.plannedBlock!.end);
        const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
        if (overlap <= 0) continue;

        items.push({
          section: 'scheduleConflicts',
          title: `${nameOf(ctx.athletes, athleteId)} is double-booked for ${overlap} minutes`,
          detail:
            `${a.plannedBlock!.label} ${a.plannedBlock!.start}–${a.plannedBlock!.end} ` +
            `(${DEPARTMENT_LABELS[a.department]}) overlaps ` +
            `${b.plannedBlock!.label} ${b.plannedBlock!.start}–${b.plannedBlock!.end} ` +
            `(${DEPARTMENT_LABELS[b.department]}).`,
          sourceUpdateIds: [a.id, b.id],
          athleteId,
          relatedDecisionId: null,
          flags: [...new Set([...baseFlags(a, ctx.sensitiveAudience), ...baseFlags(b, ctx.sensitiveAudience)])],
        });
      }
    }
  }
  return items;
}

/** Guidance whose review date has passed and which nothing newer has replaced. */
export function outdatedInformation(ctx: DeterministicContext): DetectedItem[] {
  const supersededIds = new Set(
    ctx.updates.map((u) => u.supersedesUpdateId).filter((id): id is string => !!id),
  );

  return ctx.updates
    .filter((u) => u.status === 'approved')
    .filter((u) => !supersededIds.has(u.id))
    .filter((u) => daysBetween(u.reviewDate, ctx.today) > 0)
    .map((u) => {
      const daysPast = daysBetween(u.reviewDate, ctx.today);
      return {
        section: 'outdatedInformation' as const,
        title: `${DEPARTMENT_LABELS[u.department]} guidance on ${nameOf(ctx.athletes, u.athleteId)} is past its review date`,
        detail: `Review date was ${u.reviewDate}, ${daysPast} day${daysPast === 1 ? '' : 's'} ago. It stays in force until ${staffName(ctx.users, u.authorId)} reviews it.`,
        sourceUpdateIds: [u.id],
        athleteId: u.athleteId,
        relatedDecisionId: null,
        flags: baseFlags(u, ctx.sensitiveAudience),
      };
    });
}

/** Requested actions and open decisions with nobody assigned. */
export function actionsMissingOwner(ctx: DeterministicContext): DetectedItem[] {
  const items: DetectedItem[] = [];

  // An update whose action is already tracked by an open decision is raised
  // once, through that decision, rather than twice.
  const trackedByDecision = new Set(
    ctx.decisions.filter((d) => d.status === 'open').flatMap((d) => d.sourceUpdateIds),
  );

  for (const u of ctx.updates) {
    if (u.status !== 'approved') continue;
    if (!u.requestedAction || u.requestedActionOwnerId) continue;
    if (trackedByDecision.has(u.id)) continue;
    items.push({
      section: 'actionsMissingOwner',
      title: `No owner: ${u.requestedAction}`,
      detail: `Requested by ${staffName(ctx.users, u.authorId)} (${DEPARTMENT_LABELS[u.department]}) on ${nameOf(ctx.athletes, u.athleteId)}. Nobody is assigned.`,
      sourceUpdateIds: [u.id],
      athleteId: u.athleteId,
      relatedDecisionId: null,
      flags: baseFlags(u, ctx.sensitiveAudience),
    });
  }

  const visibleUpdateIds = new Set(ctx.updates.map((u) => u.id));
  for (const d of ctx.decisions) {
    if (d.status !== 'open' || d.ownerId) continue;
    items.push({
      section: 'actionsMissingOwner',
      title: `No owner: ${d.action}`,
      detail: `Decision ${d.id} is open with nobody assigned. Recorded by ${staffName(ctx.users, d.createdBy)}.`,
      sourceUpdateIds: d.sourceUpdateIds.filter((id) => visibleUpdateIds.has(id)),
      athleteId: d.athleteId,
      relatedDecisionId: d.id,
      flags: [],
    });
  }
  return items;
}

export function runDeterministic(ctx: DeterministicContext): DetectedItem[] {
  return [
    ...whatChanged(ctx),
    ...scheduleConflicts(ctx),
    ...outdatedInformation(ctx),
    ...actionsMissingOwner(ctx),
  ];
}
