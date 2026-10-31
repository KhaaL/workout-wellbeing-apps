# Wellbeing apps

Four standalone apps with one shared browser storage engine: three workout apps
(Liftlog, Bike cardio, Tabata) and Foodlog, a food intake log.

See [STORAGE.md](STORAGE.md) for generic S3-compatible backup configuration.
`npm run build` produces one static site in `dist/`:

- `dist/index.html`: a home page that links to each app
- `dist/liftlog/`, `dist/bike-cardio/`, `dist/tabata/`, `dist/foodlog/`: one folder per app
- `dist/_headers`, `dist/_redirects`, `dist/404.html`: site-wide host files

Each app keeps its own address (`/liftlog/`, `/bike-cardio/`, `/tabata/`, `/foodlog/`) and
installs as its own home-screen app. See [Deploying](#deploying).

## Foodlog

Foodlog logs what you eat from your own food catalog. Every logged item is a
catalog food, so the catalog holds three kinds: packaged products with label
values, everyday foods with typical values, and dishes with per-portion values.
Nutrients describe 100 g, 100 ml or one portion. A blank value is unknown: it is
never counted as 0, and totals say how many items lacked it.

- **Catalog file:** Foods imports a JSON catalog (schema 1.x) and merges it by
  `id`. Label values come from the file. Portions added in the app and archived
  foods stay, and foods the file no longer lists are kept. Export writes the
  same format, including foods added in the app and every field Foodlog does not
  use. See [Foodlog catalog and exports](docs/FOODLOG.md).
- **Logging:** Today groups the day by meal. Foods holds the catalog, and
  the add sheet logs from it: **+** logs a food at its usual amount in one tap.
  Steps, list order and start amounts are in
  [apps/foodlog/README.md](apps/foodlog/README.md). Logs into today get the
  clock time; logs into an earlier day get none. Logs before the day change
  time (default 04:00) count toward the previous day. **Copy a meal…** on each
  meal copies one from the last 14 days, same meal first, keeping amounts,
  times and notes; a food still in the catalog logs at its current values.
- **Frozen values:** logging stores a frozen copy of the food's values, shared
  by all entries of that version. Correcting a label later leaves logged days
  unchanged.
- **Totals:** energy, the share of energy from estimated items, and bars for
  daily targets. "At least" targets (such as protein and fibre) fill toward a
  goal; "at most" limits (such as salt and saturated fat) warn when passed.
  Targets can also cover free sugars and vitamins or minerals (vitamin D,
  calcium, iron and others).
- **Free sugars:** labels give total sugars, so each food is marked: its sugars
  count as free (added sugar, honey, syrup, juice) or not (fruit, milk). Free
  sugars add up the marked foods; a food with sugars and no mark leaves the
  total unknown. **Mark which sugars are free…** lists the day's unmarked
  foods. Marks apply to every day with that food. A catalog file's `sugar_g`
  limit becomes the free sugars limit.
- **Vitamins and minerals:** foods can list them (edited in the food form or
  imported). Today's **Vitamins & minerals** shows each total with how many
  items list it.
- **History and export:** History starts with the last 7 days: the average per
  day with food logged for energy and each target, days on target (a limit
  counts only when every value is known), and the week before. Logged days
  follow with their totals. **Export
  day as JSON** writes a food-log file with meals, items, nutrition, subtotals
  and day totals.
- **Day import:** **Import day file…** reads the same shape, from Foodlog or
  written elsewhere. Each item links to a catalog food by `food_id`, by exact
  name, or by values that match a food within 2% for that amount; anything
  else becomes a new food from the item's values. A preview lists every item's
  outcome and compares the items with the file's day total before anything
  changes. A day that already has items can be added to or replaced, and Undo
  reverses the import. **Day file format & sample** (and **Catalog format &
  sample** in Foods) describes both files and downloads samples built by the
  same export code, so they always import.

Foodlog uses the shared local saving, recovery, backup files, cloud backups and
updates, with its own `foodlog.v1` namespace and `foodlog-backup.json` default
object. Capacity is 5,000 foods and 20,000 logged items (about five years at ten
items a day). Foodlog data is version 3: entries may have no time, a day may
keep its own meal order, and foods carry favourites and free sugars marks.
Version 1 and 2 data load unchanged, and older releases refuse version 3 data.

## Tabata timer

Tabata is a separate mobile interval timer. Set work/rest seconds and round count
with large touch steppers or the numeric keyboard, or choose a quick setup.
The last setup is remembered. Settings includes an optional get-ready countdown,
sound cues, screen stay-awake and the same appearance themes as the other apps.
Work/rest/end cues use a bundled recording of a real boxing bell; Settings →
**Test bell** previews it without starting a session. Attribution and processing
notes are in [Tabata audio credits](apps/tabata/AUDIO-CREDITS.md).
The total includes preparation and rests between rounds, with no final rest.

During a session, large digits show the current interval, round and remaining
workout time. Pause/Resume and End stay within reach; ending asks for confirmation
and retains the session in history. Cancelling End leaves the timer paused.
Setting changes apply to the next session. Timer and Settings are the only tabs.

The setup's collapsed **Instructions** box holds optional Markdown (the same
subset as Liftlog's exercise instructions, without links) with a Preview switch.
When it has text, the run screen shows an **Instructions** button that opens it
over the timer; the timer keeps running, and finishing closes the pop-out. The
text is part of Tabata's settings and backups; sessions and history do not copy
it. Tabata data is version 2 since instructions were added. Version 1 data
upgrades on load, and older app releases refuse version 2 data instead of
dropping the text.

The timer uses elapsed time, so delayed callbacks catch up. Keep it visible for
reliable cues: mobile browsers can suspend background pages and audio. Stay-awake
uses the Screen Wake Lock API on HTTPS (or localhost), shows its current status,
reacquires on return to the app and offers Retry if the device releases it.
Unsupported or denied requests show an auto-lock reminder. Stay-awake remains
active while paused and is released when the session ends or the page is hidden.

The app works offline after its first online load and can be added to the home
screen. An interrupted/reopened session is recovered **paused** at its latest
checkpoint (saved at interval changes, every five seconds and when hidden).
An abrupt termination can lose up to five seconds; resuming is always explicit.
Completed and ended sessions save immediately. Tabata uses the shared recovery,
backup and update machinery, while its data, theme and offline cache have
separate namespaces. It backs up to `tabata-backup.json` through the site's
shared cloud connection (see [Shared cloud connection](#shared-cloud-connection)).

`npm run build:tabata` builds the site; Tabata is served from `dist/tabata/`. For direct source previews, serve the
repository root and open `apps/tabata/`: it loads canonical styles and scripts
without a build. Source previews require the rest of the checkout, and offline
installation is provided by the built app. `npm run test:tabata-browser` checks mobile
controls, timing, wake-lock lifecycle, recovery, cloud/file backups and offline use.

## Everyday controls

- **Undo:** in both apps a deletion shows Undo in the toast for 6 seconds, and
  edits show no prompt. History → **Recent changes & recently deleted** keeps up to
  30 changes for 30 days (bounded to roughly 1 MiB), on that device only.
  Recovery checks for newer edits before applying and keeps unrelated records.
  Deleted sets require their parent workout/exercise to remain identifiable.
  Recovery is not part of exported or cloud backups; bulk clearing/restoring
  still uses the existing full recovery copy. Restoring an individual record
  follows the current cloud backup settings.
- **Bike presets:** Workout → **Saved setups** holds two kinds of entry in one
  picker. **Save as preset** stores the current machine, context, targets,
  durations and sound preferences. **Save as machine** stores only the
  resistance cues and bike identifier. Update or delete either; applying one
  affects the next ride only. Both collections are included in full backups;
  older backups start with empty collections.
- **Bike planned sessions:** Workout → **Planned sessions → Add** takes a plan
  pasted from a coaching chat (JSON; **Copy plan format** gives the chat the
  format). **Use** sets up the next ride from it; the ride logs each effort's
  resistance, a cadence rule sets the next effort, and the summary records watts
  about 5 s into each effort, conditions and a baseline. See the
  [plan contract](docs/BIKE-PLAN.md).
- **Comparisons:** Bike session summaries select an earlier matching ride and
  show three key readings first. Liftlog session summaries compare each
  exercise with its own most recent earlier session that used the same load
  convention, from any routine; each row names that session. Expand
  **Detailed comparison & notes** for the full table and caveats. History
  retains manual selection. Missing readings stay unknown and incompatible
  measurements have no delta.
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
rides; optional perceived effort is also exported to CSV. Liftlog offers any
workout that shares an exercise, most shared exercises first, then the most
recent. Whole-workout totals get differences only for the same routine and
exercise list; shared exercises are compared by recorded load convention with
historical units converted.
Missing readings remain unknown; warm-ups are excluded from working totals.

Local saves skip unchanged data and cache finished histories while active fields
change. Bike checkpoints ongoing timing every five seconds, saves at boundaries
and when leaving the page, and schedules periodic cloud checkpoints about once
per minute. An abrupt termination without a lifecycle event can lose up to five
seconds of the ongoing ride; finished rides and explicit edits save immediately.
Backups at an already uploaded revision create no additional snapshot.

## Deploying

The site is plain static files. Any static host that serves HTTPS, reads a
root `_headers` file (path rules with `*` wildcards) and a root `_redirects`
file, and serves `404.html` for missing paths can host it as one project:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Output directory | `dist` |
| Node.js | 22.13 or later |

`dist/_headers` gives each app folder its own Content-Security-Policy with the
hashes of that app's inline scripts and styles. The home page has an exact `/`
rule. No rule covers the whole site: a host applies every matching rule, and a
second policy on an app page would block its scripts. Each app's service worker
is served with `Cache-Control: no-cache`. `dist/_redirects` adds the trailing
slash (`/liftlog` → `/liftlog/`), which the apps' relative URLs need.

Each app's manifest uses its folder as `id`, `start_url` and `scope`, and its
service worker registers from that folder, so browsers offer a separate install
per app. The home page has no manifest or service worker; one at `/` would
control every app's pages.

Cloud backups need the site's origin (no path) in the bucket's CORS rules; see
[STORAGE.md](STORAGE.md). One origin covers all four apps.

## Source layout

| Location | Purpose |
|---|---|
| `apps/liftlog/index.html` | Liftlog composition, remaining screens, event routing and schema migrations |
| `apps/liftlog/controllers/` | Workout, routine/plan and exercise controllers with live context getters |
| `apps/liftlog/storage-adapter.js` | Liftlog storage policy, revisions and comparable backup identity |
| `apps/liftlog/screens/settings.js` | Settings templates with explicit state and helper inputs |
| `apps/tabata/` | Tabata timer composition, timing core, storage adapter and offline shell |
| `apps/foodlog/` | Foodlog model (`food-core.js`), storage adapter, screens and offline shell |
| `apps/bike-cardio/index.html` | Bike interface and app composition |
| `apps/bike-cardio/controllers/storage.js` | Bike's settings for the shared storage panel, backup reminders and persistence requests |
| `apps/bike-cardio/targets.js`, `workout-core.js` | Target validation, plans, timing and active-session migration |
| `apps/bike-cardio/heart-rate.js`, `bluetooth.js` | HR packet interpretation, measured coverage and H10 connection lifecycle |
| `apps/bike-cardio/storage-adapter.js` | Bike schema, legacy migration and engine adapter |
| `packages/storage-engine/local.js` | Saving, failure reporting, recovery and durable replacement |
| `packages/storage-engine/handoff.js` | Paused transfer validation, source holds, reviewed receipt and recovery |
| `packages/storage-engine/remote.js` | S3 signing, separate-file backups, conditional sync, retries and recovery |
| `packages/storage-ui/` | Shared storage summary, Backups & cloud storage panel, provider checks, backup browser and handoff presentation |
| `packages/app-ui/` | Shared themes, controls, navigation, numeric adjustments, Markdown rendering and safe updates |
| `apps/bike-cardio/history.js`, `apps/liftlog/comparisons.js` | Comparable workout interpretation |
| `scripts/build.mjs` | Site build: home page, app folders, per-folder security headers, redirects and offline cache versions |
| `site/` | Home page and site-wide 404 page sources |
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

`npm run build` always builds the whole site. App folders are
recreated on each build to remove stale files. The build copies only runtime
assets and fills each `/* name:start */ … /* name:end */` marker pair in the app's
HTML and service worker with its shared or app-specific file. Source files keep
those pairs empty, so every module exists once, in its canonical file; a missing,
doubled or reversed pair stops the build. Run or test the built app in `dist/`:
the source HTML lacks its modules until built, and deployed apps fetch no
extracted files. Shared styles come from `packages/app-ui/themes.css` and
`components.css`; `foundation.js` provides theme application, navigation and
numeric steppers. Security-header
hashes and offline cache versions are generated from the deployed assets.

Browser checks use isolated profiles and mocked cloud services. Set
`BROWSER_PATH` to an existing compatible Chromium if needed. See
[tests/README.md](tests/README.md) for coverage and individual suite locations.
CI runs every browser suite, including shared touch/navigation checks. `npm run
lint` checks canonical JavaScript for undefined/unused names and selected
correctness errors; the app-specific code still written inline in each HTML file
is covered by the browser suites, which load the built apps (their npm scripts
build first). CORS tests preserve unrelated
origins and rollback files; browser provider tests use rules generated by the
same helper used for S3-compatible CORS configuration.

## Storage compatibility

Liftlog retains its `liftlog.v1` state key, backup format, migration chain and
configured cloud object path. Bike imports its old settings, history and active
ride keys into `bike-cardio.state.v1`, retaining the original bytes. Bike JSON
backups include history, settings and any saved ride; CSV export also remains.

Sync metadata uses separate `liftlog.v1.*`, `bike-cardio.v1.*`, `tabata.v1.*`
and `foodlog.v1.*` namespaces. The default cloud objects are
`liftlog-backup.json`, `bike-cardio-backup.json`, `tabata-backup.json` and
`foodlog-backup.json`. Credentials are excluded from backups. No cloud
connection runs until the user saves one; a connection saved in one app starts
backups in every app on the site the next time each is opened.

### Shared cloud connection

The apps on the site share one cloud connection, saved once under
`wellbeing.connection.v1`: endpoint, region, bucket, path style, access key,
secret and backup mode. Each app keeps its own record under `<namespace>.remote`
with its backup path and backup history (last backup, last uploaded revision),
tied to the destination it describes. Pause state, pending uploads, provider
checks and conflicts stay per app, so apps never read each other's files.

- Saving the connection in any app's Settings saves it for every app. Open
  apps on the site pick up the change through a storage event and stop
  requests made with the old connection.
- An app whose history describes another bucket or path hides it until the
  connection points there again.
- **Forget connection** removes the shared connection, so cloud backups stop in
  every app. The other apps keep their backup paths and history.
- A connection saved before sharing moves to the shared record on first load.
  If another app already saved a different one, that app keeps its own
  connection and offers **Use the shared connection…**; forgetting its own
  connection also returns it to the shared one.
- The bucket's CORS rules need only the site's origin, and the key must allow
  every app's backup path.

Both apps provide a **provider check** and a list of **earlier cloud backups**
under their cloud-storage settings. Compatibility checks create a small disposable
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
`<backup-path>.snapshots/`, with 20 entries per page, newest first. Bucket listing
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

Browsers keep device data per site address. Moving the apps to a new address
starts each app empty there: download a full backup (or make a cloud backup) at
the old address, then restore it at the new one. The four apps share one origin
on the site. Their storage keys, theme keys, service-worker scopes and cache
prefixes stay separate, and each app reacts only to its own storage events.
Deployment credentials and personal workout data are not part of this package.

### First run with a connection

A device that holds only an app's starting data (Liftlog's sample routines and
workouts, or the other apps' empty state) is *pristine*. Each app's storage
adapter says when its state is pristine; any edit ends it. A pristine device
never uploads its starting data.

- **Separate backup files:** saving the connection, or opening an app that finds
  one saved, lists this app's cloud backups. If any exist, a dialog offers
  **Restore latest…**, **Browse backups** or **Start fresh on this device**.
  Nothing uploads until one is chosen. Start fresh is remembered for this
  connection; dismissing the dialog asks again on the next load. With no
  backups, the first change saves the first one.
- **Conditional sync:** a pristine device takes the cloud copy and keeps its
  starting data as the recovery copy. With an empty cloud it uploads nothing
  until the first change.
- A first connection where this device and the cloud both hold different data
  has no shared history, so sync pauses and asks for **Keep local copy** or
  **Use cloud copy**. A conflict pauses sync, so a later edit cannot upload over
  the cloud copy before the choice.

## Separate backup files

The connection form has a **Backup mode** choice in every app. **Separate backup
files** is the default for every provider, including connections without a mode
setting. **Conditional sync** remains an explicit choice and requires enforced
write conditions. Existing single-object cloud backups are kept.

Each upload creates `<backup-path>.snapshots/<timestamp>-<random-UUID>.json` and
verifies the saved bytes by reading them back. It never writes a shared latest
pointer or automatically adopts another device’s data. Concurrent devices can
retain both versions even when a provider ignores write conditions. To reconcile,
download a full local backup,
browse cloud backups, preview and restore the desired copy. Bike can also merge
a downloaded backup’s ride history through **Merge history**; Liftlog has its own
history import. Restores stay paused until you choose **Resume backups…**, which
saves a new backup file from this device and resumes automatic uploads. Every
app shows the same cloud buttons: **Back up now** and **Pause cloud backups**
for separate files; **Sync now**, **Pause cloud sync** and **Use cloud copy…**
for conditional sync. Liftlog's resume dialog also offers **Restore latest cloud
backup**, which restores the newest backup file and then resumes. The former
single-object backup has no restore button; browse earlier cloud backups
instead.

This mode needs bucket-list permission to browse files, and GET/PUT with exposed
ETag. Every device must be able to reach the configured endpoint. Browsers
contact storage directly; hosting does not relay these requests.
Backups accumulate without automatic retention or deletion. Manage retention
on the storage server after verifying an off-device recovery copy. Compatibility
probe cleanup additionally needs DELETE; ordinary backups do not.

## Shared interface

Settings in every app begins with the same storage summary: saved on this
device, upload pending, backed up, cloud backups or cloud sync paused, offline,
or needs attention. Local save failures take priority over cloud success. **Backed up**
requires a confirmed cloud backup of the current revision, with no pending
changes. Connection tests alone cannot produce it. The summary shows the last
cloud backup and backup download separately, with a relevant next action and a
**Backup settings** button that opens the storage settings. A paused summary
names the recorded cause and time. With separate backups, **Resume backups** opens the resume confirmation.
With conditional sync, **Choose a copy** opens the existing choices; it does not
resume or replace data. Saving the connection again with new credentials keeps
the backup history; a different endpoint, region, bucket, object key, path
style or mode hides it. Every app's Settings says that the connection is shared
and names this app's backup path.

**Backups & cloud storage** is one shared panel
(`WorkoutStorage.createStoragePanel`) in all four apps, in this order:

1. Recovery copies, when present: the previous local copy (download, restore,
   discard) and unreadable saved data (download, discard). Liftlog opens the
   section by itself while either exists.
2. **Backup file**: what a full backup holds, the last backup, **Download full
   backup** and **Restore from file**.
3. **Device storage**: the app's data size and whether the browser may clear it,
   with **Request persistent storage** where asking can help.
4. **Cloud backup**: the bucket, the backup mode in one sentence, the mode's
   buttons and earlier cloud backups.
5. **Connection**: the shared connection form, **Check & save connection**,
   **Load config file**, **Save config file**, **Test read access** and
   **Forget connection…**. It stays collapsed after setup.
6. **Troubleshooting**: provider check, diagnostics and the last error,
   collapsed.

A config file from any app loads into the form for review; only a file from the
same app sets this app's backup path. Loading never saves: **Check & save
connection** applies it after a read check. **Move workout to another device**
is collapsed unless a workout is active or held.

Every app applies saved appearance in the document head before the main app starts.
The page canvas and body use the same explicit theme background, and the body
fills the viewport. Browser color hints and resolved light/dark schemes follow
the appearance on startup and theme changes. Native Android system-bar rendering
is controlled by the browser and must be checked on an installed app.

An installed app on Android also takes its system-bar colour from the manifest
`theme_color` and `background_color`. A manifest cannot follow the phone's dark
mode, so every app ships the same dark `#0d1824`; a white manifest colour shows a
white navigation bar under a dark theme. Chrome applies a changed manifest to an
installed app on a later launch; reinstalling applies it at once.

Every app uses the same themes, common controls and navigation. Contrast,
Lamplight, Forest, Blossom, Ink and Iron each have a light and a dark palette and follow
the device setting, like System. Dracula, Gruvbox, Nord, Solarized and Monokai are
dark only. Phones use labeled
bottom navigation; active workouts replace it with an action bar and a Menu button.
Other screens provide Return to workout without resetting or pausing the session.
Desktop keeps the same destinations in the header. Liftlog's Today destination is
now labeled Workout; existing view identities and keyboard shortcuts remain.

Bike's Workout screen contains the upcoming plan and optional ride adjustments.
Settings holds default targets/durations, sound, appearance, storage and updates.
Ride adjustments do not change defaults; saved defaults do not rewrite a running
ride's recorded plan. Bike's theme is stored as a device preference, outside workout
backups. Liftlog keeps its existing theme setting and backup compatibility.

Liftlog's set editor provides larger numeric adjustments using the configured load
step, saves only on confirmation, and contains the less frequent warm-up/delete
actions. Direct row entry and Done remain available. Shared frequent controls have
48px touch targets, and navigation/action bars yield space to the software keyboard.

When the last session met an exercise's full prescription (every working set at
the top of the rep range, and the target RIR when one is set), Liftlog starts the
next session's working sets at the suggested load: the last working load plus
the Settings load step. A planned routine weight still wins; hidden or stopped
suggestions seed the last load. Bodyweight work steps only a load that was
already added.

Each Library exercise can carry **instructions**: how to perform the movement,
up to 10,000 characters of Markdown. Notes stay a separate one-line field for
machine settings. Instructions support # to ### headings, **bold**, *italic*,
`code`, bulleted and numbered lists nested up to 3 levels, > quotes and ---
dividers; a single line break stays a line break. Links, images, tables, code
blocks and HTML show as typed. The add and edit forms have a Preview switch.
The exercise sheet shows the instructions, and during a workout an
**Instructions** button beside How to opens them over the session, with the rest
timer still running. They live on the Library exercise only, so sessions do not
store copies.

All three apps render Markdown with one shared renderer,
`packages/app-ui/markdown.js` (`WorkoutMarkdown`), bundled into every app with
the shared foundation. It escapes all text first and emits a fixed set of tags.
Notes allow `http`, `https` and `mailto` links, which open in a new tab without a
referrer: Liftlog workout notes and Bike plan and ride notes. Instructions
(Liftlog exercises, Tabata) show links as typed. Bike ride notes have the same
Preview switch as the instruction editors.

**Load suggestions** use the same words on Today, the routine sheet, the workout
and History → Progress. Each shows a state (Ready; Reps met, check RIR; RIR not
logged), the last result as load × reps, and the next load with the routine's rep
range. A planned routine weight replaces the suggested figure ("Planned 100 kg"),
since sessions start there. When a routine sets a target RIR and the last session
met the reps without RIR on every set, the exercise is listed as "RIR not logged"
with no suggestion and never changes a load. The workout card says what this
session's sets start at. Its ⋯ menu offers View last session, Hide until next
session, and Stop for the exercise; stopped suggestions resume under History →
Progress → Load suggestions by exercise.

Rest comes from Settings unless a library exercise sets its own (Exercises →
Edit → Rest after a set). The override belongs to the movement, so it rests the
same in every routine; the rest tag marks it "(this exercise)". Superset members
rest on separate timers, each for its own length: a logged set starts that
exercise's rest and hands over to the partner, and the action bar lists the
other rest still counting. Rest only separates sets of one exercise: an
exercise's last set starts no rest and stops any rest still counting for it,
alone or in a superset. Before any set is logged, **More… → Swap**
replaces the current exercise for that session only. The new one keeps the set
count, and the rep range and target RIR when both are counted the same way;
pairings carry over and the routine is unchanged.

A small **+ 2 warm-up sets** button above the set list adds warm-ups before the
first working set while nothing is logged yet. By default there are two, both for
the working set's reps (or the bottom of the target range when those are blank):
50% of its load with 1:00 rest after it, then 75% with 2:00 rest. Working sets
then rest for the normal time. **Settings → Warm-up sets** changes the steps:
1 to 4 warm-ups, each heavier than the one before, with its own rest. Loads round
to the load step. Steps that round to nothing, to the working load or to the
previous step are dropped, so light loads get fewer. Bodyweight work takes its
share of the added load; timed work gets none. Warm-ups count toward neither
volume nor records, and a swap drops them with the old movement's load.
The button also says whether the exercise's movement family (Exercises → Movement
family) has done working sets yet in this workout: "first horizontal push" when
it has not, or a note such as "horizontal push worked: Chest Press Machine" when
it has. Warm-ups do not count as work, and the families `other` and `cardio`
show neither.

History opens on **Sessions** (stats and the session list). **Progress** holds
progression flags, load results and the weekly chart; **Compare** holds the
two-workout comparison.

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
Bike migrates version 1 to 3 backups to version 4 and active sessions to version 3.
Version 4 records how resistance cues read (numbered console levels or by feel)
in place of a machine model; machines are named by their identifier or profile.
The history/backup and active-workout version numbers are independent.

Settings → Default targets & durations → **Calculate heart-rate targets** fills
the six heart-rate fields from maximum HR, heart-rate reserve (maximum and
resting HR) or threshold HR, and lists the five zones it used. Zone 2 is 60 to
70% of maximum HR or of the reserve, or 81 to 89% of threshold HR; the working
band, add-below point and comparison HR keep the proportions of the 105 to 122
default inside it. Nothing changes until **Save workout defaults**.

Measured heart rate also fills 5-second bins of active riding time. A finished
ride keeps them as a compact trace and derives the Zone 2 main-block average
(filling the main-block HR reading when at least 80% of the block was measured),
HR drift between the halves of a main block of 10 minutes or more, and the
60-second HR recovery after each sprint effort or the Zone 2 main block.

Any strap with the standard Bluetooth Heart Rate service connects. Workout →
**Sensors** lists the strap and **Bike power & cadence**; without Bluetooth it
shows one notice and no Connect buttons. Bike power & cadence optionally connects a smart bike, trainer or power meter
that uses the standard Fitness Machine (Indoor Bike Data) or Cycling Power
service; cadence from a power meter comes from its crank revolution counts.
Its readings fill 5-second bins like heart rate. A finished ride stores the
whole-ride average, the best 5 seconds and the trace; a Zone 2 ride also gets
main-block watts and cadence, watts within 2 bpm of the comparison HR (at least
a minute of it) and aerobic decoupling (watts per beat in the first half of a
main block of 10 minutes or more, against the second). At 80% main-block
coverage these fill the main-block watts, cadence and comparison readings.
During a ride with a live reading, a bar under Live HR shows the recorded zone,
the working target inside it and a marker for the current HR. The ride summary
shows these readings as tiles.

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
Progress charts show watts, main-block HR, duration, HR coverage, HR drift and
60-second HR recovery with an
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
