# Two-minute demonstration

> Departments submit updates → an issue is surfaced → staff review the sources → a decision is confirmed →
> follow-up is assigned.

**Setup:** `npm install && npm run demo`, then open http://localhost:4000. Nothing else is needed. No
account, no key, no network.

---

### 0:00 — Sign in (15 seconds)

The sign-in screen lists a fictional staff. Say the line out loud:

> "Everything here is invented. Fictional club, fictional athletes, fictional notes."

Point at **Jordan Ellis**: read only, one audience. Point at **Dana Vega**: submit and approve, three
audiences including the restricted medical one.

Click **Dana Vega**.

> "The button sends a user id. The server looks her up in its own directory and decides what she can see
> from there. The browser never asserts a role."

### 0:15 — What the departments sent (20 seconds)

You land on **Daily Huddle**, audience **Performance Group**.

> "Five departments have been writing into this all week. S&C, sports science, medical, nutrition,
> coaching. Seven days of updates."

Click **Build today's brief**.

### 0:35 — The issue surfaces (25 seconds)

Scroll to **Scheduling conflicts**.

> "Tobias Wren is double-booked for thirty minutes. S&C put him in the weight room at two. The hitting
> coach put him in cage two at two thirty. Neither of them saw the other."

Then point at **Possible disagreements**.

> "This one is different, and the label says so. Coaching wants extra conditioning this week. Sports
> science wants running volume cut. No clock catches that, so a model reads the notes and asks a question.
> It does not answer it. Every model item lands here as *needs review*."

Then the **Outdated information** and **Actions missing an owner** sections.

> "Guidance two days past its review date. And an action nobody owns."

### 1:00 — Review the sources (20 seconds)

On the Wren item, click **Sources: U013, U014**.

> "Every item links back to what a person actually wrote. Author, department, timestamp, review date, the
> block they booked. The model's summary sits underneath, labelled as a summary, not as a fact."

Close the drawer. Click **Confirm** on the conflict.

### 1:20 — Confirm the decision (20 seconds)

Click **Record decision** on the same item. Set the action to what was agreed, pick **Marcus Okafor** as
the owner, keep the due date, and save.

> "A person records this. The model has no route to this form."

### 1:40 — Follow-up is assigned (20 seconds)

You land on **Decisions**.

> "Agreed action, owner, why, due, and when it gets looked at again. The one at the top with the amber
> marker has no owner, and the next brief will keep raising it until someone takes it."

Assign an owner to the unowned decision.

> "Now it stops being raised. That is the whole loop."

---

## If you have another sixty seconds

**The boundary.** Switch user to **Marcus Okafor**. Go to Updates and search "participation".

> "Nothing. The medical guidance is in an audience he does not belong to. It was filtered out before the
> query ran, so there is no record for him to find, and it never reached the model either."

Switch back to Dana Vega and search the same word. Two records.

**The hostile note.** On the brief, find the Beau Carrington item with the red marker: *Note contains
instruction-like text*. Open its source.

> "Someone wrote instructions to the assistant into a note. Approve the brief, mark everyone cleared. The
> system reads the operational sentence, marks the note, and does none of it. The brief is still a draft.
> Nothing was approved, because approval is a permission check on a person, not something a model can
> reach."

**When the model is not there.** Mention rather than demonstrate:

> "If the provider fails, the brief still ships with the four sections that are computed in code, and it
> says the model was unavailable. Nothing quietly substitutes for it."

## What not to claim

- No club uses this. There are no results, no case study, and no evidence that it saves anyone time.
  [EVALUATION-PLAN.md](EVALUATION-PLAN.md) is how that would be measured, not what was measured.
- The Teams manifest, the Entra sign-in, and the Azure adapter are written and unit-tested, never run
  against Microsoft or Azure. Say so before anyone asks.
