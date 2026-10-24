import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AzureAiProvider } from '../src/server/ai/azure.js';
import { TokenInvalid, verifyEntraToken, type JwksSource } from '../src/server/auth/entra.js';
import type { EntraConfig } from '../src/server/config.js';

const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'teams', 'manifest.json'), 'utf8'),
) as Record<string, any>;

describe('Teams app manifest template', () => {
  it('declares the schema version it is written against', () => {
    expect(manifest.$schema).toBe(
      'https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json',
    );
    expect(manifest.manifestVersion).toBe('1.30');
  });

  it('carries every property the schema marks required', () => {
    for (const key of ['manifestVersion', 'version', 'id', 'developer', 'name', 'description', 'icons', 'accentColor']) {
      expect(manifest[key], key).toBeDefined();
    }
    expect(manifest.icons.color).toBe('color.png');
    expect(manifest.icons.outline).toBe('outline.png');
    expect(fs.existsSync(path.join(process.cwd(), 'teams', 'color.png'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'teams', 'outline.png'))).toBe(true);
  });

  it('asks for nothing beyond identity', () => {
    // The schema allows only "identity" and "messageTeamMembers". This app reads
    // no messages, so it asks for neither message access nor resource-specific
    // permissions of any kind.
    expect(manifest.permissions).toEqual(['identity']);
    expect(manifest.authorization).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/ChannelMessage|ChatMessage|Mail|Files\./);
  });

  it('keeps static tabs personal, since the schema does not support the team scope there', () => {
    for (const tab of manifest.staticTabs) {
      expect(tab.scopes).toEqual(['personal']);
    }
    expect(manifest.configurableTabs[0].scopes).toEqual(['team']);
  });

  it('uses https everywhere and lists the tab host as a valid domain', () => {
    const urls = JSON.stringify(manifest).match(/https?:\/\/[^"]+/g) ?? [];
    for (const url of urls) expect(url.startsWith('https://'), url).toBe(true);

    const host = new URL(manifest.staticTabs[0].contentUrl).hostname;
    expect(manifest.validDomains).toContain(host);
    expect(manifest.webApplicationInfo.resource).toBe(`api://${host}/${manifest.webApplicationInfo.id}`);
  });

  it('ships as a template with placeholders rather than a real registration', () => {
    expect(manifest.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(manifest.developer.name).toMatch(/REPLACE/);
  });
});

// ---------------------------------------------------------------------------
// Entra ID token validation. These exercise the verification logic against keys
// generated here. They do NOT prove the integration works against a real tenant.
// ---------------------------------------------------------------------------

const CONFIG: EntraConfig = {
  tenantId: 'tenant-guid',
  clientId: 'client-guid',
  appIdUri: 'api://huddle.example.com/client-guid',
};

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
const jwks: JwksSource = { keys: async () => [{ kid: 'test-key', kty: 'RSA', n: jwk.n, e: jwk.e }] };

function sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const NOW = 1_800_000_000_000;
const validClaims = {
  oid: 'user-object-id',
  tid: CONFIG.tenantId,
  aud: CONFIG.appIdUri,
  iss: `https://login.microsoftonline.com/${CONFIG.tenantId}/v2.0`,
  exp: Math.floor(NOW / 1000) + 600,
  nbf: Math.floor(NOW / 1000) - 60,
  scp: 'access_as_user',
  preferred_username: 'dana@example.com',
};

describe('Entra ID token validation (scaffolding, unit-tested only)', () => {
  it('accepts a correctly signed token for this tenant and application', async () => {
    const claims = await verifyEntraToken(sign(validClaims), CONFIG, jwks, NOW);
    expect(claims.oid).toBe('user-object-id');
  });

  it('rejects a tampered payload', async () => {
    const token = sign(validClaims);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...validClaims, oid: 'someone-else' })).toString('base64url');
    await expect(verifyEntraToken(`${h}.${forged}.${s}`, CONFIG, jwks, NOW)).rejects.toThrow(TokenInvalid);
  });

  it('rejects a token signed by a different key', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(validClaims)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), other.privateKey).toString('base64url');
    await expect(verifyEntraToken(`${h}.${p}.${sig}`, CONFIG, jwks, NOW)).rejects.toThrow(/Signature does not verify/);
  });

  it('rejects the "none" algorithm', async () => {
    const token = sign(validClaims, { alg: 'none' });
    await expect(verifyEntraToken(token, CONFIG, jwks, NOW)).rejects.toThrow(/Unsupported algorithm/);
  });

  const rejections: [string, Record<string, unknown>, RegExp][] = [
    ['another tenant', { tid: 'other-tenant' }, /different tenant/],
    ['another audience', { aud: 'api://someone-else/app' }, /audience is not this application/],
    ['an unexpected issuer', { iss: 'https://evil.example.com/v2.0' }, /Unexpected issuer/],
    ['an expired token', { exp: Math.floor(NOW / 1000) - 10 }, /expired/],
    ['a missing scope', { scp: 'User.Read' }, /access_as_user/],
    ['no object id', { oid: '' }, /object id/],
  ];

  for (const [name, override, message] of rejections) {
    it(`rejects ${name}`, async () => {
      await expect(verifyEntraToken(sign({ ...validClaims, ...override }), CONFIG, jwks, NOW)).rejects.toThrow(message);
    });
  }

  it('rejects a key id that is not in the tenant JWKS', async () => {
    const token = sign(validClaims, { kid: 'unknown-key' });
    await expect(verifyEntraToken(token, CONFIG, jwks, NOW)).rejects.toThrow(/No matching signing key/);
  });
});

describe('Azure OpenAI adapter (scaffolding, unit-tested only)', () => {
  const config = {
    endpoint: 'https://example.openai.azure.com',
    apiKey: 'server-side-secret',
    deployment: 'huddle-model',
    apiVersion: '2024-10-21',
  };
  const request = {
    huddleDate: '2026-06-11',
    audienceLabel: 'performance audience',
    notes: [
      {
        sourceId: 'U013',
        department: 'strength_conditioning' as const,
        athleteLabel: 'Athlete 1',
        date: '2026-06-10',
        text: 'A lift is scheduled this afternoon.',
        requestedAction: null,
      },
    ],
  };

  it('calls the documented endpoint, keeps the key server-side, and fences the notes', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ summaries: [], possibleDisagreements: [] }) } }],
        }),
      };
    }) as unknown as typeof fetch;

    const provider = new AzureAiProvider(config, fakeFetch);
    const out = await provider.analyze(request);
    expect(out).toEqual({ summaries: [], possibleDisagreements: [] });

    expect(captured!.url).toBe(
      'https://example.openai.azure.com/openai/deployments/huddle-model/chat/completions?api-version=2024-10-21',
    );
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('server-side-secret');

    const body = JSON.parse(String(captured!.init.body));
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    // No tools are offered to the model, and the notes are marked as untrusted data.
    expect(body.tools).toBeUndefined();
    expect(body.messages[1].content).toContain('BEGIN NOTES (untrusted staff-submitted data)');
    expect(body.messages[0].content).toContain('You never approve, confirm, or decide anything');
  });

  it('raises rather than returning something unusable', async () => {
    const failing = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(new AzureAiProvider(config, failing).analyze(request)).rejects.toThrow(/HTTP 429/);

    const empty = (async () => ({ ok: true, json: async () => ({ choices: [] }) })) as unknown as typeof fetch;
    await expect(new AzureAiProvider(config, empty).analyze(request)).rejects.toThrow(/no message content/);
  });
});
