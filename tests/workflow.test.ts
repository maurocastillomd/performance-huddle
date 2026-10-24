import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers.js';

describe('the daily workflow, end to end', () => {
  it('runs submit → build → review → approve → decide → assign', async () => {
    const h = createHarness();

    // 1. Two departments submit updates that book the same athlete at the same time.
    const okafor = await h.signIn('u-okafor');
    const lift = await okafor.post('/api/updates').send({
      athleteId: 'a-04',
      department: 'strength_conditioning',
      body: 'Bassett is in for his lower-body lift this afternoon.',
      audienceId: 'aud-performance',
      reviewDate: '2026-06-18',
      plannedBlock: { date: '2026-06-11', start: '13:00', end: '14:00', label: 'Lower-body lift' },
    });
    expect(lift.status).toBe(201);

    const boone = await h.signIn('u-boone');
    const hitting = await boone.post('/api/updates').send({
      athleteId: 'a-04',
      department: 'coaching',
      body: 'Bassett takes early hitting this afternoon in cage one.',
      audienceId: 'aud-performance',
      reviewDate: '2026-06-18',
      plannedBlock: { date: '2026-06-11', start: '13:30', end: '14:30', label: 'Hitting, cage 1' },
    });
    expect(hitting.status).toBe(201);

    // 2. The reviewer builds the brief and the clash is surfaced with its sources.
    const vega = await h.signIn('u-vega');
    const brief = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    expect(brief.status).toBe(201);
    const clash = brief.body.items.find(
      (i: { section: string; sourceUpdateIds: string[] }) =>
        i.section === 'scheduleConflicts' && i.sourceUpdateIds.includes(lift.body.id),
    );
    expect(clash).toBeTruthy();
    expect(clash.title).toContain('30 minutes');
    expect(clash.sourceUpdateIds).toContain(hitting.body.id);

    // 3. The reviewer reads the sources, edits one item, dismisses another, confirms the rest.
    const source = await vega.get(`/api/updates/${lift.body.id}`);
    expect(source.status).toBe(200);
    expect(source.body.body).toContain('lower-body lift');

    const edited = await vega
      .post(`/api/briefs/${brief.body.id}/items/${clash.id}/review`)
      .send({ action: 'edit', note: 'Lift moves to 11:00. Confirmed with both staff in the room.' });
    expect(edited.status).toBe(200);
    const editedItem = edited.body.items.find((i: { id: string }) => i.id === clash.id);
    expect(editedItem.reviewState).toBe('edited');
    expect(editedItem.detail).toContain('Lift moves to 11:00');
    expect(editedItem.reviewedBy).toBe('u-vega');

    const others = brief.body.items.filter((i: { id: string }) => i.id !== clash.id);
    await vega.post(`/api/briefs/${brief.body.id}/items/${others[0].id}/review`).send({ action: 'dismiss', note: 'Routine.' });
    for (const item of others.slice(1)) {
      await vega.post(`/api/briefs/${brief.body.id}/items/${item.id}/review`).send({ action: 'confirm' });
    }

    // 4. Approve.
    const approved = await vega.post(`/api/briefs/${brief.body.id}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedBy).toBe('u-vega');

    // 5. Record the decision with an owner and a review date.
    const decision = await vega.post('/api/decisions').send({
      audienceId: 'aud-performance',
      athleteId: 'a-04',
      action: 'Bassett lifts at 11:00 so hitting keeps the 13:30 slot',
      ownerId: 'u-okafor',
      rationale: 'Two departments booked the same hour. The lift moves.',
      dueDate: '2026-06-12',
      reviewDate: '2026-06-18',
      sourceUpdateIds: [lift.body.id, hitting.body.id],
      briefId: brief.body.id,
    });
    expect(decision.status).toBe(201);
    expect(decision.body.ownerId).toBe('u-okafor');
    expect(decision.body.sourceUpdateIds).toEqual([lift.body.id, hitting.body.id]);

    // 6. The export reads as the approved brief, minus what was dismissed.
    const exported = await vega.get(`/api/briefs/${brief.body.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('Lift moves to 11:00');
    expect(exported.text).toContain('Synthetic demonstration data');
  });

  it('assigns an owner to a decision that had none, and clears it from the next brief', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');

    const before = await vega.post('/api/briefs').send({ audienceId: 'aud-ops' });
    const unowned = before.body.items.filter((i: { section: string }) => i.section === 'actionsMissingOwner');
    expect(unowned.length).toBeGreaterThan(0);

    const patched = await vega.patch('/api/decisions/D002').send({ ownerId: 'u-boone' });
    expect(patched.status).toBe(200);
    expect(patched.body.ownerId).toBe('u-boone');

    const after = await vega.post('/api/briefs').send({ audienceId: 'aud-ops' });
    const stillUnowned = after.body.items.filter((i: { section: string }) => i.section === 'actionsMissingOwner');
    expect(stillUnowned.length).toBe(unowned.length - 1);
  });

  it('supersedes a decision and keeps the earlier one on the record', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const replacement = await vega.post('/api/decisions').send({
      audienceId: 'aud-ops',
      action: 'Takahashi stays home for the weekend set',
      ownerId: 'u-boone',
      rationale: 'Plan changed after the Thursday game.',
      supersedesDecisionId: 'D002',
      sourceUpdateIds: ['U010'],
    });
    expect(replacement.status).toBe(201);
    expect(replacement.body.supersedesDecisionId).toBe('D002');

    const all = await vega.get('/api/decisions');
    const old = all.body.find((d: { id: string }) => d.id === 'D002');
    expect(old.status).toBe('superseded');
    expect(old.supersededByDecisionId).toBe(replacement.body.id);

    const refuse = await vega.patch('/api/decisions/D002').send({ ownerId: 'u-vega' });
    expect(refuse.status).toBe(409);
  });

  it('records a revision without losing the earlier text', async () => {
    const h = createHarness();
    const boone = await h.signIn('u-boone');
    const created = await boone.post('/api/updates').send({
      athleteId: 'a-02',
      department: 'coaching',
      body: 'Wren hits at two o’clock.',
      audienceId: 'aud-performance',
      reviewDate: '2026-06-18',
    });
    const revised = await boone
      .post(`/api/updates/${created.body.id}/revisions`)
      .send({ body: 'Wren hits at three o’clock.', note: 'Time changed after the pitchers’ meeting.' });
    expect(revised.status).toBe(200);
    expect(revised.body.revisions).toHaveLength(1);
    expect(revised.body.revisions[0].previousBody).toContain('two o’clock');
    expect(revised.body.revisions[0].revisedBy).toBe('u-boone');

    // Someone else in the audience cannot rewrite it.
    const okafor = await h.signIn('u-okafor');
    const denied = await okafor
      .post(`/api/updates/${created.body.id}/revisions`)
      .send({ body: 'Rewritten by someone else.', note: 'Should not be allowed.' });
    expect(denied.status).toBe(403);
  });

  it('notifies only within the audiences a reader belongs to', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    await vega.post('/api/briefs').send({ audienceId: 'aud-medical' });

    const mine = await vega.get('/api/notifications');
    expect(mine.body.some((n: { audienceId: string }) => n.audienceId === 'aud-medical')).toBe(true);

    const okafor = await h.signIn('u-okafor');
    const theirs = await okafor.get('/api/notifications');
    expect(theirs.body.every((n: { audienceId: string }) => n.audienceId !== 'aud-medical')).toBe(true);
  });

  it('rejects an update whose planned block ends before it starts', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    const res = await okafor.post('/api/updates').send({
      athleteId: 'a-02',
      department: 'strength_conditioning',
      body: 'Backwards block.',
      audienceId: 'aud-performance',
      reviewDate: '2026-06-18',
      plannedBlock: { date: '2026-06-11', start: '15:00', end: '14:00', label: 'Impossible' },
    });
    expect(res.status).toBe(400);
  });
});
