import { describe, expect, it } from 'vitest';
import { confirmAllAndApprove, createHarness } from './helpers.js';

describe('organization isolation', () => {
  it('hides another club’s updates entirely', async () => {
    const h = createHarness();
    const hale = await h.signIn('u-hale');

    const list = await hale.get('/api/updates');
    expect(list.body.map((u: { id: string }) => u.id)).toEqual(['U901']);

    const direct = await hale.get('/api/updates/U001');
    expect(direct.status).toBe(404);
    expect(direct.body.message).not.toContain('Lindberg');
  });

  it('refuses to build a brief for an audience in another organization', async () => {
    const h = createHarness();
    const hale = await h.signIn('u-hale');
    const res = await hale.post('/api/briefs').send({ audienceId: 'aud-performance' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('audience_not_found');
  });

  it('refuses to name an owner from another organization', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const res = await vega.post('/api/decisions').send({
      audienceId: 'aud-performance',
      action: 'Something',
      rationale: 'Because',
      ownerId: 'u-hale',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('owner_not_found');
  });
});

describe('audience membership on every read', () => {
  it('does not return a restricted record to a member of a wider audience', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');

    const direct = await okafor.get('/api/updates/U005');
    expect(direct.status).toBe(404);

    const list = await okafor.get('/api/updates');
    const ids = list.body.map((u: { id: string }) => u.id);
    expect(ids).not.toContain('U005');
    expect(ids).not.toContain('U016');
    expect(ids).toContain('U013');
  });

  it('keeps restricted records out of search results', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    const res = await okafor.get('/api/search?q=participation');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);

    const vega = await h.signIn('u-vega');
    const asReviewer = await vega.get('/api/search?q=participation');
    expect(asReviewer.body.results.map((u: { id: string }) => u.id).sort()).toEqual(['U005', 'U016']);
  });

  it('never lets a brief cite a source from a different audience', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const res = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    expect(res.status).toBe(201);
    expect(res.body.sourceUpdateIds).not.toContain('U005');
    expect(res.body.sourceUpdateIds).not.toContain('U016');
    for (const item of res.body.items) {
      for (const sourceId of item.sourceUpdateIds) {
        const source = h.store.getUpdateUnchecked(sourceId);
        expect(source?.audienceId).toBe('aud-performance');
      }
    }
  });

  it('refuses to widen a decision to sources outside its audience', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    // Dana Vega can read U005. That does not authorize repeating it to the wider group.
    const res = await vega.post('/api/decisions').send({
      audienceId: 'aud-performance',
      action: 'Carry the medical note into the performance group',
      rationale: 'Attempting to widen a restricted source.',
      sourceUpdateIds: ['U005', 'U013'],
    });
    expect(res.status).toBe(201);
    expect(res.body.sourceUpdateIds).toEqual(['U013']);
  });
});

describe('exports carry the audience boundary', () => {
  it('lets an audience member export and refuses everyone else', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const created = await vega.post('/api/briefs').send({ audienceId: 'aud-medical' });
    const briefId = created.body.id;
    await confirmAllAndApprove(vega, briefId, created.body.items.map((i: { id: string }) => i.id));

    const mine = await vega.get(`/api/briefs/${briefId}/export`);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-disposition']).toContain('attachment');

    const okafor = await h.signIn('u-okafor');
    const theirs = await okafor.get(`/api/briefs/${briefId}/export`);
    expect(theirs.status).toBe(404);

    const anonymous = h.agent();
    const noSession = await anonymous.get(`/api/briefs/${briefId}/export`);
    expect(noSession.status).toBe(401);
  });
});

describe('submission and approval are separate permissions', () => {
  it('lets a submitter write but not build, review, or approve a brief', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');

    const submitted = await okafor.post('/api/updates').send({
      athleteId: 'a-02',
      department: 'strength_conditioning',
      body: 'Wren cleared the warm-up circuit without issue.',
      audienceId: 'aud-performance',
      reviewDate: '2026-06-20',
    });
    expect(submitted.status).toBe(201);

    const generate = await okafor.post('/api/briefs').send({ audienceId: 'aud-performance' });
    expect(generate.status).toBe(403);
    expect(generate.body.error).toBe('approval_required');

    const vega = await h.signIn('u-vega');
    const brief = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    const itemId = brief.body.items[0].id;

    const review = await okafor
      .post(`/api/briefs/${brief.body.id}/items/${itemId}/review`)
      .send({ action: 'confirm' });
    expect(review.status).toBe(403);

    const approve = await okafor.post(`/api/briefs/${brief.body.id}/approve`).send({});
    expect(approve.status).toBe(403);
  });

  it('refuses a submission from an account with no submit permission', async () => {
    const h = createHarness();
    const ellis = await h.signIn('u-ellis');
    const res = await ellis.post('/api/updates').send({
      athleteId: 'a-02',
      department: 'coaching',
      body: 'Trying to submit without permission.',
      audienceId: 'aud-ops',
      reviewDate: '2026-06-20',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('submit_denied');
  });

  it('refuses a submission to an audience the author does not belong to', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    const res = await okafor.post('/api/updates').send({
      athleteId: 'a-01',
      department: 'strength_conditioning',
      body: 'Attempting to post into the restricted audience.',
      audienceId: 'aud-medical',
      reviewDate: '2026-06-20',
    });
    expect(res.status).toBe(403);
  });

  it('ignores a role asserted by the client', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    const res = await okafor
      .post('/api/briefs')
      .set('x-role', 'approver')
      .set('x-permissions', 'submit,approve')
      .set('x-org-id', 'org-harbor')
      .send({ audienceId: 'aud-performance', permissions: ['approve'], orgId: 'org-harbor' });
    expect(res.status).toBe(403);
  });
});

describe('revoked access and withdrawn sources', () => {
  it('denies a brief on the next request after membership is revoked', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const created = await vega.post('/api/briefs').send({ audienceId: 'aud-medical' });
    const briefId = created.body.id;

    expect((await vega.get(`/api/briefs/${briefId}`)).status).toBe(200);

    h.store.revokeAudience('u-vega', 'aud-medical');

    expect((await vega.get(`/api/briefs/${briefId}`)).status).toBe(404);
    expect((await vega.get('/api/updates/U005')).status).toBe(404);
    const list = await vega.get('/api/briefs');
    expect(list.body.map((b: { id: string }) => b.id)).not.toContain(briefId);
  });

  it('denies everything on the next request after an account is disabled', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    expect((await okafor.get('/api/session')).status).toBe(200);
    h.store.setUserDisabled('u-okafor', true);
    expect((await okafor.get('/api/session')).status).toBe(401);
  });

  it('invalidates every brief that cited a withdrawn source', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const created = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    const briefId = created.body.id;
    await confirmAllAndApprove(vega, briefId, created.body.items.map((i: { id: string }) => i.id));
    expect((await vega.get(`/api/briefs/${briefId}/export`)).status).toBe(200);

    const withdrawn = await vega.post('/api/updates/U013/withdraw').send({});
    expect(withdrawn.body.invalidatedBriefIds).toContain(briefId);

    const after = await vega.get(`/api/briefs/${briefId}`);
    expect(after.body.status).toBe('invalidated');
    const exportAfter = await vega.get(`/api/briefs/${briefId}/export`);
    expect(exportAfter.status).toBe(409);
  });

  it('invalidates a brief when a source is moved to a different audience', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const created = await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    const briefId = created.body.id;

    await vega.post('/api/updates/U013/audience').send({ audienceId: 'aud-medical' });

    const after = await vega.get(`/api/briefs/${briefId}`);
    expect(after.body.status).toBe('invalidated');

    // And the source is now out of reach for the wider group.
    const okafor = await h.signIn('u-okafor');
    expect((await okafor.get('/api/updates/U013')).status).toBe(404);
  });
});

describe('unauthenticated access', () => {
  it('rejects every data endpoint without a session', async () => {
    const h = createHarness();
    const anon = h.agent();
    for (const path of ['/api/updates', '/api/briefs', '/api/decisions', '/api/search?q=lift', '/api/audit']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects a forged session cookie', async () => {
    const h = createHarness();
    const anon = h.agent();
    const res = await anon.get('/api/session').set('Cookie', 'ph_session=eyJ1aWQiOiJ1LXZlZ2EifQ.forged');
    expect(res.status).toBe(401);
  });
});
