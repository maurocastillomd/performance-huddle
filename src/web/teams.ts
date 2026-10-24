/**
 * Teams host bootstrap.
 *
 * SCAFFOLDING, NOT A VERIFIED INTEGRATION. Running standalone in a browser is
 * the supported path today: initialize() rejects outside a Teams host and the
 * application carries on. Nothing here requests a user's message history,
 * private chats, or any medical record; the only Teams capability used is the
 * host context and, when configured, an SSO token for this application's own
 * API. See docs/TEAMS-INTEGRATION.md.
 */
export interface TeamsBootstrap {
  inTeams: boolean;
  theme: string | null;
  /** Present only when the tenant has completed the Entra registration. */
  token: string | null;
}

export async function initTeams(requestToken = false): Promise<TeamsBootstrap> {
  try {
    const teams = await import('@microsoft/teams-js');
    await teams.app.initialize();
    const context = await teams.app.getContext();
    let token: string | null = null;
    if (requestToken) {
      try {
        token = await teams.authentication.getAuthToken();
      } catch {
        token = null;
      }
    }
    return { inTeams: true, theme: context.app.theme ?? null, token };
  } catch {
    return { inTeams: false, theme: null, token: null };
  }
}
