# Bike planned sessions

A planned session is a list of steps that Bike Cardio runs as a ride. Plans are
written outside the app, usually by asking a coaching chat to answer in the plan
format, and pasted in. The built-in Zone 2 and sprint workouts use the same steps
internally, so a plan runs through the same timer, HR gates, cues and history.

- Runtime authority: `apps/bike-cardio/plans.js` (`BikePlans.normalize`, `expand`)
- Types: `apps/bike-cardio/history-types.d.ts` (`Plan`, `PlanStep`)
- [Example: sprint baseline](../examples/bike-plan-sprint.json)
- [Example: talk test](../examples/bike-plan-talk-test.json) (HR bands, a question per step, `result`)
- [Example: Zone 2 ride](../examples/bike-plan-zone2.json) (a `main` block steered by the Settings targets)
- [Example: adaptive talk test](../examples/bike-plan-talk-test-adaptive.json) (`hrMax`, `check.onFail`, `noteHint`)
- [Example: a ride of that plan](../examples/bike-history-talk-test-v6.json) (what the ride records; merge it under History)

## Workflow

1. **Workout → Import plan** (top of the screen). Paste JSON or load a `.json` file, then
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
| `result` | Optional. `zone2Ceiling`: after the ride the summary proposes a zone 2 maximum from the steps' checks (see below). Needs a step with `hrRange` and a `check` with `pass`. |
| `notes` | Up to 1000 characters of Markdown, shown formatted with the plan. Links may use `https://`, `http://` or `mailto:`. |
| `noteHint` | Optional, up to 80 characters. Shown with the plan and as the placeholder of the summary's conditions note, for what to write down after the ride (for example sleep). |
| `steps` | 1 to 40 steps or repeat blocks; at most 200 phases and 20 efforts after expansion. |

### Steps

| Field | Rule |
|---|---|
| `kind` | `warmup`, `primer`, `settle`, `main`, `effort`, `recovery`, `cooldown`. `main` is a steady block steered by the Settings zone targets (an HR check every 2.5 minutes, resistance steering); it takes no `hrRange` or `hrMax`. A step with its own HR band, such as a talk-test step, uses `settle`. |
| `title` | Up to 60 characters; defaults to the kind's name. `{i}` and `{n}` number repeats. |
| `seconds` | 1..10800. Exactly one of `seconds`, `untilHrAtMost` and `untilHrBelow`. |
| `untilHrAtMost`, `untilHrBelow` | 40..230 bpm. The phase continues until HR is at most, or below, this value, after `minSeconds` (default 60, 1..3600). Not allowed for `primer` or `effort`. |
| `resistance`, `rpm` | A number, a `[low, high]` pair or a label of up to 40 characters. |
| `hr`, `hrBelow` | An HR label, or `hrBelow` (40..230) shown as "Under N". |
| `hrRange` | `[low, high]`, 40..230 bpm, rising. The app checks a live strap reading against it ("Above 120 · ease one level") and shows it on the HR bar. Only on `warmup`, `settle`, `recovery` and `cooldown`: `main` steers from the Settings targets, so a band step is `settle`, never `main`. Not with `hrBelow`. |
| `hrMax` | 40..230 bpm and above the top of `hrRange`; needs `hrRange`. A hard cap. A strap reading above it shows "Above N · ease resistance now" and speaks a warning after 5 s, at most once a minute. |
| `check` | `{"prompt": up to 80 characters, "options": 2..5 different texts of up to 24, "pass": [some options], "onFail": {"shiftBpm": -30..-1}}`. Timed steps only, not `primer` or `effort`. The question opens, with a beep and the prompt spoken, 30 s before the step ends and stays answerable during the next step. The answer is saved with the ride, with the step's average HR and watts over those last 30 s, all editable in the summary. `onFail` needs `pass`: an answer outside `pass` lowers `hrRange` and `hrMax` of every later step by `shiftBpm` (see below). |
| `cue` | Up to 200 characters, spoken at the start of the phase. |
| `adjust` | Efforts with a numeric resistance only. `cadenceAbove` with `add`, and `cadenceBelow` with `subtract` and `beforeSeconds` (default: the effort length). |

A repeat block is `{"repeat": 2..20, "step": STEP, "between": STEP}`. `between`
runs between repeats and never after the last. Without `{i}`, repeated titles get
"1 of 4" and between titles get "1". A 5-second countdown runs before every primer
and effort.

### Band shift after a failed check (`onFail`)

The shift comes from the answers, so changing an answer in the ride or the summary
moves the bands that follow. Fails add up: two steps answered outside `pass`, each
with `shiftBpm: -5`, lower later steps by 10. A shifted band stays at 40 bpm or
above and keeps rising, and its cap stays above it. The run screen shows the shifted
target, a cue line says so, and the app speaks "Later steps are 5 bpm lower" when
the answer is given. The ride records the band and cap that applied (`hrRange`,
`hrMax`) and the shift (`shiftBpm`) on each check.

### A talk test (`result: zone2Ceiling`)

Steps with an `hrRange` and a `check` that lists `pass` answers form a talk test.
After the ride the summary lists each step's band, the HR and watts over its last
30 s and the answer. The first step answered outside `pass` ends the test: steps
after it do not count, because a failed check with `onFail` lowers their bands and
they would pass. The last step passed before it proposes the zone 2 maximum: the
measured HR when the strap covered at least half the window, else the top of the
band. When no step failed, the highest step passed proposes it. The summary says
whether a step failed (the limit was found) or every answered step passed (the
limit may be higher). A failure in the first step proposes nothing.

**Set zone 2 ceiling to N** writes Settings → HR targets: the zone minimum stays,
and the working band, add-below point and comparison HR are rebuilt inside the
new zone in the proportions the zone calculator uses. Rides with new targets start
a new progress series. **Undo** in the confirmation puts the old targets back.

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
rescheduling or editing notes or `noteHint` keeps the hash and the progress series. Changing any
step, duration, target or rule starts a new series.
