# Data processing, retention, deletion, and logging

## What this application holds

| Category | Fields | Sensitivity |
|---|---|---|
| Staff directory | id, name, title, department, organization, permissions, audience memberships | Internal |
| Roster | athlete id, name, position, number | Internal, identifying |
| Updates | athlete, department, note text, requested action and owner, audience, review date, author, timestamp, revisions, planned time block | Internal, identifying, and the note text is free-form staff writing |
| Restricted updates | the same fields, in the medical audience | **Sensitive.** Approved participation guidance |
| Briefs | derived items, source ids, review states, reviewer, model run metadata | Inherits the audience of its sources |
| Decisions | action, owner, rationale, dates, status, source ids | Internal |
| Audit records | timestamp, actor id, organization id, action, resource type, resource id, allow or deny, short reason | Internal, no free text |

**What it does not hold, and is not built to hold:** diagnoses, treatment notes, imaging, clinical history,
medication, or any other clinical record. The medical audience carries *approved participation guidance*,
which is what an athlete is cleared to do. That is still treated as sensitive: separate audience, separate
membership, and a marker on every derived item.

## Where data is processed and stored

**In this demo:** entirely in the memory of one Node process on the machine that runs it. The dataset is
rebuilt from `data/seed/` at every start. Nothing is written to disk. Nothing leaves the machine, because
the default model provider makes no network calls.

**In a real deployment:** wherever the organization runs the server and the database it connects to. That
is the whole answer, and it does not change because the page renders inside Teams.

> Appearing inside Microsoft Teams does not mean data stays inside Microsoft. Teams renders the tab in an
> iframe. The application, its storage, and its model calls are wherever the organization deployed them.
> If the Azure adapter is enabled, note text also reaches the configured Azure OpenAI resource, in whatever
> region that resource lives, under whatever agreement covers it.

Anyone deploying this owes their staff a plain answer to: which cloud, which region, which model endpoint,
which retention, and who can read the database.

## What reaches the model

Only when a brief is built, and only:

- the source id, department, date, note text, and requested action of updates **in that one audience**,
- an athlete label (`Athlete 1`), never a name,
- the huddle date and a generic audience label.

Not sent: athlete names, staff names, the organization name, any other audience, withdrawn updates, briefs,
decisions, or the audit trail.

With `AI_PROVIDER=mock`, the default, this data does not leave the process. With `AI_PROVIDER=azure` it is
sent to the configured deployment over HTTPS, from the server only. The API key stays in the server
environment.

Note text is still staff writing about identifiable athletes even with the names removed. A club should
decide deliberately whether it goes to a hosted model at all.

## Retention

The demo has none to speak of: process memory, cleared on restart. Below is the policy this design assumes,
which a deployment has to implement.

| Record | Suggested retention | Why |
|---|---|---|
| Updates | Season plus one year | The window in which anyone re-reads why a plan changed |
| Briefs | Season plus one year | They are the record of what was decided from what |
| Decisions | Season plus three years | Longest useful trail for staff turnover |
| Audit records | Two years | Long enough for an access review, short enough to stay minimal |
| Model run metadata | With its brief | Provider, counts, rejection reasons. No prompts, no responses |
| Prompts and model responses | **Not retained** | The application stores validated items, not transcripts |
| Logs | 30 days | Redacted already. Long enough to debug |

None of these should outlive whatever the club and league require, and the shorter number always wins.

## Deletion

What is implemented:

- **Withdraw an update.** The record is marked `withdrawn`, drops out of lists, briefs, exports, search,
  and model requests, and stays visible to its author and to approvers so the trail is not lost. Every
  brief citing it is invalidated in the same call.
- **Move an update to another audience.** Same invalidation.
- **Revoke a membership, disable an account.** Effective on the next request.

What a deployment must add:

- **Hard erasure** for a person, on request: their updates, the items derived from them, and their
  authorship trail, with a decision recorded about what happens to briefs that cited them. Because briefs
  are derived, the honest options are to invalidate and rebuild, or to keep the brief with the source
  redacted. That is a policy call, not a code call.
- **Organization offboarding.** One transaction, one `orgId`, and a way to prove it completed.
- **Backup expiry** that matches the retention table, or the table is fiction.

## Logging

`src/server/log/logger.ts` allows numbers, booleans, and strings matching
`^[A-Za-z0-9_.:/@-]{0,64}$`. Anything else becomes `[redacted]`. It is an allow-list, so a note body cannot
reach a log line even by accident.

A log line looks like:

```
2026-06-11T13:04:22.101Z info briefs.generate userId=u-vega briefId=B001 audienceId=aud-performance sources=17 aiAvailable=true aiRejected=0
```

Audit records hold the same shape of information, and no free text. Tested in
`tests/config-and-logging.test.ts`.

## Swapping the store

`src/server/data/store.ts` is the seam. Every read that can reach a caller goes through a `visibleTo`
method; the two `Unchecked` methods are used only for internal integrity work and never for a response.

To move to a database, keep those method signatures and push the same predicates into the query:

```sql
-- listUpdatesVisibleTo
SELECT * FROM updates
WHERE org_id = $callerOrgId
  AND audience_id = ANY($callerAudienceIds)
  AND (status <> 'withdrawn' OR author_id = $callerId OR $callerCanApprove);
```

Two rules to keep. Filter in the query, not after it. Derive `$callerOrgId` and `$callerAudienceIds` from
the directory read on this request, never from anything the client sent.
