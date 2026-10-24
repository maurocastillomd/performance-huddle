# Microsoft Teams integration

**Status: scaffolding.** The manifest, the Teams JavaScript bootstrap, and the Entra ID token validation
are written against current Microsoft documentation and covered by unit tests. **None of it has been run
against a Microsoft tenant.** Nothing here should be installed into a real tenant without authorization
from whoever owns it.

Verified while writing this (September 2026):

- The current app manifest schema is **v1.30**. `v1.31` does not resolve.
- `authorization.permissions.resourceSpecific` is a **top-level** manifest property in v1.30, not nested
  inside `webApplicationInfo`. This application declares no `authorization` block at all.
- `permissions` accepts at most two values, from `identity` and `messageTeamMembers`. This application
  asks for `identity` only.
- `staticTabs` does not support the `team` scope, so the personal tab is static and the channel tab is
  configurable.

Sources: [App manifest schema](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema) ·
[SSO in tabs](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview) ·
[Register the tab with Entra ID](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad) ·
[Update the manifest for SSO](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-manifest)

## What the app asks Teams for, and what it does not

| | |
|---|---|
| **Asks for** | `identity`. The signed-in user's identity, so the server can match them to a staff record. |
| **Does not ask for** | Message history. Private chats. Channel messages. Mail. Files. Calendars. Medical records of any kind. No resource-specific permissions are declared. |

Staff put information into this application by submitting an update. There is no reading of anything they
did not choose to send. That is a deliberate limit, not an omission.

## Tenant configuration

### 1. Host the application

An HTTPS endpoint the organization controls. The hostname appears in four places and they must agree:
`staticTabs[].contentUrl`, `configurableTabs[].configurationUrl`, `validDomains`, and
`webApplicationInfo.resource`.

### 2. Register the application in Microsoft Entra ID

1. **App registrations → New registration.** Single tenant for a club. No redirect URI is needed for tab
   SSO.
2. Note the **Application (client) ID**.
3. **Manage → Manifest**: set `requestedAccessTokenVersion` to `2`.
4. **Expose an API → Application ID URI**, in the form `api://{your-domain}/{client-id}`. The domain must
   match the domain serving the tab.
5. **Add a scope** named `access_as_user`. The token validator requires it and rejects a token without it.
6. **Authorized client applications**: pre-authorize the hosts that may request a token for this API, and
   grant them the `access_as_user` scope.

| Microsoft 365 client | Client ID |
|---|---|
| Teams desktop, mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
| Teams web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |
| Microsoft 365 web | `4765445b-32c6-49b0-83e6-1d93765276ca` |
| Microsoft 365 desktop | `0ec893e0-5785-4de6-99da-4ed124e5296c` |
| Microsoft 365 mobile, Outlook desktop | `d3590ed6-52b3-4102-aeff-aad2292ab01c` |
| Outlook web | `bc59ab01-8403-45c6-8796-ac3ef710b3e3` |
| Outlook mobile | `27922004-5251-4030-b22d-91ecd9a37ea4` |

For a Teams tab only, the first two rows are enough. Add the rest only if the tab is surfaced in those
hosts.

7. **API permissions**: the delegated Graph permissions `openid`, `profile`, `email`, `offline_access` are
   what SSO consents to. This application needs no other Graph scope, because it reads nothing from Graph.

### 3. Fill in the manifest

Copy `teams/manifest.json` and replace:

| Placeholder | With |
|---|---|
| `id` | A GUID for the Teams app. May be the same as the Entra client ID. |
| `webApplicationInfo.id` | The Entra **client ID**. |
| `webApplicationInfo.resource` | The **Application ID URI** from step 4, exactly. |
| `huddle.example.com` (four places) | The hostname serving the tab. |
| `developer.*` | The organization's name and its real privacy and terms URLs. |

Package `manifest.json`, `color.png`, and `outline.png` into a zip with no enclosing folder, then
**Teams → Apps → Manage your apps → Upload an app → Upload a custom app**. Custom app upload has to be
allowed by tenant policy.

### 4. Configure the server

```bash
NODE_ENV=production
SESSION_SECRET=<32+ random characters>
TEAMS_SSO=enabled
ENTRA_TENANT_ID=<tenant GUID>
ENTRA_CLIENT_ID=<application client ID>
ENTRA_APP_ID_URI=api://your-domain/<application client ID>
# DEMO_IDENTITY must be absent or "disabled". The server refuses to start otherwise.
```

## How sign-in is meant to work

```
Teams tab loads
  → app.initialize()                              src/web/teams.ts
  → authentication.getAuthToken()                 returns an Entra access token for this API
  → Authorization: Bearer <token> on API calls
  → verifyEntraToken()                            src/server/auth/entra.ts
       RS256 signature against the tenant JWKS
       issuer, audience, tenant id, exp, nbf
       scp contains access_as_user
  → findUserByEntraObjectId(claims.oid)           the staff directory is the only authority
  → organization, audiences, permissions from that record
```

The token identifies the person. It never carries their permissions. Those come from the directory, on
every request.

### What has to be built before this works

1. **Provisioning.** `StaffUser.entraObjectId` is empty in the demo, so `findUserByEntraObjectId` matches
   nobody and every request is denied. An organization has to link Entra object ids to staff records and
   decide who belongs to which audience, especially the medical one. That is a governance decision.
2. **The client has to request a token.** `initTeams()` takes `requestToken` and defaults to `false`,
   because the demo runs standalone. Production has to request it and attach the bearer header.
3. **Cookie or bearer, pick one.** A Teams tab is a cross-site iframe, so the current `SameSite=Lax`
   cookie will not be sent. Use bearer tokens, which is the intended path, or move to
   `SameSite=None; Secure` and add CSRF protection.
4. **JWKS caching and key rollover.** `httpJwks` caches for an hour with no negative caching and no retry.
   Fine for a demo, thin for production.

## Where data goes

Rendering inside Teams says nothing about where data lives. The application, its store, and its model
calls run wherever the organization deploys them. If the Azure adapter is enabled, note text also reaches
the configured Azure OpenAI resource in whatever region it lives.

Document the answer for your own staff before installing anything. See [DATA-HANDLING.md](DATA-HANDLING.md).

## Optional: the Azure OpenAI adapter

Also scaffolding. Written from the documented REST contract, unit-tested with a stubbed fetch, never run
against Azure.

```bash
AI_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=<deployment name>
AZURE_OPENAI_API_VERSION=2024-10-21
```

If any of these is missing the server refuses to start. It does not fall back to the mock provider, and
the mock provider never silently stands in for a failed Azure call: a failure produces a brief with the
deterministic sections and a visible notice.

The adapter sends `temperature: 0` and a strict JSON schema, offers the model no tools, and fences the
notes as untrusted data. Whatever comes back is validated by `src/server/ai/contract.ts` before it is used.

An API key in an environment variable is the documented minimum. A production deployment should use a
managed identity and a key vault instead.

## Checklist before a real install

- [ ] Authorization from whoever owns the tenant, in writing.
- [ ] The Entra registration reviewed by whoever administers it.
- [ ] Provisioning built, with audience membership decided by the people accountable for it.
- [ ] Bearer-token authentication finished and tested inside Teams.
- [ ] Durable storage, retention, and a deletion path.
- [ ] Data processing agreement covering the model endpoint, if the Azure adapter is on.
- [ ] Penetration test.
- [ ] Medical staff have read what the restricted audience holds and agree with it.
