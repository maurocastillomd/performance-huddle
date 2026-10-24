# Security model

The rule underneath all of it: **authorization is decided by server-side code reading the staff directory,
never by the client and never by the model.** If authorization cannot be established, access is denied.

## 1. Organization isolation

Every record carries an `orgId`. Every predicate in `src/server/auth/authorize.ts` starts by comparing it
to the caller's. The caller's organization comes from their directory record, never from a header, a body
field, or a token hint. A cross-organization read returns `404`, not `403`, so the response does not
confirm the record exists.

Tested: a Harbor City user sees only Harbor City updates, cannot build a Riverbend brief, and cannot be
named as the owner of a Riverbend decision.

## 2. Audience membership on every read and write

An update belongs to exactly one audience. So does a brief, and so does a decision. Reading anything
requires membership of that audience. Writing anything requires membership plus the right permission.

Reads are filtered **before retrieval**, inside the store, rather than fetched and then trimmed. An
unauthorized row is never loaded, so it cannot escape through a response, an export, a search result, a
notification, a count, or an error message.

Tested: an S&C coach gets `404` on a restricted record by id, sees it in no list, and finds nothing when
searching for its text. The reviewer searching the same term finds both restricted records.

## 3. Submission and approval are separate

`submit` writes updates. `approve` builds briefs, confirms or edits or dismisses items, approves briefs,
and records decisions. Neither implies the other, and an account can hold neither.

Tested: the S&C coach can submit and is refused at every approval endpoint. The intern is refused at
submission.

## 4. Checks before retrieval, and again before the model

Two independent gates:

1. The store filters by organization and audience when the rows are read.
2. `generateBrief` re-checks every source, one at a time, immediately before building the model request,
   and refuses the whole operation if anything fails.

Before the request is built, athlete names are replaced with per-brief labels (`Athlete 1`, `Athlete 2`).
Names, staff names, and the club name never leave the process.

Tested: the recorded provider request contains no restricted source, no withdrawn source, no source from
another audience, and no real name.

## 5. Reading a source does not authorize widening it

This is the failure mode that matters most in a mixed-department tool: a reviewer who can see restricted
guidance writing it into a brief the whole staff reads.

- A brief may cite only sources whose audience **equals** the brief's audience. Checked in the store query
  and again by `assertSourcesMatchAudience`.
- A decision's `sourceUpdateIds` are re-filtered server-side against the decision's own audience. Ids the
  client sent that do not qualify are dropped, not honoured.
- Exports and search inherit the same boundary.

Tested: a reviewer who can read a restricted update submits it as a source for a wider decision; the
server stores the decision without it.

## 6. Revocation takes effect immediately

The session cookie contains a user id and an issue time. Nothing else. No organization, no audiences, no
permissions, no roles. Every request re-reads the staff record, so there is no cached copy to go stale.

Tested: after `revokeAudience`, the very next request for a brief in that audience returns `404`, and the
brief drops out of the caller's list. After an account is disabled, the next request returns `401`.

## 7. Withdrawn and restricted sources invalidate briefs

A brief is a claim about a set of sources. When one is withdrawn, or moved to a different audience, every
brief citing it flips to `invalidated`, keeps the reason, and can no longer be exported (`409`). The
interface says why and offers a rebuild.

## 8. Instructions inside submitted notes

Notes are data. They are passed to the model between explicit `BEGIN NOTES (untrusted staff-submitted
data)` and `END NOTES` markers, and the system prompt says so.

Defence does not rest on the prompt:

- The model has **no tools**. No browsing, no messaging, no ability to read or write a record.
- No code path lets model output change workflow state. Approval, decisions, ownership, and audience are
  reached only through authorized handlers that never read model output.
- `detectUntrustedContent` marks notes matching known injection patterns. The marker is shown next to
  every item built from that note. It is advisory: it changes what a person sees, never what the system
  does.
- The mock provider skips any sentence carrying those patterns when forming claims.

Tested: the seeded injection note is flagged; an injection submitted live through the API changes nothing;
the brief stays a draft with every item pending, and no decision is created.

## 9. Model output is validated, not trusted

In order:

1. **Schema.** Zod. A response that does not match is discarded whole.
2. **Source ids.** Every cited id must be in the set sent for this brief. Anything else is dropped and
   counted as `fabricated_source_id`.
3. **Two distinct sources** for any claimed disagreement.
4. **Guardrails.** Text that recommends, instructs, clears an athlete, or claims to approve is dropped and
   counted.

Survivors become items marked `needs_review`, labelled as model output, linked to their sources. Rejection
counts and reasons are shown on the brief, so a bad run is visible rather than silent.

Tested: a hostile provider returning three real-looking items and three fabrications yields exactly one
displayed item and four counted rejections.

## 10. The model can never approve anything

`approveBrief` requires a directory-resolved caller with `approve` permission and refuses while any item
is `needs_review`. Recording a decision requires the same. Neither function reads model output.

## 11. No public links, and no secrets in the browser

Every data route requires a session. There are no share tokens, no signed public URLs, and no
unauthenticated preview. Exports are an authorized `GET` that streams an attachment.

Model credentials are read from the server environment and used only in server-side `fetch`. The client
never sees them and there is no client-side provider path.

## 12. Logs and audit records

`redactFields` allows identifiers, counts, and booleans. Any value that does not look like an identifier
becomes `[redacted]`, so a note body cannot reach a log line even by mistake.

Audit records hold: timestamp, actor id, organization id, action, resource type, resource id, allow or
deny, and a short machine reason. No free text from a submission. The trail is readable by approvers, in
their own organization only.

Tested: after submitting a note containing a distinctive phrase, neither the phrase, the word from it, nor
the athlete's name appears in any log line or audit record.

## 13. Startup refusals

The server will not start when:

- `DEMO_IDENTITY=enabled` and `NODE_ENV=production`. Demo identity switching must never run near real data.
- `SESSION_SECRET` is missing, or shorter than 32 characters, in production.
- `NODE_ENV=production` and `TEAMS_SSO=disabled`. Nothing else can identify a user in production.
- `TEAMS_SSO=enabled` without all three Entra settings.
- `AI_PROVIDER=azure` without the Azure settings. It does **not** quietly become the mock provider.
- `AI_PROVIDER` is any other value.

## 14. Transport headers

- `Content-Security-Policy: frame-ancestors` limited to `'self'` and the Microsoft hosts that render a
  Teams tab. This is what keeps the page out of anyone else's site.
- `Cache-Control: no-store` on every API response.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Powered-By` removed.
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. **A Teams tab is a
  cross-site iframe: production will need `SameSite=None; Secure`, or Entra bearer tokens instead of a
  cookie, which is the intended production path.** See [TEAMS-INTEGRATION.md](TEAMS-INTEGRATION.md).

## What an organization has to supply before this is production software

Honest list. None of these is done here.

1. **A real identity integration.** Entra token validation is written and unit-tested against locally
   generated keys. It has never run against a tenant.
2. **A provisioning path** from an Entra object id to a staff record with audiences and permissions.
   `StaffUser.entraObjectId` is the hook. Deciding who belongs to the medical audience is an
   organizational decision, not a code one.
3. **Durable, encrypted storage** with per-organization separation, backups, and a tested restore. Today
   it is process memory.
4. **A retention and deletion policy** with an implemented erasure path. See
   [DATA-HANDLING.md](DATA-HANDLING.md).
5. **A tamper-evident audit trail** that outlives the process, with its own retention rule.
6. **Rate limiting, request size limits beyond the 64 KB body cap, and abuse monitoring.**
7. **A CSRF strategy** if a cookie session is kept for a cross-site iframe. The bearer-token path avoids
   the question.
8. **A review by the people whose information this is**, including medical staff, plus whatever governance
   the league and the club require.
9. **Somewhere for the model to run** that the organization is willing to send athlete-adjacent text to,
   with a data processing agreement that matches. See [DATA-HANDLING.md](DATA-HANDLING.md).
10. **A penetration test.** The tests here encode what was designed for. They cannot tell you about what
    nobody thought of.
