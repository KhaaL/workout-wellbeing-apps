/** Import contract. Runtime authority: storage-adapter.js and history-schema.js.
 * Constraints not expressible by TypeScript are listed in docs/BIKE-HISTORY.md.
 */
export type HistoryVersion = 1 | 2 | 3 | 4 | 5;
export type WorkoutMode = 'zone2' | 'sprint' | 'external'; // external: v3 history only
export type RecordedBike = 'levels' | 'feel' | 'unknown'; // v4; v3 files carry a model code, mapped on import
export type RecordedContext = 'fresh' | 'post-lifting' | 'unknown'; // unknown: v3
export type SessionOutcome = 'complete' | 'partial';
export type BuiltinPhaseKind = 'warmup' | 'main' | 'cooldown' | 'ready' | 'primer' | 'settle' | 'effort' | 'recovery';
/** Imports also accept arbitrary string kinds, e.g. "video" or "external". */
export type PhaseKind = BuiltinPhaseKind | (string & {});
export type PhaseOutcome = 'complete' | 'skipped' | 'ended';
export type EpochMs = number; // milliseconds since 1970-01-01T00:00:00Z; nonnegative
export type Milliseconds = number; // finite, nonnegative
export type Reading = number | string | null; // numeric or numeric decimal text; "" = unknown

export interface HeartRateTargets {
  zoneMin: number; zoneMax: number; targetMin: number; targetMax: number;
  adjustBelow: number; comparisonHR: number; // integer bpm, 1..300
}
/** Required mode; other inputs are optional and normalized on import.
 * V3/v4 default missing bike/context to unknown; v1/v2 default to levels/fresh.
 * Explicit "" is rejected for v3 bike/context; use "unknown" or omit.
 */
export interface HistoryConfigInput {
  mode: WorkoutMode;
  bike?: RecordedBike; bikeId?: string; context?: RecordedContext;
  targets?: Partial<HeartRateTargets>;
  warmupMinutes?: number; mainMinutes?: number; recoverySeconds?: number;
  sprintCooldownMinutes?: number; settleMinutes?: number; cooldown?: number;
  n?: number; // planned effort count, 1..20
  eff?: number; // effort seconds, 10..120
  voice?: boolean; beeps?: boolean;
  plan?: Plan; // v5: the planned session ridden; it decides mode and n. See docs/BIKE-PLAN.md
}
/** Planned session (v5). Runtime authority: plans.js. Contract: docs/BIKE-PLAN.md. */
export type PlanStepKind = 'warmup' | 'primer' | 'settle' | 'main' | 'effort' | 'recovery' | 'cooldown';
export type Target = number | [number, number] | string; // number, [low, high] or a label of at most 40 characters
export interface PlanStep {
  kind: PlanStepKind; title?: string; // max 60 characters; {i} and {n} number repeats
  seconds?: number; // 1..10800; exactly one of seconds, untilHrAtMost, untilHrBelow
  untilHrAtMost?: number; untilHrBelow?: number; // bpm 40..230; not for primer or effort
  minSeconds?: number; // 1..3600, default 60, for HR-gated steps
  resistance?: Target; rpm?: Target; hr?: string; hrBelow?: number; cue?: string; // cue max 200 characters
  adjust?: { cadenceAbove?: number; add?: number; cadenceBelow?: number; beforeSeconds?: number; subtract?: number }; // effort with numeric resistance only
}
export interface PlanRepeat { repeat: number; step: PlanStep; between?: PlanStep } // repeat 2..20
export interface Plan {
  id: string; name: string; // max 80 characters each
  order?: number; scheduledFor?: string; // YYYY-MM-DD
  resistanceCues?: 'levels' | 'feel';
  conditions?: Array<{ label: string; value?: string }>; // up to 10
  record?: Array<'effortResistance' | 'effortWatts5s' | 'recovery60' | 'timeOfDay' | 'hoursSinceLifting' | 'fed' | 'note'>;
  notes?: string; // max 1000 characters
  steps: Array<PlanStep | PlanRepeat>; // 1..40; expands to at most 200 phases and 20 efforts
  hash?: string; // computed on import from resistanceCues and steps; supplied values are replaced
}
export interface EffortRecord {
  effort: number; outcome: PhaseOutcome; // effort number 1..20 in ride order
  resistance?: number | null; cadenceFlag?: 'high' | 'ok' | 'low' | null;
  watts5s?: number | null; peakWatts?: number | null; // W, 0..2500
  peakCadence?: number | null; wattsSource?: 'sensor' | 'manual' | null;
}
export interface RideConditions {
  timeOfDay?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | null;
  hoursSinceLifting?: number | null; // 0..2000
  fed?: 'fed' | 'fasted' | null; note?: string; // max 500 characters
  confirmed?: string[]; // plan conditions confirmed at the start, up to 10
}
export interface HistoryPhase {
  id?: unknown; // native phases use their numeric plan index; import does not depend on it
  title: string; kind: PhaseKind; ms: Milliseconds; outcome: PhaseOutcome;
}
export interface HeartRateSummary {
  source?: string | null; // free text, max 500 characters
  targets?: Partial<HeartRateTargets>; // normalized targets must match config.targets
  averageHR?: number | null; // bpm, 1..300; null/omitted = unknown
  zoneMs: Milliseconds; measuredMs: Milliseconds;
  samples: number; // count of accepted readings; 0 is accepted for an imported aggregate
  coverage: number; // percentage, 0..100, NOT a fraction
  trace?: { binSeconds: 5; bpm: string } | null; // comma-separated whole bpm per 5 s of active time; empty entry = unknown
  main?: { averageHR: number; coverage: number; driftPct?: number | null } | null; // Zone 2 main block
  recovery60?: Array<number | null> | null; // bpm drop 60 s after each effort, or after the Zone 2 main block
}
export interface PowerSummary {
  source?: string | null; // free text, max 500 characters
  measuredMs: Milliseconds; coverage: number; // percentage of active time with power, 0..100
  averageWatts?: number | null; peak5sWatts?: number | null; // W, 0..2500
  trace?: { binSeconds: 5; watts: string; rpm: string } | null; // same format as HeartRateSummary.trace
  main?: { averageWatts: number; cadence?: number | null; coverage: number; decouplingPct?: number | null; fixedHRWatts?: number | null } | null;
}
export interface PolarZonesMs {
  z1?: Milliseconds | null; z2?: Milliseconds | null; z3?: Milliseconds | null;
  z4?: Milliseconds | null; z5?: Milliseconds | null;
}
export interface HistoryMetrics {
  averageHR?: Reading; mainAverageHR?: Reading; // bpm, 1..300
  zoneMinutes?: Reading; // DECIMAL minutes, e.g. "23.6", not "23:36"
  cadence?: Reading; // average rpm, 0..250
  averageWatts?: Reading; fixedHRWatts?: Reading; // watts, 0..2500
  perceivedEffort?: Reading; // integer 1..10
  resistance?: string | null; // free-text console levels, max 80 characters
  notes?: string | null; // max 2000 characters
  // Added in v3. NUMBERS, not numeric strings. Omit or null for unknown.
  peakWatts?: number | null; // W, 0..10000
  maxCadence?: number | null; // rpm, 0..250
  maxResistance?: number | null; // console level, >=0
  kcal?: number | null; // kcal, >=0
  distanceKm?: number | null; // km, >=0
  inclineAvgPct?: number | null; inclineMaxPct?: number | null; // percent, -100..100
  trainingBenefit?: string | null; externalSource?: string | null; // max 500 characters
  polarZonesMs?: PolarZonesMs | null; // Polar's zones, NOT the app's configured zone
  [extension: string]: unknown; // unrecognized data is preserved but not interpreted
}
export interface HistoryEntry {
  id: string; // nonblank, stable, unique within a backup; UUID NOT required
  startedAt: EpochMs; endedAt?: EpochMs | null;
  config: HistoryConfigInput;
  activeMs: Milliseconds; mainMs: Milliseconds; // mainMs <= activeMs
  outcome: SessionOutcome;
  effortsCompleted: number; // integer, 0..normalized config.n
  metrics: HistoryMetrics; // required; {} is valid
  hadInterruption?: boolean;
  phases?: HistoryPhase[] | null;
  hr?: HeartRateSummary | null;
  power?: PowerSummary | null;
  efforts?: EffortRecord[] | null; conditions?: RideConditions | null; baseline?: boolean; // v5
  editedAt?: EpochMs;
  [extension: string]: unknown; // no defined recording/nextSeq/sampleCount contract
}
/** Recommended import envelope: choose History -> Merge history. */
export interface HistoryExport {
  app: 'bike-cardio'; kind: 'history'; version: HistoryVersion;
  exportedAt?: string; // ISO 8601, e.g. "2026-01-01T12:00:00.000Z"
  history: HistoryEntry[]; // up to 10,000 entries
}
/** Full backup: Restore replaces; Merge history reads only history. */
export interface FullBackup {
  app: 'bike-cardio'; version: HistoryVersion; kind?: 'backup';
  exportedAt?: string; updatedAt: EpochMs;
  settings: Omit<Partial<HistoryConfigInput>, 'mode' | 'bike' | 'context'> & {
    mode?: 'zone2' | 'sprint'; bike?: 'levels' | 'feel'; context?: 'fresh' | 'post-lifting';
  }; // runnable defaults, not an external recording
  history: HistoryEntry[]; active?: unknown | null;
  presets?: unknown[]; machines?: unknown[]; plans?: Plan[]; // plans: v5, up to 50
}
