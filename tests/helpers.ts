import express from 'express';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { createIdentityResolver } from '../src/server/auth/identity.js';
import { fixedClock } from '../src/server/clock.js';
import { loadConfig } from '../src/server/config.js';
import { loadSeed } from '../src/server/data/seed.js';
import { Store } from '../src/server/data/store.js';
import { createLogger, type Logger } from '../src/server/log/logger.js';
import { MockAiProvider } from '../src/server/ai/mock.js';
import type { AiProvider } from '../src/server/ai/contract.js';
import type { ApiContext } from '../src/server/routes/context.js';

/** A fixed instant so review dates, overlaps, and "what changed" are stable. */
export const ANCHOR_DATE = '2026-06-11';
export const ANCHOR = new Date('2026-06-11T18:00:00Z');

export interface Harness {
  app: express.Express;
  ctx: ApiContext;
  store: Store;
  logLines: string[];
  agent(): request.Agent;
  signIn(userId: string): Promise<request.Agent>;
}

export function createHarness(options: { provider?: AiProvider; env?: NodeJS.ProcessEnv } = {}): Harness {
  const config = loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-01',
    DEMO_IDENTITY: 'enabled',
    SERVE_STATIC: 'disabled',
    ...options.env,
  });
  const clock = fixedClock(ANCHOR);
  const store = new Store(loadSeed(ANCHOR_DATE));
  const logLines: string[] = [];
  const logger: Logger = createLogger((line) => logLines.push(line));
  const provider = options.provider ?? new MockAiProvider();
  const identity = createIdentityResolver(store, config);
  const ctx: ApiContext = { store, config, clock, provider, identity, logger };
  const app = createApp(ctx);

  return {
    app,
    ctx,
    store,
    logLines,
    agent: () => request.agent(app),
    async signIn(userId: string) {
      const agent = request.agent(app);
      const res = await agent.post('/api/session').send({ userId });
      if (res.status !== 200) throw new Error(`sign-in failed for ${userId}: ${res.status}`);
      return agent;
    },
  };
}

/** Walks a draft brief to approval: confirms every item, then approves. */
export async function confirmAllAndApprove(
  agent: request.Agent,
  briefId: string,
  itemIds: string[],
): Promise<request.Response> {
  for (const id of itemIds) {
    await agent.post(`/api/briefs/${briefId}/items/${id}/review`).send({ action: 'confirm' });
  }
  return agent.post(`/api/briefs/${briefId}/approve`).send({});
}
