import { createAiProvider } from './ai/index.js';
import { createApp } from './app.js';
import { createIdentityResolver } from './auth/identity.js';
import { isoDate, systemClock } from './clock.js';
import { ConfigError, loadConfig } from './config.js';
import { loadSeed } from './data/seed.js';
import { Store } from './data/store.js';
import { createLogger } from './log/logger.js';
import type { ApiContext } from './routes/context.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\nRefusing to start.\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const clock = systemClock();
  // The synthetic dataset is rebuilt relative to today on every start.
  const store = new Store(loadSeed(isoDate(clock.now())));
  const logger = createLogger();
  const provider = createAiProvider(config);
  const identity = createIdentityResolver(store, config);

  const ctx: ApiContext = { store, config, clock, provider, identity, logger };
  const app = createApp(ctx);

  app.listen(config.port, () => {
    logger.info('server.start', {
      port: config.port,
      env: config.env,
      aiProvider: provider.kind,
      demoIdentity: config.demoIdentity,
      teamsSso: config.teamsSso,
    });
    console.log(`\n  Performance Huddle — http://localhost:${config.port}`);
    console.log(`  AI provider: ${provider.label}`);
    console.log(`  Demo identity: ${config.demoIdentity ? 'enabled' : 'disabled'}`);
    console.log('  Synthetic data only.\n');
  });
}

main();
