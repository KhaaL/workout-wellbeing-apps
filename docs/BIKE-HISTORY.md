# Bike history import contract

Use **History → Merge history from a Bike Cardio JSON file**. Download a full
backup first. Merge adds rides, keeps existing rides/settings/saved workouts,
saves a recovery copy, and pauses cloud uploads for review. **Settings → Restore
a full backup** instead replaces local data after confirmation.

- [TypeScript contract](../apps/bike-cardio/history-types.d.ts)
- Runtime validators: `apps/bike-cardio/storage-adapter.js` and `history-schema.js`
- [Version 2 sprint test export](../examples/bike-history-sprint-v2.json)
- [Version 3 external examples](../examples/bike-history-external-v3.json)

Exports now use version **3**. Version 1/2 files remain importable; normalization
upgrades them without changing their recorded times or inventing a new revision.
The active-workout version and browser storage key are separate contracts.

## Required and optional

Each ride requires `id`, `startedAt`, `config.mode`, `activeMs`, `mainMs`,
`outcome`, `effortsCompleted`, and `metrics` (an empty `{}` is valid).
Optional: `endedAt`, `hadInterruption`, `editedAt`, `phases`, `hr`, all metrics,
and all configuration fields except `mode`.

Use omitted fields or `null` for unknown optional numeric readings. Legacy
metrics also accept `""`; all durations in required fields must be real numbers,
not `null`. Zero means zero, not unknown. Omit `hr` entirely if measured time
and zone duration are unknown. Omit `phases` when the phase breakdown is unknown.

IDs are nonblank strings, not necessarily UUIDs. Keep the same ID when importing
again. Identical normalized IDs/contents count as already present. Different
contents with an existing ID count as a conflict; the local ride wins. Different
IDs are separate rides even when their dates match. Invalid entries are counted
and skipped; review the import counts. Cancellation or failed writes retain
existing data. The same merge also accepts a full backup envelope.

## Enumerations

| Field | Values |
|---|---|
| `config.mode` | `zone2`, `sprint`; v3 also `external` (history only) |
| `config.bike` | `matrix`, `touchscreen`; v3 also `unknown` |
| `config.context` | `fresh`, `post-lifting`; v3 also `unknown` |
| `outcome` | `complete`, `partial` |
| `phases[].kind` | Native: `warmup`, `main`, `cooldown`, `ready`, `primer`, `settle`, `effort`, `recovery`. Import accepts **any string**, including `external` or `video`. |
| `phases[].outcome` | `complete`, `skipped`, `ended` |

In v3 omit unknown bike/context or explicitly use `"unknown"`. Do not use `""`.
In v1/v2 the legacy normalizer defaults unknown/missing bike to `matrix`, context
to `fresh`; do not use those defaults to imply knowledge you do not have.
`bikeId` is an optional free-text machine identifier; empty means unidentified.
`external` does not create a runnable video plan. External rides and rides with
unknown bike/context are shown independently in progress charts; automatic
comparisons withhold progress differences.

## Configuration defaults and limits

Missing target fields use defaults: `zoneMin=105`, `adjustBelow=108`,
`targetMin=110`, `comparisonHR=115`, `targetMax=120`, `zoneMax=122` bpm.
Targets must be integers in 1..300 and satisfy that ascending order (equalities
allowed). Defaults describe the app's plan, not evidence of externally measured
zones. Supply actual targets when recording time in this configured zone.

| Field | Default | Integer range / unit |
|---|---:|---|
| `warmupMinutes` | 5 | 1..30 min |
| `mainMinutes` | 25 | 1..180 min |
| `cooldown` | 3 | 1..30 min, Zone 2 |
| `sprintCooldownMinutes` | 5 | 1..30 min |
| `settleMinutes` | 2 | 1..15 min |
| `recoverySeconds` | 60 | 15..600 seconds |
| `n` | 5 | 1..20 planned efforts |
| `eff` | 30 | 10..120 seconds per effort |

`voice`/`beeps` default true; `bikeId` defaults `""` and is limited to 80 characters.
Configuration durations are planned values, not the actual durations in history.
For externally recorded/video rides they are unused placeholders for compatibility;
the history category prevents comparisons based on that default plan.

## Times, phases and heart rate

- `startedAt`/`endedAt`: epoch milliseconds since **1970-01-01T00:00:00Z**.
  Dates have no stored local timezone; the UI renders them in the device timezone.
  Use integer timestamps for imports. `exportedAt` is ISO 8601 text.
- `activeMs`: counted riding time across **all** phases, excluding pauses and
  unconfirmed interrupted intervals. It need not equal `endedAt - startedAt`.
- `mainMs`: time counted in the native Zone 2 `main` phase. Native sprint rides
  normally have **0**, not the sum of efforts. An external ride can use 0 when
  there is no separately measured main block; do not relabel the whole duration.
  It must be between 0 and `activeMs`.
- A phase has required `title`, string `kind`, numeric nonnegative `ms`, and
  `outcome`; `id` is optional. A single phase covering the session is accepted.
  The importer does not reconstruct a sprint plan or require phases to sum to
  `activeMs`. `effortsCompleted` must be an integer between 0 and `config.n`.
  `complete` means the recorded workout was completed; native recordings earn
  that outcome only when every planned phase completed. The short test example
  is `partial`, with a 10-second warm-up ended early.
- `hr.zoneMs`: measured **active riding time** at HR **inclusively between
  `config.targets.zoneMin` and `zoneMax`**, across all phases. It is not automatically
  Polar's zone 2. It must not exceed `hr.measuredMs`.
- `hr.measuredMs`: active time covered by valid HR readings. Native H10 integration
  joins consecutive visible readings with gaps of at most 5 seconds and excludes
  missing intervals/pauses. Whole-session averages entered in `metrics` do not
  create this value.
- `hr.coverage`: percentage `100 * measuredMs / activeMs`, bounded at 100;
  native output rounds to one decimal. Import validates 0..100, but does not
  recalculate it. Keep external aggregate values internally consistent.
- `hr.samples`: accepted-reading **count**, not an array. `0` is accepted even
  with externally calculated aggregate durations. Use it only when you have no
  sample count; zero should not claim that the app recorded those samples.
- `hr.averageHR`: measured-time-weighted bpm (native output: one decimal);
  omitted or `null` means unknown. `hr.source` accepts free text such as
  `"Polar Flow (imported)"`, up to 500 characters. If `hr` exists, its four numeric
  fields `zoneMs`, `measuredMs`, `samples`, `coverage` are required. Optional
  `hr.targets` are normalized and must match the ride's configured targets.

- `hr.trace` (optional): `{ "binSeconds": 5, "bpm": "100,101,,118" }`. Each
  comma-separated entry is the whole-number average bpm (1..300) for 5 seconds of
  **active riding time**, in order from the start; an empty entry is a bin measured
  for under half its length. Paused time is not active time and has no bins. The
  string holds at most 8640 entries (12 hours). One string per ride keeps backups
  under the object-count limit that an array of numbers would reach.
- `hr.main` (optional, Zone 2): `{ "averageHR": 118, "coverage": 96, "driftPct": 2.5 }`.
  The main block's measured average (1..300) and the percentage of it that was
  measured (0..100). `driftPct` (-100..100 or `null`) compares the second half's
  average with the first's; native output requires a main block of at least 10
  minutes with each half at least half measured. When `coverage` is at least 80,
  native rides also fill `metrics.mainAverageHR` with the same value.
- `hr.recovery60` (optional): one entry per sprint effort, or one for the Zone 2
  main block: bpm in the last 5 seconds of the phase minus bpm 55 to 60 seconds
  after it (-300..300), or `null` when either window was under half measured.

- `power` (optional): readings from a Bluetooth bike sensor.
  `{ "source": "Bluetooth bike sensor", "measuredMs": 1500000, "coverage": 95,
  "averageWatts": 140, "peak5sWatts": 180, "trace": { "binSeconds": 5,
  "watts": "140,,150", "rpm": "90,,88" }, "main": { "averageWatts": 147.5,
  "cadence": 90, "coverage": 100, "decouplingPct": 3.2, "fixedHRWatts": 150 } }`.
  `measuredMs` is active time with a power reading; `coverage` is its percentage
  of active time (0..100). Watts are 0..2500 and cadence 0..250 rpm; the traces
  use the same 5-second string format as `hr.trace`. `main` (Zone 2) holds the
  main block's average watts and cadence, the percentage of it with power,
  `decouplingPct` (-100..100 or `null`: watts per beat in the first half against
  the second, for main blocks of 10 minutes or more) and `fixedHRWatts` (average
  watts over 5-second bins within 2 bpm of `comparisonHR`, needing at least 12
  bins, or `null`). At 80% main-block coverage, native rides copy these into
  `metrics.averageWatts`, `metrics.cadence` and `metrics.fixedHRWatts`.

There is **no defined `recording` object** in this implementation. It has no
`nextSeq`/`sampleCount` contract or raw-sample storage. The live accumulator keeps
weighted totals, 5-second bins and the last reading; finished history stores
summaries and the 5-second trace.
An unknown `recording` extension is preserved but ignored. Omit it for imports;
do not fabricate sequence numbers or raw readings.

## Metric units and unknown values

Existing numeric metrics accept finite JSON numbers or numeric decimal strings.
Prefer `"23.6"` for decimal minutes (23 min 36 sec), **not** `"23:36"`; omit units
from the value. Omit, `null`, or `""` means unknown. Free text uses strings.

| Metric | Meaning / unit | Limits |
|---|---|---|
| `averageHR` | Whole-session average HR, bpm | 1..300 |
| `mainAverageHR` | Average HR over the same main block as watts, bpm | 1..300 |
| `zoneMinutes` | Time in the configured app zone, decimal min | >=0 |
| `cadence` | Average cadence, rpm | 0..250 |
| `averageWatts` | Main-block average output, W | 0..2500 |
| `fixedHRWatts` | Output at configured `comparisonHR`, W | 0..2500 |
| `perceivedEffort` | Subjective effort, integer | 1..10 |
| `resistance` | Console levels, free text e.g. `"8 → 7"` | 80 characters |
| `notes` | Free text | 2000 characters |

Version 3 adds the following fields **inside `metrics`**. Numeric values must be
JSON **numbers**; omit or use `null` for unknown. They survive merge, full backups,
cloud backups and edits, appear under **External readings**, and are included in
CSV export. They do not overwrite the existing main-block metrics.

| Metric | Meaning / unit | Limits |
|---|---|---|
| `peakWatts` | Peak output, W | 0..10000 |
| `maxCadence` | Maximum cadence, rpm | 0..250 |
| `maxResistance` | Maximum console resistance level | >=0 |
| `kcal` | Energy estimate, kcal | >=0 |
| `distanceKm` | Console distance, km | >=0 |
| `inclineAvgPct`, `inclineMaxPct` | Incline, percent, **5 = 5%** | -100..100 |
| `trainingBenefit` | External training-benefit text | 500 characters |
| `externalSource` | Data provenance, free text | 500 characters |
| `polarZonesMs` | Object with optional `z1`..`z5`, milliseconds per Polar zone | Each >=0; omitted/null zone means unknown |

Polar's zone boundaries are independent of app targets. Do not copy `z2` into
`zoneMs`/`zoneMinutes` unless those boundaries actually match. Numeric durations
and unbounded numeric readings must not exceed `Number.MAX_SAFE_INTEGER`.
The import limit is 8 MiB and 10,000 history entries. Extension fields are
preserved, but the app does not validate or interpret arbitrary extensions.
