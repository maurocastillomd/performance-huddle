import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/server/config.js';
import { redactFields } from '../src/server/log/logger.js';
import { createHarness } from './helpers.js';

const PROD_BASE = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a'.repeat(48),
  TEAMS_SSO: 'enabled',
  ENTRA_TENANT_ID: 'tenant',
  ENTRA_CLIENT_ID: 'client',
  ENTRA_APP_ID_URI: 'api://huddle.example.com/client',
};

describe('configuration refuses unsafe combinations', () => {
  it('will not start with demo identity in production', () => {
    expect(() => loadConfig({ ...PROD_BASE, DEMO_IDENTITY: 'enabled' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...PROD_BASE, DEMO_IDENTITY: 'enabled' })).toThrow(/refused when NODE_ENV=production/);
  });

  it('defaults demo identity off in production and on in development', () => {
    expect(loadConfig(PROD_BASE).demoIdentity).toBe(false);
    expect(loadConfig({ NODE_ENV: 'development' }).demoIdentity).toBe(true);
  });

  it('requires a session secret in production', () => {
    const { SESSION_SECRET, ...withoutSecret } = PROD_BASE;
    expect(() => loadConfig(withoutSecret)).toThrow(/SESSION_SECRET is required/);
  });

  it('requires Teams SSO in production, since nothing else can identify a user', () => {
    const env = { ...PROD_BASE, TEAMS_SSO: 'disabled' };
    expect(() => loadConfig(env)).toThrow(/requires TEAMS_SSO=enabled/);
  });

  it('will not start with Teams SSO half-configured', () => {
    const { ENTRA_CLIENT_ID, ...partial } = PROD_BASE;
    expect(() => loadConfig(partial)).toThrow(/ENTRA_CLIENT_ID/);
  });

  it('will not fall back to the mock provider when Azure is asked for and not configured', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'azure' })).toThrow(/will not fall back to the mock provider/);
    expect(() => loadConfig({ AI_PROVIDER: 'anthropic' })).toThrow(/must be "mock" or "azure"/);
  });

  it('accepts a fully configured Azure adapter', () => {
    const config = loadConfig({
      AI_PROVIDER: 'azure',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_API_KEY: 'secret',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
    });
    expect(config.aiProvider).toBe('azure');
    expect(config.azure?.endpoint).toBe('https://example.openai.azure.com');
  });
});

describe('demo identity is unreachable when disabled', () => {
  it('returns no staff information and refuses the switch endpoint', async () => {
    const h = createHarness({
      env: {
        NODE_ENV: 'test',
        DEMO_IDENTITY: 'disabled',
        SESSION_SECRET: 'test-secret-test-secret-test-secret-01',
        SERVE_STATIC: 'disabled',
      },
    });
    const anon = h.agent();

    const config = await anon.get('/api/config');
    expect(config.body.demoMode).toBe(false);
    expect(config.body.demoUsers).toEqual([]);

    const attempt = await anon.post('/api/session').send({ userId: 'u-vega' });
    expect(attempt.status).toBe(404);
    expect(attempt.body.error).toBe('demo_identity_disabled');

    expect((await anon.get('/api/updates')).status).toBe(401);
  });
});

describe('logging and audit records', () => {
  it('keeps note text and athlete names out of routine logs', async () => {
    const h = createHarness();
    const boone = await h.signIn('u-boone');
    const secret = 'Petrakis had a difficult conversation about his contract on the bus';
    await boone.post('/api/updates').send({
      athleteId: 'a-12',
      department: 'coaching',
      body: secret,
      audienceId: 'aud-performance',
      reviewDate: '2026-06-18',
    });

    const vega = await h.signIn('u-vega');
    await vega.post('/api/briefs').send({ audienceId: 'aud-performance' });
    await vega.get('/api/search?q=contract');

    const log = h.logLines.join('\n');
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(secret);
    expect(log).not.toContain('contract');
    expect(log).not.toContain('Petrakis');
    expect(log).toContain('updates.create');
  });

  it('keeps note text out of the audit trail', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    await vega.get('/api/updates/U017');
    const audit = await vega.get('/api/audit');
    expect(audit.status).toBe(200);
    const text = JSON.stringify(audit.body);
    expect(text).not.toContain('Carrington');
    expect(text).not.toContain('Ignore all previous instructions');
    expect(text).toContain('update.read');
  });

  it('restricts the audit trail to approvers and to one organization', async () => {
    const h = createHarness();
    const okafor = await h.signIn('u-okafor');
    expect((await okafor.get('/api/audit')).status).toBe(403);

    const vega = await h.signIn('u-vega');
    const hale = await h.signIn('u-hale');
    await hale.get('/api/session');
    const audit = await vega.get('/api/audit');
    expect(audit.body.every((r: { orgId: string }) => r.orgId === 'org-riverbend')).toBe(true);
  });

  it('replaces a log value that does not look like an identifier', () => {
    expect(redactFields({ note: 'Wren felt tightness after the lift' }).note).toBe('[redacted]');
    expect(redactFields({ updateId: 'U013', count: 4, ok: true })).toEqual({ updateId: 'U013', count: 4, ok: true });
  });
});

describe('transport headers', () => {
  it('sets a frame-ancestors policy and never caches API responses', async () => {
    const h = createHarness();
    const vega = await h.signIn('u-vega');
    const res = await vega.get('/api/session');
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers['content-security-policy']).toContain('teams.microsoft.com');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
