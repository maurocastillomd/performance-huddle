import crypto from 'node:crypto';

/**
 * The session cookie carries a user id and nothing else. Organization,
 * audiences, and permissions are read from the staff directory on every
 * request, so a revoked membership is denied on the very next call.
 */
export const SESSION_COOKIE = 'ph_session';

interface SessionPayload {
  uid: string;
  iat: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signSession(userId: string, secret: string, issuedAt = Date.now()): string {
  const payload = b64url(JSON.stringify({ uid: userId, iat: issuedAt } satisfies SessionPayload));
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifySession(token: string | undefined, secret: string, maxAgeMs = 12 * 60 * 60 * 1000): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof parsed.uid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (Date.now() - parsed.iat > maxAgeMs) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}
