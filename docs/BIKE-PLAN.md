# Bike planned sessions

A planned session is a list of steps that Bike Cardio runs as a ride. Plans are
written outside the app, usually by asking a coaching chat to answer in the plan
format, and pasted in. The built-in Zone 2 and sprint workouts use the same steps
internally, so a plan runs through the same timer, HR gates, cues and history.

- Runtime authority: `apps/bike-cardio/plans.js` (`BikePlans.normalize`, `expand`)
- Types: `apps/bike-cardio/history-types.d.ts` (`Plan`, `PlanStep`)
- [Example: sprint baseline](../examples/bike-plan-sprint.json)

## Workflow

1. **Workout → Planned sessions → Add.** Paste JSON or load a `.json` file, then
   **Check plan**. The app shows each plan as a phase table with its minimum time.
   **Save** stores it; a plan with an existing `id` replaces the saved one.
   **Copy plan format** copies a short description of this format to paste into
   the chat before asking for a plan.
2. **Use.** The plan sets up the next ride: phases, name and cue style. **Stop
   using plan** returns to Zone 2 or sprint. Plans sort by `scheduledFor`, then
   `order`, then name. A plan stays in the list after a ride and shows its last
   ridden date. **Details** shows the table and edits name and date.
3. **Start.** The app asks to confirm the plan's `conditions` (for example
   "Incline: 0%") and records the confirmed list with the ride.
4. **During the ride.** Each phase shows the plan's resistance, cadence, HR and
   cue. After each effort the screen asks for the resistance used, prefilled with
   the target. Under an `adjust` rule it also asks how cadence went; a connected
   bike sensor answers that from its readings. The next effort's target follows.
5. **Summary.** A table lists each effort: resistance, watts about 5 s in, peak
   cadence and the 60-second HR drop. Watts come from the bike sensor when it
   measured the effort; otherwise type the console reading. **Conditions** holds
   time of day (prefilled from the start time), hours since lifting, food and a
   note. **Baseline for this plan** marks the ride later rides compare with.
6. **History.** Rides of a plan form one series per plan hash, machine, context
   and HR targets. A later ride compares with the baseline and names a different
   time of day, food state, or more than 12 hours' difference since lifting.

Deleting a plan keeps the rides done with it; each ride stores its own copy.

## Format

```json
{
  "name": "Sprint baseline",
  "scheduledFor": "2026-10-17",
  "order": 2,
  "resistanceCues": "levels",
  "conditions": [{"label": "Incline", "value": "0%"}],
  "notes": "What this session is for",
  "steps": [
    {"kind": "warmup", "title": "Easy warm-up", "seconds": 480, "resistance": [6, 8], "rpm": [80, 90], "hrBelow": 120},
    {"kind": "primer", "title": "Primer", "seconds": 10, "resistance": [12, 14], "cue": "About 80% effort"},
    {"kind": "settle", "title": "Easy", "seconds": 120, "resistance": [4, 6]},
    {"repeat": 4,
     "step": {"kind": "effort", "title": "Effort", "seconds": 30, "resistance": 16,
              "adjust": {"cadenceAbove": 110, "add": 2, "cadenceBelow": 70, "beforeSeconds": 20, "subtract": 2}},
     "between": {"kind": "recovery", "title": "Recovery", "untilHrAtMost": 122, "minSeconds": 60, "resistance": [4, 6]}},
    {"kind": "cooldown", "title": "Cool-down", "seconds": 300, "resistance": "easy"}
  ]
}
```

| Field | Rule |
|---|---|
| `id` | Optional when pasting (one is generated); up to 80 characters. Keep it to replace a plan later. |
| `name` | Required, up to 80 characters. |
| `scheduledFor`, `order` | Optional date `YYYY-MM-DD` and whole number 0..999 for sorting. |
| `resistanceCues` | `levels` (default) when numbers name console levels, `feel` otherwise. |
| `conditions` | Up to 10 `{label, value}` pairs confirmed before the ride starts. |
| `record` | Optional subset of `effortResistance`, `effortWatts5s`, `recovery60`, `timeOfDay`, `hoursSinceLifting`, `fed`, `note`; all by default. |
| `notes` | Up to 1000 characters, shown with the plan. |
| `steps` | 1 to 40 steps or repeat blocks; at most 200 phases and 20 efforts after expansion. |

### Steps

| Field | Rule |
|---|---|
| `kind` | `warmup`, `primer`, `settle`, `main`, `effort`, `recovery`, `cooldown`. `main` is a steady block with HR checks and resistance steering. |
| `title` | Up to 60 characters; defaults to the kind's name. `{i}` and `{n}` number repeats. |
| `seconds` | 1..10800. Exactly one of `seconds`, `untilHrAtMost` and `untilHrBelow`. |
| `untilHrAtMost`, `untilHrBelow` | 40..230 bpm. The phase continues until HR is at most, or below, this value, after `minSeconds` (default 60, 1..3600). Not allowed for `primer` or `effort`. |
| `resistance`, `rpm` | A number, a `[low, high]` pair or a label of up to 40 characters. |
| `hr`, `hrBelow` | An HR label, or `hrBelow` (40..230) shown as "Under N". |
| `cue` | Up to 200 characters, spoken at the start of the phase. |
| `adjust` | Efforts with a numeric resistance only. `cadenceAbove` with `add`, and `cadenceBelow` with `subtract` and `beforeSeconds` (default: the effort length). |

A repeat block is `{"repeat": 2..20, "step": STEP, "between": STEP}`. `between`
runs between repeats and never after the last. Without `{i}`, repeated titles get
"1 of 4" and between titles get "1". A 5-second countdown runs before every primer
and effort.

### The adjust rule

The first effort of a rule uses the plan's resistance. Each later effort starts
from the resistance logged for the effort before it. A `high` flag (cadence went
above `cadenceAbove`) adds `add`; a `low` flag (cadence fell below `cadenceBelow`
between 5 s and `beforeSeconds`) subtracts `subtract`; `ok` or no flag keeps it.
With a bike sensor the app sets the flag from 5-second cadence windows; a low
reading wins when both happen. Readings are spread evenly within 5-second bins,
so a value can sit up to 5 seconds off.

### Identity

The app stores a hash of `resistanceCues` and the normalized `steps`. Renaming,
rescheduling or editing notes keeps the hash and the progress series. Changing any
step, duration, target or rule starts a new series.
