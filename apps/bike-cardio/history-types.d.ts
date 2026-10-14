/** Import contract. Runtime authority: storage-adapter.js and history-schema.js.
 * Constraints not expressible by TypeScript are listed in docs/BIKE-HISTORY.md.
 */
export type HistoryVersion = 1 | 2 | 3;
export type WorkoutMode = 'zone2' | 'sprint' | 'external'; // external: v3 history only
export type RecordedBike = 'matrix' | 'touchscreen' | 'unknown'; // unknown: v3
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
 * V3 defaults missing bike/context to unknown; v1/v2 default to matrix/fresh.
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
    mode?: 'zone2' | 'sprint'; bike?: 'matrix' | 'touchscreen'; context?: 'fresh' | 'post-lifting';
  }; // runnable defaults, not an external recording
  history: HistoryEntry[]; active?: unknown | null;
  presets?: unknown[]; machines?: unknown[];
}
