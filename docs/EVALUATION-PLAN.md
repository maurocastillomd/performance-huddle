# Evaluation plan

**No evaluation has been run. Nothing here is a result.** This is the design of the study that would tell
you whether the tool is worth anyone's morning.

## The question

Does a structured brief help a performance staff run a shorter, clearer morning meeting than reading the
raw notes, and does the model-assisted version add anything the structured version does not?

## Three arms, same inputs

Each participant sees one day of departmental updates in one of three forms:

| Arm | What they get |
|---|---|
| **A. Raw** | The original notes, newest first. What most staffs have now. |
| **B. Structured, no model** | The same notes in the five sections, with only the deterministic detections: overlaps, expired review dates, missing owners, supersession. No summaries, no possible disagreements. |
| **C. Structured, model-assisted** | Arm B plus the model's summaries, possible disagreements, and clarification questions, labelled as they are in the product. |

Arm B matters most. Without it, any benefit gets credited to the model when the sorting did the work.

Arm B is not a mock-up: setting `AI_PROVIDER` to a provider that returns an empty envelope produces
exactly arm B, which is also the failure mode the product already handles.

## Design

- **Participants:** practising performance staff. Twelve to twenty, across S&C, sports science, medical,
  nutrition, and coaching. Small, so treat this as a usability study, not an efficacy trial.
- **Design:** within-subject, three days of synthetic data per participant, one arm each, order
  counterbalanced (Latin square) to spread learning and fatigue.
- **Materials:** synthetic days built to a fixed recipe, so difficulty is comparable across days: one
  scheduling conflict, one true disagreement, one compatible pair that must not be flagged, one expired
  item, one unowned action, and a variable number of routine updates.
- **Blinding:** participants cannot be blinded to the interface. The person scoring the outputs can be,
  and must be.
- **Task:** "Prepare for this morning's huddle. Write down what you would raise, and who does what."

## Measures

**Review time.** Seconds from opening the day to submitting the write-up. Reported as median and IQR, per
arm, per participant. Instrumented, not self-reported.

**Missed issues.** Against a ground-truth list fixed before any participant sees the data:

| Planted issue | Counted as found when |
|---|---|
| Scheduling conflict | Both athletes' blocks named and the clash stated |
| Cross-department disagreement | Both departments named and the tension stated |
| Expired guidance | The specific guidance named as needing review |
| Unowned action | The action named as needing an owner |
| Superseded instruction | The current instruction identified as the one that stands |

Score per participant per day: found ÷ planted.

**False alarms.** Anything raised as a problem that is not on the ground-truth list, split into:

- *system-induced*: traceable to something the interface flagged,
- *reader-induced*: the participant's own reading.

The compatible nutrition and S&C pair is the planted trap. Raising it as a conflict is a false alarm in
any arm, and it is the single most informative number in the study.

**Clarity of responsibility.** Two raters, blind to arm, score each write-up per issue:

| Score | Meaning |
|---|---|
| 2 | A named person, a specific action, and a time |
| 1 | An action with no named owner, or an owner with no action |
| 0 | The issue raised with neither |

Report the mean, and Cohen's kappa between raters. If kappa is below 0.6, the rubric is broken; fix it
before reporting anything.

**Trust calibration.** For each model-generated item in arm C: did the participant confirm, edit, or
dismiss it, and was that the right call against ground truth? Two failures matter and they matter
differently:

- confirming a wrong model item is over-trust,
- dismissing a correct one is under-trust.

A tool that produces a fast, wrong, confident brief is worse than the notes.

## Analysis

- Report per-arm distributions with confidence intervals. With twelve to twenty participants, describe;
  do not chase significance.
- The comparison that carries the argument is **C minus B**, not C minus A. A gets its own comparison
  against B and answers a different question: does the structure help at all.
- Publish per-participant data. Aggregates hide the person who got slower.
- Pre-register the ground-truth list and the rubric before collecting anything.

## What this cannot show

- **Nothing about athlete outcomes.** Not injury rates, not availability, not performance. This study is
  about a meeting, not a season, and no design at this size could support an outcome claim. Do not make
  one.
- **Nothing about real notes.** Synthetic days are cleaner than a real Tuesday: better spelling, tidier
  structure, no missing context that lives in someone's head.
- **Nothing about the long run.** Novelty flatters a new interface. A one-sitting study says nothing about
  week six, when people start skimming the sections they have learned are usually empty.
- **Nothing about model drift.** Arm C depends on which provider is configured. Any result belongs to that
  provider, that prompt, and that day.

## The failure the study is really looking for

Not "is it faster". It is whether the brief makes people stop reading the sources. If arm C participants
get faster while their trust calibration gets worse, the tool is doing harm, and the honest response is to
make the model quieter rather than to ship the speed.
