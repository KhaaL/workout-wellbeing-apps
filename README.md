# Liftlog and Bike Cardio

Two standalone workout apps with one shared browser storage engine.

See [STORAGE.md](STORAGE.md) for generic S3-compatible backup configuration.
Builds produce two standalone app folders:

- `dist/liftlog`
- `dist/bike-cardio`

## Everyday controls

- **Undo:** set edits/deletions in Liftlog and session edits/deletions in both
  apps offer Undo. History → **Recent changes & recently deleted** keeps up to
  30 changes for 30 days (bounded to roughly 1 MiB), on that device only.
  Recovery checks for newer edits before applying and keeps unrelated records.
  Deleted sets require their parent workout/exercise to remain identifiable.
  Recovery is not part of exported or cloud backups; bulk clearing/restoring
  still uses the existing full recovery copy. Restoring an individual record
  follows the current cloud backup settings.
- **Bike presets:** Workout → **Saved workout presets** saves the current
  machine, context, targets, durations and sound preferences. **Machine profiles**
  reuse bike identifiers. Save, update or delete named entries; applying them
  affects the next ride only. Both collections are included in full backups;
  older backups start with empty collections.
- **Comparisons:** completed session summaries select an earlier matching
  session and show three key readings first. Expand **Detailed comparison &
  notes** for the full table and caveats. History retains manual selection.
  Missing readings stay unknown and incompatible measurements have no delta.
- Both apps use the same confirmation layout, with Cancel focused first and
  explicit action buttons; keyboard Escape cancels.

## Workouts across devices

Settings → Move workout to another device prepares an explicit paused handoff.
Download its file, or save it to cloud and enter its code in the other device’s
same app. Receive and review before resuming. The source stays held; completed
histories and credentials remain on their devices. See [STORAGE.md](STORAGE.md)
for permissions and how to finish a handoff.

History → Compare two workouts shows earlier/later measurements and differences.
Bike comparisons distinguish machines, context, targets, plans and interrupted
rides; optional perceived effort is also exported to CSV. Liftlog compares the
same routine, uses recorded load conventions and converts historical units.
Missing readings remain unknown; warm-ups are excluded from working totals.

Local saves skip unchanged data and cache finished histories while active fields
change. Bike checkpoints ongoing timing every five seconds, saves at boundaries
and when leaving the page, and schedules periodic cloud checkpoints about once
per minute. An abrupt termination without a lifecycle event can lose up to five
seconds of the ongoing ride; finished rides and explicit edits save immediately.
Backups at an already uploaded revision create no additional snapshot.

## Source layout

| Location | Purpose |
|---|---|
| `apps/liftlog/index.html` | Liftlog composition, remaining screens, event routing and schema migrations |
| `apps/liftlog/controllers/` | Workout, routine/plan and exercise controllers with live context getters |
| `apps/liftlog/storage-adapter.js` | Liftlog storage policy, revisions and comparable backup identity |
| `apps/liftlog/screens/settings.js` | Settings templates with explicit state and helper inputs |
| `apps/bike-cardio/index.html` | Bike interface and app composition |
| `apps/bike-cardio/controllers/storage.js` | Backup controls, recovery copies and device-storage diagnostics |
| `apps/bike-cardio/targets.js`, `workout-core.js` | Target validation, plans, timing and active-session migration |
| `apps/bike-cardio/heart-rate.js`, `bluetooth.js` | HR packet interpretation, measured coverage and H10 connection lifecycle |
| `apps/bike-cardio/storage-adapter.js` | Bike schema, legacy migration and engine adapter |
| `packages/storage-engine/local.js` | Saving, failure reporting, recovery and durable replacement |
| `packages/storage-engine/handoff.js` | Paused transfer validation, source holds, reviewed receipt and recovery |
| `packages/storage-engine/remote.js` | S3 signing, separate-file backups, conditional sync, retries and recovery |
| `packages/storage-ui/` | Shared storage summary, provider checks, backup browser and handoff presentation |
| `packages/app-ui/` | Shared themes, controls, navigation, numeric adjustments and safe updates |
| `apps/bike-cardio/history.js`, `apps/liftlog/comparisons.js` | Comparable workout interpretation |
| `scripts/build.mjs` | Standalone Pages builds, security headers and offline cache versions |
| `tests/` and `apps/liftlog/tests/` | Storage, workout and browser checks |

## Build and test

Use Node.js 22.13 or later and Python 3 for CORS checks. From this directory:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:s3-cors
npx playwright install --only-shell chromium
npm run test:browser
```

`npm run build:liftlog` and `npm run build:bike` build one app. Outputs are
recreated on each build to remove stale files. The build copies only runtime
assets and embeds the shared engine and app-specific modules in each HTML file.
Edit the canonical JavaScript files listed above, not their generated inline
sections. Module markers are checked before embedding. Source HTML remains
directly runnable; deployed apps do not fetch the extracted source files.
Shared styles
are embedded from `packages/app-ui/themes.css` and `components.css`; `foundation.js`
provides theme application, navigation and numeric steppers. Security-header
hashes and offline cache versions are generated from the deployed assets.

Browser checks use isolated profiles and mocked cloud services. Set
`BROWSER_PATH` to an existing compatible Chromium if needed. See
[tests/README.md](tests/README.md) for coverage and individual suite locations.
CI runs every browser suite, including shared touch/navigation checks. `npm run
lint` checks canonical JavaScript for undefined/unused names and selected
correctness errors; generated inline copies and the remaining app-specific
inline code are covered by the browser suites. CORS tests preserve unrelated
origins and rollback files; browser provider tests use rules generated by the
same helper used for S3-compatible CORS configuration.

## Storage compatibility

Liftlog retains its `liftlog.v1` state key, backup format, migration chain and
configured cloud object path. Bike imports its old settings, history and active
ride keys into `bike-cardio.state.v1`, retaining the original bytes. Bike JSON
backups include history, settings and any saved ride; CSV export also remains.

Sync metadata uses separate `liftlog.v1.*` and `bike-cardio.v1.*` namespaces.
The default cloud objects are `liftlog-backup.json` and
`bike-cardio-backup.json`. Credentials are kept separately and excluded from
workout backups. No cloud connection runs until configured by the user.

Both apps provide **Storage provider checks** and **Cloud snapshots** under
their cloud-storage settings. Compatibility checks create a small disposable
object beneath `<backup-path>.checks/` and verify read-back, exposed ETags,
create-only writes, rejected stale writes and accepted current-version updates.
They never write to the configured workout backup. Checks pause automatic sync;
a proven overwrite-protection failure blocks **conditional sync** writes across
reloads until a passing recheck, and an inconclusive recheck cannot clear it.
Separate-file mode remains usable when read/write and ETag checks pass.
Sequential checks verify API behavior, not concurrent consistency guarantees.
Cleanup needs object-delete permission and `DELETE` in bucket CORS. A failed
cleanup reports its remaining probe key; an interrupted check can also leave a
small probe object in that prefix.

Connection errors distinguish rejected credentials, missing buckets, permissions,
missing ETags and timeouts. Browsers do not reliably distinguish network/TLS
failures from CORS blocks, so that case explains both and suggests checking
network access and browser permissions. Diagnostic downloads contain connection details
and check results, excluding access/secret keys, signed headers, server error
bodies and workout contents.
Connection tests are read-only: conditional mode reads the configured object;
separate-file mode validates a bucket listing scoped to the app's snapshot prefix.
An empty listing is a successful read check. Neither test claims write permission.
An `AccessDenied` / `Invalid signature` response is reported as a
credentials or signing problem.

Snapshot browsing uses signed `ListObjectsV2` requests scoped to
`<backup-path>.snapshots/`, with 20 entries per page, oldest first. Bucket listing
permission is required. Preview fetches the file to show record counts; downloads
retain its exact bytes. Restore validates the app format, checks for changes
during confirmation, preserves the current local state and leaves cloud sync
paused. Active or resumable workouts block snapshot replacement.

Bike's **Backups & cloud storage** panel includes connection-file import/export,
a separate read-only connection test, last-sync and pending-work details,
backup-age reminders, browser storage estimates and a persistence request.
Connection exports omit the secret by default; importing one fills a reviewable
form and does not apply it until **Check & save connection** succeeds. File-backup
dates are device-only metadata and do not change the ride revision.

Bike's History screen can export JSON and merge another Bike history file or
full backup. Imports report new rides, duplicates, invalid records and ID
conflicts; existing local rides win conflicts, and settings and any active ride
are retained. Merging or clearing history preserves a recovery copy and pauses
cloud sync for review. Clearing history is blocked while a ride is active or
saved for resumption. Unreadable data and the copy before the last replacement
have separate recovery controls; valid previous backups can be restored directly.

After a successful sync establishes a baseline, independent edits to both
copies require a choice. Older backups with no baseline retain Liftlog's
timestamp reconciliation; differing undated copies require review. This
release synchronizes whole-app snapshots rather than merging sessions.
Local saving also detects a stale tab attempting to replace newer saved data;
export that tab's changes and reload to review them.

## Recovery

Preserve full backups before production deployment. Unreadable data is kept
in recovery storage, and failed recovery writes prevent replacement. Restoring
a file pauses cloud sync until the user reviews the copies. Active workouts
defer cloud replacement.
Liftlog refuses bulk workout clearing while a workout is active or resumable.
Clearing preserves a full local recovery copy before replacing the saved state,
checks for edits during confirmation and leaves cloud uploads paused for review.
Cancellation and storage failures retain the existing workout history.

Bike's old keys are an archival copy, not updated mirrors. Reverting to an old
Bike build shows the pre-migration history. Export a new JSON backup before a
rollback and convert newer records to the old format if that old build must
use them. Liftlog's workout format is unchanged.

Keep existing production addresses to retain device-local history. The two
Pages projects use independent service-worker scopes and cache prefixes.
Deployment credentials and personal workout data are not part of this package.

## Separate backup files

The connection form now has a **Backup mode** choice in both apps. **Automatic**
selects **Separate backup files** for every provider, including connections
without a mode setting. **Conditional sync** remains an explicit choice and
requires enforced write conditions. Existing single-object cloud backups are kept.

Each upload creates `<backup-path>.snapshots/<timestamp>-<random-UUID>.json` and
verifies the saved bytes by reading them back. It never writes a shared latest
pointer or automatically adopts another device’s data. Concurrent devices can
retain both versions even when a provider ignores write conditions. To reconcile,
download a full local backup,
browse cloud backups, preview and restore the desired copy. Bike can also merge
a downloaded backup’s ride history through **Merge history**; Liftlog has its own
history import. Restores stay paused until you choose **Resume** to create a new
local backup and resume automatic uploads. **Restore legacy backup locally**
recovers the former single-object backup with the same local recovery safeguards.

This mode needs bucket-list permission to browse files, and GET/PUT with exposed
ETag. Every device must be able to reach the configured endpoint. Browsers
contact storage directly; hosting does not relay these requests.
Backups accumulate without automatic retention or deletion. Manage retention
on the storage server after verifying an off-device recovery copy. Compatibility
probe cleanup additionally needs DELETE; ordinary backups do not.

## Shared interface

Settings begins with the same storage summary in both apps: saved on this device,
upload pending, backed up, uploads paused, offline, or needs attention. Local save
failures take priority over cloud success. **Backed up** requires a confirmed
cloud backup of the current revision, with no pending changes. Connection tests
alone cannot produce it. The summary shows the last cloud backup and file export
separately, with a relevant next action and expandable **Storage options**.
Review actions open the existing choices; they do not resume or replace data.

Both apps use the same themes, common controls and navigation. Phones use labeled
bottom navigation; active workouts replace it with an action bar and a Menu button.
Other screens provide Return to workout without resetting or pausing the session.
Desktop keeps the same destinations in the header. Liftlog's Today destination is
now labeled Workout; existing view identities and keyboard shortcuts remain.

Bike's Workout screen contains the upcoming plan and optional ride adjustments.
Settings holds appearance, default targets/durations, sound, storage and updates.
Ride adjustments do not change defaults; saved defaults do not rewrite a running
ride's recorded plan. Bike's theme is stored as a device preference, outside workout
backups. Liftlog keeps its existing theme setting and backup compatibility.

Liftlog's set editor provides larger numeric adjustments using the configured load
step, saves only on confirmation, and contains the less frequent warm-up/delete
actions. Direct row entry and Done remain available. Shared frequent controls have
48px touch targets, and navigation/action bars yield space to the software keyboard.

## Updates and Bike progress

Both apps check for new app files on startup, return to the foreground and
network reconnection. Automatic checks are throttled to once per minute; manual
checks remain available. Detection downloads an update without activating it.
Both apps display the loaded release version and provide **Check for app
update** and **Apply update & reopen** controls. Applying checks every open app
tab for saved data and active or resumable workouts. Unresponsive older tabs
also defer activation. Finish saved workouts and close older tabs before trying
again. Installation does not trigger an unsolicited page reload. Offline app
files switch only after the requested update activates.

Bike’s **Targets & durations** controls cover HR boundaries, working targets,
comparison HR, warm-up, main block, cooldowns, primer settling, recoveries and
sprint efforts. Every ride keeps its original targets and planned durations;
old rides retain the original 105–122 bpm zone and 115 bpm comparison target.
Bike migrates version 1/2 backups to version 3 and active sessions to version 3.
The history/backup and active-workout version numbers are independent.

For external recordings, use History → Merge history. See the
[history contract](docs/BIKE-HISTORY.md), [TypeScript types](apps/bike-cardio/history-types.d.ts),
and tested [example exports](examples/). Version 3 supports an Externally recorded
history category, unknown bike/context, and optional external readings under
`metrics`. These appear in session details and CSV exports.
Update Bike on receiving devices before importing newly exported files; older
releases reject the new version instead of dropping the recorded targets.
Live advice, HR gates, measured zone time, summaries and CSV exports use those
recorded values. Input validation prevents inconsistent target ordering.

History filters cover machine, context, workout, dates, outcome and interruptions.
Progress charts show watts, main-block HR, duration and H10 coverage with an
accessible readings table. Lines join only matching machines, contexts, targets
and plans. Missing readings remain unknown and break a line. Exports retain the
complete history regardless of the current viewing filters.

Audit status and future extraction candidates are tracked in [BACKLOG.md](BACKLOG.md).

Cloud snapshot browsing reads listing metadata across provider pages, then shows
20 backups at a time sorted by last-modified time descending. Older/Newer controls
page through the sorted list; Browse refreshes it. Snapshot bodies load only when
you preview, download or restore.

Liftlog planned workouts open an exercise preview from Workout before starting.
Exercises offers Archive/Unarchive on each row. Archived exercises are hidden from
history exercise views, search, comparisons, trends and add-exercise pickers; stored
workouts and existing routine prescriptions remain intact. Show archived in Exercises
to unarchive a movement and restore its visibility.
