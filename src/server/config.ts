import crypto from 'node:crypto';

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  appIdUri: string;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  sessionSecret: string;
  /** Demo identity switching. Refused outright in production. */
  demoIdentity: boolean;
  aiProvider: 'mock' | 'azure';
  azure: AzureConfig | null;
  teamsSso: boolean;
  entra: EntraConfig | null;
  /** Serve the built web client from this process. */
  serveStatic: boolean;
}

export class ConfigError extends Error {}

function requireEnv(env: NodeJS.ProcessEnv, keys: string[], because: string): string[] {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new ConfigError(`${because} Missing environment variables: ${missing.join(', ')}.`);
  }
  return keys.map((k) => env[k] as string);
}

/**
 * Reads configuration and refuses to start on an unsafe combination.
 * Nothing here falls back silently: an AI provider or SSO mode that is asked
 * for but not configured is a startup failure, not a downgrade.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnv = env.NODE_ENV ?? 'development';
  const appEnv: AppConfig['env'] =
    rawEnv === 'production' ? 'production' : rawEnv === 'test' ? 'test' : 'development';
  const isProd = appEnv === 'production';

  const demoRequested = (env.DEMO_IDENTITY ?? (isProd ? 'disabled' : 'enabled')) === 'enabled';
  if (isProd && demoRequested) {
    throw new ConfigError(
      'DEMO_IDENTITY=enabled is refused when NODE_ENV=production. Demo identity switching must never run against real tenant data.',
    );
  }

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    if (isProd) {
      throw new ConfigError('SESSION_SECRET is required when NODE_ENV=production.');
    }
    // Per-process secret for local runs. Restarting the server ends every session.
    sessionSecret = crypto.randomBytes(32).toString('hex');
  }
  if (sessionSecret.length < 32 && isProd) {
    throw new ConfigError('SESSION_SECRET must be at least 32 characters.');
  }

  const providerRaw = env.AI_PROVIDER ?? 'mock';
  if (providerRaw !== 'mock' && providerRaw !== 'azure') {
    throw new ConfigError(`AI_PROVIDER must be "mock" or "azure". Received "${providerRaw}".`);
  }

  let azure: AzureConfig | null = null;
  if (providerRaw === 'azure') {
    const [endpoint, apiKey, deployment] = requireEnv(
      env,
      ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT'],
      'AI_PROVIDER=azure was requested but the adapter is not configured. The server will not fall back to the mock provider.',
    ) as [string, string, string];
    azure = {
      endpoint: endpoint.replace(/\/+$/, ''),
      apiKey,
      deployment,
      apiVersion: env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
    };
  }

  const teamsSso = (env.TEAMS_SSO ?? 'disabled') === 'enabled';
  let entra: EntraConfig | null = null;
  if (teamsSso) {
    const [tenantId, clientId, appIdUri] = requireEnv(
      env,
      ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_APP_ID_URI'],
      'TEAMS_SSO=enabled was requested but Entra ID is not configured.',
    ) as [string, string, string];
    entra = { tenantId, clientId, appIdUri };
  }

  if (isProd && !teamsSso) {
    throw new ConfigError(
      'NODE_ENV=production requires TEAMS_SSO=enabled. There is no other way for this server to identify a user in production.',
    );
  }

  return {
    env: appEnv,
    port: Number(env.PORT ?? 4000),
    sessionSecret,
    demoIdentity: demoRequested,
    aiProvider: providerRaw,
    azure,
    teamsSso,
    entra,
    serveStatic: (env.SERVE_STATIC ?? 'enabled') === 'enabled',
  };
}
