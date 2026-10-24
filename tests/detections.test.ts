import { describe, expect, it } from 'vitest';
import type { Athlete, Decision, StaffUser, Update } from '../src/shared/types.js';
import { MockAiProvider } from '../src/server/ai/mock.js';
import type { AiNote } from '../src/server/ai/contract.js';
import {
  actionsMissingOwner,
  outdatedInformation,
  scheduleConflicts,
  whatChanged,
  type DeterministicContext,
} from '../src/server/domain/deterministic.js';
import { createHarness } from './helpers.js';

const ATHLETES = new Map<string, Athlete>([
  ['a-1', { id: 'a-1', orgId: 'o', name: 'Tobias Wren', position: 'C', jersey: 8 }],
  ['a-2', { id: 'a-2', orgId: 'o', name: 'Nico Bassett', position: 'OF', jersey: 24 }],
]);

const USERS = new Map<string, StaffUser>([
  [
    'u-1',
    { id: 'u-1', orgId: 'o', name: 'Marcus Okafor', title: 'S&C', department: 'strength_conditioning', permissions: ['submit'], audienceIds: ['aud'], disabled: false },
  ],
]);

function update(over: Partial<Update>): Update {
  return {
    id: 'U1',
    orgId: 'o',
    athleteId: 'a-1',
    department: 'strength_conditioning',
    body: 'A note.',
    requestedAction: null,
    requestedActionOwnerId: null,
    audienceId: 'aud',
    reviewDate: '2026-06-20',
    authorId: 'u-1',
    createdAt: '2026-06-11T08:00:00',
    status: 'approved',
    supersedesUpdateId: null,
    plannedBlock: null,
    revisions: [],
    ...over,
  };
}

function ctx(updates: Update[], decisions: Decision[] = []): DeterministicContext {
  return {
    updates,
    decisions,
    athletes: ATHLETES,
    users: USERS,
    today: '2026-06-11',
    sinceIso: '2026-06-11T00:00:00',
    sensitiveAudience: false,
  };
}

function block(date: string, start: string, end: string, label = 'Block') {
  return { date, start, end, label };
}

describe('schedule conflict detection', () => {
  const cases: { name: string; a: [string, string]; b: [string, string]; overlap: number }[] = [
    { name: 'partial overlap', a: ['14:00', '15:00'], b: ['14:30', '15:45'], overlap: 30 },
    { name: 'identical blocks', a: ['09:00', '10:00'], b: ['09:00', '10:00'], overlap: 60 },
    { name: 'one inside the other', a: ['09:00', '12:00'], b: ['10:00', '10:30'], overlap: 30 },
    { name: 'back to back', a: ['14:00', '15:00'], b: ['15:00', '16:00'], overlap: 0 },
    { name: 'separated', a: ['09:00', '10:00'], b: ['13:00', '14:00'], overlap: 0 },
    { name: 'one minute overlap', a: ['09:00', '10:00'], b: ['09:59', '11:00'], overlap: 1 },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.overlap} minutes`, () => {
      const items = scheduleConflicts(
        ctx([
          update({ id: 'A', plannedBlock: block('2026-06-11', c.a[0], c.a[1]) }),
          update({ id: 'B', department: 'coaching', plannedBlock: block('2026-06-11', c.b[0], c.b[1]) }),
        ]),
      );
      if (c.overlap === 0) {
        expect(items).toHaveLength(0);
      } else {
        expect(items).toHaveLength(1);
        expect(items[0]!.title).toContain(`${c.overlap} minutes`);
        expect(items[0]!.sourceUpdateIds.sort()).toEqual(['A', 'B']);
      }
    });
  }

  it('ignores blocks on a different day and blocks for different athletes', () => {
    const otherDay = scheduleConflicts(
      ctx([
        update({ id: 'A', plannedBlock: block('2026-06-11', '14:00', '15:00') }),
        update({ id: 'B', plannedBlock: block('2026-06-12', '14:00', '15:00') }),
      ]),
    );
    expect(otherDay).toHaveLength(0);

    const otherAthlete = scheduleConflicts(
      ctx([
        update({ id: 'A', athleteId: 'a-1', plannedBlock: block('2026-06-11', '14:00', '15:00') }),
        update({ id: 'B', athleteId: 'a-2', plannedBlock: block('2026-06-11', '14:00', '15:00') }),
      ]),
    );
    expect(otherAthlete).toHaveLength(0);
  });

  it('ignores a withdrawn block', () => {
    const items = scheduleConflicts(
      ctx([
        update({ id: 'A', plannedBlock: block('2026-06-11', '14:00', '15:00') }),
        update({ id: 'B', status: 'withdrawn', plannedBlock: block('2026-06-11', '14:00', '15:00') }),
      ]),
    );
    expect(items).toHaveLength(0);
  });
});

describe('outdated information', () => {
  it('flags guidance past its review date and says how far past', () => {
    const items = outdatedInformation(ctx([update({ id: 'A', reviewDate: '2026-06-09' })]));
    expect(items).toHaveLength(1);
    expect(items[0]!.detail).toContain('2 days ago');
  });

  it('does not flag guidance due for review today or later', () => {
    expect(outdatedInformation(ctx([update({ reviewDate: '2026-06-11' })]))).toHaveLength(0);
    expect(outdatedInformation(ctx([update({ reviewDate: '2026-06-12' })]))).toHaveLength(0);
  });

  it('does not flag guidance that something newer has replaced', () => {
    const items = outdatedInformation(
      ctx([
        update({ id: 'OLD', reviewDate: '2026-06-01' }),
        update({ id: 'NEW', supersedesUpdateId: 'OLD', reviewDate: '2026-06-30' }),
      ]),
    );
    expect(items).toHaveLength(0);
  });
});

describe('actions missing an owner', () => {
  it('flags a requested action with nobody assigned', () => {
    const items = actionsMissingOwner(ctx([update({ id: 'A', requestedAction: 'Restart the mobility block' })]));
    expect(items).toHaveLength(1);
    expect(items[0]!.sourceUpdateIds).toEqual(['A']);
  });

  it('does not flag an action that has an owner', () => {
    const items = actionsMissingOwner(
      ctx([update({ requestedAction: 'Do the thing', requestedActionOwnerId: 'u-1' })]),
    );
    expect(items).toHaveLength(0);
  });

  it('flags an open decision with no owner and links it to the decision', () => {
    const decision: Decision = {
      id: 'D1', orgId: 'o', audienceId: 'aud', athleteId: 'a-1',
      action: 'Tell the athlete', ownerId: null, rationale: 'Agreed in the room.',
      dueDate: null, reviewDate: null, status: 'open', createdBy: 'u-1',
      createdAt: '2026-06-10T12:00:00', completedAt: null,
      supersedesDecisionId: null, supersededByDecisionId: null,
      sourceUpdateIds: ['A'], briefId: null,
    };
    const items = actionsMissingOwner(ctx([update({ id: 'A' })], [decision]));
    expect(items).toHaveLength(1);
    expect(items[0]!.relatedDecisionId).toBe('D1');
  });

  it('raises an action once when a decision already tracks it', () => {
    const decision: Decision = {
      id: 'D1', orgId: 'o', audienceId: 'aud', athleteId: 'a-1',
      action: 'Tell the athlete', ownerId: null, rationale: 'Agreed in the room.',
      dueDate: null, reviewDate: null, status: 'open', createdBy: 'u-1',
      createdAt: '2026-06-10T12:00:00', completedAt: null,
      supersedesDecisionId: null, supersededByDecisionId: null,
      sourceUpdateIds: ['A'], briefId: null,
    };
    const items = actionsMissingOwner(
      ctx([update({ id: 'A', requestedAction: 'Tell the athlete' })], [decision]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.relatedDecisionId).toBe('D1');
  });
});

describe('what changed', () => {
  it('names the replaced instruction and cites both sources', () => {
    const items = whatChanged(
      ctx([
        update({ id: 'OLD', createdAt: '2026-06-09T08:00:00', body: 'Cap at 25 pitches.' }),
        update({ id: 'NEW', createdAt: '2026-06-11T07:00:00', supersedesUpdateId: 'OLD' }),
      ]),
    );
    const replacement = items.find((i) => i.title.includes('replaced'));
    expect(replacement?.sourceUpdateIds).toEqual(['NEW', 'OLD']);
    expect(replacement?.detail).toContain('no longer stands');
  });

  it('leaves out updates from before the window', () => {
    const items = whatChanged(ctx([update({ id: 'OLD', createdAt: '2026-06-08T08:00:00' })]));
    expect(items).toHaveLength(0);
  });

  it('reports a revision made inside the window', () => {
    const items = whatChanged(
      ctx([
        update({
          id: 'A',
          createdAt: '2026-06-08T08:00:00',
          revisions: [
            { revisedAt: '2026-06-11T09:00:00', revisedBy: 'u-1', note: 'Corrected the days.', previousBody: 'Old text.' },
          ],
        }),
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.detail).toContain('Corrected the days.');
  });
});

describe('possible disagreements: signal and silence', () => {
  const provider = new MockAiProvider();
  const note = (over: Partial<AiNote>): AiNote => ({
    sourceId: 'N1',
    department: 'coaching',
    athleteLabel: 'Athlete 1',
    date: '2026-06-11',
    text: '',
    requestedAction: null,
    ...over,
  });

  it('flags opposite directions on the same topic from two departments', async () => {
    const out = (await provider.analyze({
      huddleDate: '2026-06-11',
      audienceLabel: 'performance audience',
      notes: [
        note({ sourceId: 'N1', department: 'coaching', text: 'I want to add extra conditioning after each game this week.' }),
        note({ sourceId: 'N2', department: 'sports_science', text: 'We reduce his running volume for the next seven days.' }),
      ],
    })) as { possibleDisagreements: { sourceIds: string[] }[] };
    expect(out.possibleDisagreements).toHaveLength(1);
    expect(out.possibleDisagreements[0]!.sourceIds.sort()).toEqual(['N1', 'N2']);
  });

  it('stays silent on compatible perspectives from two departments', async () => {
    const out = (await provider.analyze({
      huddleDate: '2026-06-11',
      audienceLabel: 'performance audience',
      notes: [
        note({
          sourceId: 'N1',
          department: 'strength_conditioning',
          text: 'Bassett has a heavier lower-body lift scheduled Thursday. Expect a higher session load that day.',
        }),
        note({
          sourceId: 'N2',
          department: 'nutrition',
          text: 'Increasing carbohydrate availability for Bassett around Thursday’s heavier lift. An extra recovery shake after the session.',
        }),
      ],
    })) as { possibleDisagreements: unknown[] };
    expect(out.possibleDisagreements).toHaveLength(0);
  });

  it('stays silent when one department revises its own instruction', async () => {
    const out = (await provider.analyze({
      huddleDate: '2026-06-11',
      audienceLabel: 'performance audience',
      notes: [
        note({ sourceId: 'N1', department: 'sports_science', text: 'Bullpen volume is capped at 25 pitches this week.' }),
        note({ sourceId: 'N2', department: 'sports_science', text: 'Adding five more pitches to the bullpen cap.' }),
      ],
    })) as { possibleDisagreements: unknown[] };
    expect(out.possibleDisagreements).toHaveLength(0);
  });

  it('stays silent on a quiet day', async () => {
    const out = (await provider.analyze({
      huddleDate: '2026-06-11',
      audienceLabel: 'performance audience',
      notes: [
        note({ sourceId: 'N1', department: 'strength_conditioning', text: 'Team lift completed on schedule. Nothing to flag.' }),
        note({ sourceId: 'N2', department: 'nutrition', text: 'Hydration checks logged. Everything inside the usual range.' }),
      ],
    })) as { possibleDisagreements: unknown[] };
    expect(out.possibleDisagreements).toHaveLength(0);
  });

  it('produces the same output twice for the same input', async () => {
    const request = {
      huddleDate: '2026-06-11',
      audienceLabel: 'performance audience',
      notes: [
        note({ sourceId: 'N1', department: 'coaching', text: 'Add extra conditioning after each game.' }),
        note({ sourceId: 'N2', department: 'sports_science', text: 'Reduce his running volume this week.' }),
      ],
    };
    expect(JSON.stringify(await provider.analyze(request))).toBe(JSON.stringify(await provider.analyze(request)));
  });
});

describe('the seeded week produces the expected brief', () => {
  it('populates all five sections for the performance group', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const res = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    const bySection = (s: string) => res.body.items.filter((i: { section: string }) => i.section === s);

    expect(bySection('scheduleConflicts')).toHaveLength(1);
    expect(bySection('scheduleConflicts')[0].title).toContain('Tobias Wren');
    expect(bySection('possibleDisagreements')).toHaveLength(1);
    expect(bySection('possibleDisagreements')[0].sourceUpdateIds.sort()).toEqual(['U011', 'U012']);
    expect(bySection('outdatedInformation')).toHaveLength(1);
    expect(bySection('actionsMissingOwner')).toHaveLength(1);
    expect(bySection('whatChanged').length).toBeGreaterThan(0);

    // Every item, in every section, links to at least one source.
    for (const item of res.body.items) {
      expect(item.sourceUpdateIds.length, item.title).toBeGreaterThan(0);
    }
  });

  it('flags nothing but the routine on the restricted medical audience', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const res = await vega.post('/api/briefs').send({ audienceId: 'aud-medical' });
    const outdated = res.body.items.filter((i: { section: string }) => i.section === 'outdatedInformation');
    expect(outdated).toHaveLength(1);
    expect(outdated[0].sourceUpdateIds).toEqual(['U005']);
    expect(outdated[0].flags).toContain('sensitive_source');
    expect(res.body.items.filter((i: { section: string }) => i.section === 'scheduleConflicts')).toHaveLength(0);
  });
});
