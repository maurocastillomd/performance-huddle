import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessDenied } from './auth/authorize.js';
import { ConfigError } from './config.js';
import { briefsRouter } from './routes/briefs.js';
import type { ApiContext } from './routes/context.js';
import { decisionsRouter } from './routes/decisions.js';
import { directoryRouter } from './routes/directory.js';
import { insightsRouter } from './routes/insights.js';
import { sessionRouter } from './routes/session.js';
import { updatesRouter } from './routes/updates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, '..', '..');
const WEB_DIST = path.join(PROJECT_ROOT, 'dist', 'web');

/**
 * Hosts that are allowed to frame this application. A Teams tab renders inside
 * an iframe, so the frame-ancestors list is the boundary that keeps the page
 * out of anyone else's site.
 */
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  'teams.microsoft.com',
  '*.teams.microsoft.com',
  '*.skype.com',
  '*.microsoft365.com',
  '*.office.com',
].join(' ');

export function createApp(ctx: ApiContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `frame-ancestors ${TEAMS_FRAME_ANCESTORS}`);
    next();
  });

  // Nothing from the API is cacheable: every response depends on who asked.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: ctx.config.env, aiProvider: ctx.provider.kind });
  });

  app.use('/api', sessionRouter(ctx));
  app.use('/api', directoryRouter(ctx));
  app.use('/api', updatesRouter(ctx));
  app.use('/api', briefsRouter(ctx));
  app.use('/api', decisionsRouter(ctx));
  app.use('/api', insightsRouter(ctx));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
  });

  if (ctx.config.serveStatic && fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false }));
    // Client-side routing fallback. Registered with `use` rather than a `'*'`
    // path so it does not depend on the router's wildcard syntax.
    app.use((_req, res) => {
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AccessDenied) {
      ctx.logger.info('access.deny', {
        path: req.path,
        code: err.code,
        userId: res.locals.user?.id,
      });
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof ConfigError) {
      res.status(500).json({ error: 'misconfigured', message: err.message });
      return;
    }
    // The message of an unexpected error is not returned: it can carry content.
    ctx.logger.warn('request.error', { path: req.path, name: (err as Error)?.name ?? 'Error' });
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Nothing was changed.' });
  });

  return app;
}
