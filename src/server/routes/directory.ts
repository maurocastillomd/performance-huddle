import { Router } from 'express';
import { asyncRoute, currentUser, requireUser, type ApiContext } from './context.js';

/** Roster and staff lists, always scoped to the caller's own organization. */
export function directoryRouter(ctx: ApiContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.get(
    '/athletes',
    asyncRoute((_req, res) => {
      res.json(ctx.store.athletesFor(currentUser(res)));
    }),
  );

  router.get(
    '/staff',
    asyncRoute((_req, res) => {
      const user = currentUser(res);
      res.json(
        ctx.store.listUsers(user.orgId).map((u) => ({
          id: u.id,
          name: u.name,
          title: u.title,
          department: u.department,
        })),
      );
    }),
  );

  router.get(
    '/audiences',
    asyncRoute((_req, res) => {
      res.json(ctx.store.audiencesFor(currentUser(res)));
    }),
  );

  return router;
}
