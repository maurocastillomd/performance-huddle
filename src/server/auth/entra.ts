import crypto from 'node:crypto';
import type { EntraConfig } from '../config.js';

/**
 * Validation of a Microsoft Entra ID access token obtained by the Teams tab
 * through `microsoftTeams.authentication.getAuthToken()`.
 *
 * STATUS: implemented and unit-tested against locally generated keys, but never
 * run against a real Microsoft tenant. Treat it as scaffolding to review, not a
 * verified integration. See docs/TEAMS-INTEGRATION.md for what an organization
 * must configure before it can be trusted.
 *
 * What it checks: RS256 signature against the tenant JWKS, issuer, audience,
 * tenant id, expiry and not-before, and that the token carries the
 * `access_as_user` scope this application exposes.
 */

export interface EntraClaims {
  oid: string;
  tid: string;
  preferred_username?: string;
  name?: string;
  scp?: string;
  aud: string;
  iss: string;
  exp: number;
  nbf?: number;
}

interface Jwk {
  kid: string;
  kty: string;
  n?: string;
  e?: string;
  x5c?: string[];
}

export class TokenInvalid extends Error {}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
}

export interface JwksSource {
  /** Returns the signing keys for the tenant. Cache upstream if you like. */
  keys(): Promise<Jwk[]>;
}

export function httpJwks(tenantId: string, fetchImpl: typeof fetch = fetch): JwksSource {
  let cache: { at: number; keys: Jwk[] } | null = null;
  return {
    async keys(): Promise<Jwk[]> {
      if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.keys;
      const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new TokenInvalid(`JWKS fetch failed with HTTP ${res.status}`);
      const body = (await res.json()) as { keys: Jwk[] };
      cache = { at: Date.now(), keys: body.keys };
      return body.keys;
    },
  };
}

export async function verifyEntraToken(
  token: string,
  config: EntraConfig,
  jwks: JwksSource,
  nowMs: number = Date.now(),
): Promise<EntraClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenInvalid('Token is not a compact JWS.');
  const [headerSeg, payloadSeg, signatureSeg] = parts as [string, string, string];

  const header = decodeSegment(headerSeg) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new TokenInvalid(`Unsupported algorithm ${header.alg ?? 'none'}.`);
  if (!header.kid) throw new TokenInvalid('Token header has no key id.');

  const key = (await jwks.keys()).find((k) => k.kid === header.kid);
  if (!key || !key.n || !key.e) throw new TokenInvalid('No matching signing key in the tenant JWKS.');

  const publicKey = crypto.createPublicKey({
    key: { kty: 'RSA', n: key.n, e: key.e },
    format: 'jwk',
  });

  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerSeg}.${payloadSeg}`),
    publicKey,
    Buffer.from(signatureSeg, 'base64url'),
  );
  if (!verified) throw new TokenInvalid('Signature does not verify.');

  const claims = decodeSegment(payloadSeg) as EntraClaims;

  const expectedIssuers = [
    `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    `https://sts.windows.net/${config.tenantId}/`,
  ];
  if (!expectedIssuers.includes(claims.iss)) throw new TokenInvalid('Unexpected issuer.');
  if (claims.tid !== config.tenantId) throw new TokenInvalid('Token is from a different tenant.');
  if (claims.aud !== config.appIdUri && claims.aud !== config.clientId) {
    throw new TokenInvalid('Token audience is not this application.');
  }
  const nowSec = Math.floor(nowMs / 1000);
  if (claims.exp <= nowSec) throw new TokenInvalid('Token has expired.');
  if (claims.nbf && claims.nbf > nowSec + 60) throw new TokenInvalid('Token is not yet valid.');
  const scopes = (claims.scp ?? '').split(' ').filter(Boolean);
  if (!scopes.includes('access_as_user')) throw new TokenInvalid('Token is missing the access_as_user scope.');
  if (!claims.oid) throw new TokenInvalid('Token has no object id.');

  return claims;
}
