import type {
  AiSummary,
  Athlete,
  Brief,
  BriefItem,
  ItemFlag,
  StaffUser,
} from '../../shared/types.js';
import { AccessDenied, assert, assertSourcesMatchAudience, canReadUpdate, canReviewAudience } from '../auth/authorize.js';
import type { Clock } from '../clock.js';
import type { Store } from '../data/store.js';
import type { AiNote, AiProvider, AiRequest } from '../ai/contract.js';
import { validateAiOutput } from '../ai/contract.js';
import { detectUntrustedContent, runDeterministic } from './deterministic.js';
import type { DeterministicContext } from './deterministic.js';

export interface GenerateBriefInput {
  store: Store;
  provider: AiProvider;
  clock: Clock;
  user: StaffUser;
  audienceId: string;
  date: string;
}

/** Names are replaced before anything leaves the process. */
function labelAthletes(athleteIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  [...new Set(athleteIds)].sort().forEach((id, i) => map.set(id, `Athlete ${i + 1}`));
  return map;
}

function deLabel(text: string, labels: Map<string, string>, athletes: Map<string, Athlete>): string {
  let out = text;
  for (const [athleteId, label] of labels) {
    const name = athletes.get(athleteId)?.name;
    if (!name) continue;
    out = out.split(label).join(name);
  }
  return out;
}

export async function generateBrief(input: GenerateBriefInput): Promise<Brief> {
  const { store, provider, clock, user, audienceId, date } = input;

  const audience = store.getAudience(audienceId);
  if (!audience || audience.orgId !== user.orgId) {
    throw new AccessDenied('audience_not_found', 'No such audience for this organization.', 404);
  }
  assert(
    canReviewAudience(user, audience),
    'approval_required',
    'Generating a brief needs approval permission and membership of the audience.',
  );

  // Authorization runs before the read: only rows this caller may see are loaded.
  const visible = store.listUpdatesVisibleTo(user, { audienceId });
  const sources = visible.filter((u) => u.status === 'approved');
  // A second, independent check that nothing from a wider or narrower audience slipped in.
  assertSourcesMatchAudience(audienceId, sources);

  const athletes = new Map(store.athletesFor(user).map((a) => [a.id, a]));
  const users = new Map(store.listUsers(user.orgId).map((u) => [u.id, u]));

  const priorApproved = store
    .listBriefsVisibleTo(user, { audienceId })
    .filter((b) => b.status === 'approved')
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''));
  const last = priorApproved[priorApproved.length - 1];
  const sinceIso = last?.createdAt ?? `${date}T00:00:00`;

  const ctx: DeterministicContext = {
    updates: sources,
    decisions: store.listDecisionsVisibleTo(user).filter((d) => d.audienceId === audienceId),
    athletes,
    users,
    today: date,
    sinceIso,
    sensitiveAudience: audience.sensitive,
  };

  const briefId = store.nextId('B');
  const items: BriefItem[] = [];
  let seq = 0;
  const nextItemId = (): string => {
    seq += 1;
    return `${briefId}-I${String(seq).padStart(2, '0')}`;
  };

  for (const d of runDeterministic(ctx)) {
    items.push({
      id: nextItemId(),
      section: d.section,
      origin: 'deterministic',
      title: d.title,
      detail: d.detail,
      sourceUpdateIds: d.sourceUpdateIds,
      athleteId: d.athleteId,
      reviewState: 'needs_review',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      clarifyingQuestion: null,
      relatedDecisionId: d.relatedDecisionId,
      flags: d.flags,
    });
  }

  // ------------------------------------------------------------------ AI pass
  const labels = labelAthletes(sources.map((s) => s.athleteId));
  const notes: AiNote[] = sources.map((s) => ({
    sourceId: s.id,
    department: s.department,
    athleteLabel: labels.get(s.athleteId) ?? 'Athlete',
    date: s.createdAt.slice(0, 10),
    text: s.body,
    requestedAction: s.requestedAction,
  }));
  const request: AiRequest = {
    huddleDate: date,
    audienceLabel: audience.sensitive ? 'restricted performance audience' : 'performance audience',
    notes,
  };

  // Independent re-check immediately before the model call.
  for (const s of sources) {
    if (!canReadUpdate(user, s) || s.audienceId !== audienceId) {
      throw new AccessDenied('preflight_failed', 'Refused to send an unauthorized source to the model.');
    }
  }

  let aiSummaries: AiSummary[] = [];
  let itemsProposed = 0;
  let rejections: string[] = [];
  let available = true;
  let unavailableReason: string | null = null;

  try {
    const raw = await provider.analyze(request);
    const rawDisagreements = Array.isArray((raw as { possibleDisagreements?: unknown[] })?.possibleDisagreements)
      ? ((raw as { possibleDisagreements: unknown[] }).possibleDisagreements as unknown[]).length
      : 0;
    itemsProposed = rawDisagreements;

    const { envelope, rejections: rejected } = validateAiOutput(
      raw,
      sources.map((s) => s.id),
    );
    rejections = rejected;

    aiSummaries = envelope.summaries.map((s) => ({
      sourceUpdateId: s.sourceId,
      summary: deLabel(s.summary, labels, athletes),
    }));

    const sourceById = new Map(sources.map((s) => [s.id, s]));
    for (const d of envelope.possibleDisagreements) {
      const cited = d.sourceIds.map((id) => sourceById.get(id)!);
      const flags: ItemFlag[] = ['ai_unverified'];
      if (audience.sensitive) flags.push('sensitive_source');
      if (cited.some((s) => detectUntrustedContent(s.body))) flags.push('untrusted_content');
      const athleteId = cited[0]?.athleteId ?? null;

      items.push({
        id: nextItemId(),
        section: 'possibleDisagreements',
        origin: 'ai',
        title: `Possible disagreement on ${athleteId ? (athletes.get(athleteId)?.name ?? 'an athlete') : 'an athlete'}`,
        detail: deLabel(d.description, labels, athletes),
        sourceUpdateIds: d.sourceIds,
        athleteId,
        reviewState: 'needs_review',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        clarifyingQuestion: deLabel(d.clarifyingQuestion, labels, athletes),
        relatedDecisionId: null,
        flags,
      });
    }
  } catch (err) {
    available = false;
    unavailableReason =
      `The configured provider did not return a usable response (${(err as Error).name}). ` +
      'The brief below is the part computed in code. No provider was substituted.';
  }

  const brief: Brief = {
    id: briefId,
    orgId: user.orgId,
    audienceId,
    date,
    status: 'draft',
    createdBy: user.id,
    createdAt: clock.now().toISOString(),
    approvedBy: null,
    approvedAt: null,
    invalidatedReason: null,
    items,
    sourceUpdateIds: sources.map((s) => s.id),
    aiSummaries,
    ai: {
      provider: provider.kind,
      label: provider.label,
      available,
      unavailableReason,
      itemsProposed,
      itemsRejected: rejections.length,
      rejectionReasons: rejections,
    },
  };

  return store.saveBrief(brief);
}

export type ReviewAction = 'confirm' | 'edit' | 'dismiss';

export function reviewBriefItem(
  store: Store,
  clock: Clock,
  user: StaffUser,
  briefId: string,
  itemId: string,
  action: ReviewAction,
  note: string | null,
): Brief {
  const brief = store.getBriefVisibleTo(user, briefId);
  if (!brief) throw new AccessDenied('brief_not_found', 'No such brief.', 404);
  const audience = store.getAudience(brief.audienceId)!;
  assert(canReviewAudience(user, audience), 'approval_required', 'Reviewing items needs approval permission.');
  assert(brief.status === 'draft', 'brief_not_draft', 'Only a draft brief can be reviewed.', 409);

  const item = brief.items.find((i) => i.id === itemId);
  if (!item) throw new AccessDenied('item_not_found', 'No such item on this brief.', 404);

  if (action === 'edit') {
    assert(!!note && note.trim().length > 0, 'edit_requires_text', 'An edit needs replacement text.', 400);
    item.detail = note!.trim();
    item.reviewState = 'edited';
  } else {
    item.reviewState = action === 'confirm' ? 'confirmed' : 'dismissed';
    item.reviewNote = note?.trim() ?? null;
  }
  item.reviewedBy = user.id;
  item.reviewedAt = clock.now().toISOString();

  return store.saveBrief(brief);
}

export function approveBrief(store: Store, clock: Clock, user: StaffUser, briefId: string): Brief {
  const brief = store.getBriefVisibleTo(user, briefId);
  if (!brief) throw new AccessDenied('brief_not_found', 'No such brief.', 404);
  const audience = store.getAudience(brief.audienceId)!;
  assert(
    canReviewAudience(user, audience),
    'approval_required',
    'Approving a brief needs approval permission for this audience.',
  );
  assert(brief.status === 'draft', 'brief_not_draft', 'Only a draft brief can be approved.', 409);

  const pending = brief.items.filter((i) => i.reviewState === 'needs_review');
  assert(
    pending.length === 0,
    'items_pending_review',
    `${pending.length} item(s) still need a person to confirm, edit, or dismiss them.`,
    409,
  );

  brief.status = 'approved';
  brief.approvedBy = user.id;
  brief.approvedAt = clock.now().toISOString();
  return store.saveBrief(brief);
}
