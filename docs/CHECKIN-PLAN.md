# Check-in: implementation plan

Check-in is a fifth app at `/checkin/` for logging symptoms and mental health
in one to four taps. It reuses the shared storage engine, shell, themes,
Settings flows and build pipeline exactly as Tabata and Foodlog do.
"Check-in" and the `checkin` id are working names; rename before phase 1 lands.

## Goals and limits

- A check-in from a cold app start takes 2 taps (mood, Done) and at most
  4 taps with one symptom and its severity.
- No typing on the common path. Notes stay optional and collapsed.
- Every tap saves at once with Undo in the toast. No Save button on Today.
- Local-first. Cloud backup uses the shared connection, like every other app.
- No diagnosis, scoring advice or clinical claims. The app records and shows
  what the user entered.

Out of scope for the first release: push reminders (they need a push server),
medication schedules, questionnaires, and sharing with other people.

## Source layout

The layout copies Foodlog, the newest app (`app.js` plus a pure core plus a
storage adapter). Bike Cardio keeps most code inline in `index.html`, so it
serves as a pattern source for baseline comparison only.

| File | Role |
|---|---|
| `apps/checkin/index.html` | Markup, marker pairs for shared code, one h1 per view |
| `apps/checkin/checkin-core.js` | Pure functions: schema, validation, day keys, merge window, summaries, export. No DOM |
| `apps/checkin/storage-adapter.js` | `CheckinStorage.create()`: `prepare`, seed, `createLocal`, `createRemote`, `restore` |
| `apps/checkin/app.js` | Shell, views, events, Settings composition |
| `apps/checkin/service-worker.js` | Copy of Foodlog's 16-line worker with the update-worker marker |
| `apps/checkin/manifest.webmanifest`, icons | Own scope, name and icons (svg, 180, 192, 512, maskable 512) |
| `apps/checkin/README.md` | Tap counts per task, like `apps/foodlog/README.md` |

## Data model (version 1)

```js
{
  app: 'checkin', version: 1, updatedAt,
  settings: { dayStart: '04:00', mergeMinutes: 30 },
  items: [ // what can be tracked; user-defined, seeded with a small default set
    { id, kind: 'mood'|'symptom'|'number'|'tag', name, pinned, order, archived,
      unit?, min?, max?, step? }       // number items only
  ],
  entries: [ // one check-in
    { id, at /* ms */, day /* 'YYYY-MM-DD' after dayStart */, note?,
      values: { [itemId]: number|true } } // mood 1..5, symptom severity 1..3, number, tag true
  ]
}
```

- Mood is one item of kind `mood` on a 1 to 5 scale with fixed labels.
  A second mood-like item (anxiety, energy) is a `symptom` or `mood` item the
  user adds.
- Symptom severity is 1 (mild), 2 (moderate) or 3 (severe). Absent means not
  recorded, and the app never treats it as 0. This mirrors Foodlog's rule that
  a blank value is unknown.
- Items are referenced by id. Renaming an item renames it in history.
  Archiving hides it from Today and keeps its history. Deleting an item with
  entries is refused, with Archive offered.
- `day` uses the same day-change rule as Foodlog (default 04:00), so a
  01:30 check-in counts toward the evening before.
- Limits for `WorkoutStorage.enforceLimits`: 200 items, 50,000 entries
  (ten check-ins a day for about 13 years).

The `prepare` function follows the Tabata adapter: reject newer versions with
"Update the app" wording, reject foreign `app` ids, validate every row and
rebuild state from known fields only.

## Today: the few-taps screen

```
[ Today  ‹ Thu 6 Nov › ]
Mood     ( 1 )( 2 )( 3 )( 4 )( 5 )        <- one tap saves
Symptoms [Headache] [Fatigue] [Nausea] [+]  <- tap records mild, then a row: Mild Moderate Severe ×
Context  [Coffee] [Alcohol] [Poor sleep]   <- tag chips, tap toggles
Sleep    [ − 7.5 h + ]                     <- number items use shared steppers
▸ Note
Today: 09:12 mood 3, headache mild · 21:40 mood 4
```

- Merge window: taps within `mergeMinutes` (default 30) of the latest
  check-in edit that check-in. Later taps start a new one. This keeps one
  row per sitting without a Start or Save step.
- Pinned items show on Today. Unpinned, unarchived items sit under **More…**
  in a sheet with search, ordered like Foodlog's add sheet: used today,
  pinned, most used, name.
- The **+** chip creates a symptom or tag inline from a name (one field,
  Enter). Kind defaults to the row it was tapped in.
- The day list under the controls shows each check-in. Tapping one opens it
  for edit, time change or removal. Undo covers every change.
- Earlier days: ‹ and › change the day, as in Foodlog. A check-in added to an
  earlier day asks for a time once and defaults to 12:00.

Tap counts to verify in the browser test:

| Task | Taps |
|---|---|
| Mood only | 1 (app open on Today) |
| Mood and one mild symptom | 2 |
| One severe symptom | 2 |
| Add a note | 2 plus typing |

## History

- Last 7 days compared with the 28 days before, per tracked item: days with
  the symptom, mean severity, mean mood. This reuses Bike Cardio's
  "finished ride versus baseline" idea and the shared
  `packages/app-ui/comparisons.js` helpers.
- One row per day: a mood dot strip and symptom chips with severity.
- A per-item view: a 30-day strip (one cell per day, empty when not
  recorded). Charts stay CSS and inline SVG, because the CSP forbids
  external scripts.
- No correlation claims in phase 1 or 2. Co-occurrence counts ("headache on
  6 of 9 days with poor sleep") are a phase 3 candidate, labelled as counts.

## Settings

The order follows `AGENTS.md`:

1. Storage status (shared card)
2. App preferences: **Tracked items** (pin, order, archive, add) and
   **Check-in** (day change time, merge window). Each control saves on
   change, because each holds one value.
3. Appearance (shared)
4. Backups & cloud storage: `WorkoutStorage.createStoragePanel({appName:
   'Check-in', namespace: 'checkin.v1', ...})`, with wording for what a
   backup holds
5. App data files: **Export period as CSV** and **Export as JSON** for a
   chosen date range, for sharing with a clinician
6. App updates (shared)
7. Advanced & destructive actions: **Delete all check-ins…**, which confirms
   and keeps a recovery copy

No "Move to another device" section: Check-in has no resumable session.

## Shared wiring (same change as the app)

The list matches the files the Foodlog commit (`f339907`) touched.

- `scripts/build.mjs`: add `checkin` to `apps`, `appModules`
  (`checkin-core.js`, `storage-adapter.js`, `app.js`), the asset list and the
  theme-bootstrap key rewrite (`checkin.ui.theme`).
- `packages/app-ui/foundation.js`: a nav icon for Today only if the existing
  `today` path does not fit; History and Settings exist already.
- `eslint.config.mjs`: globals block for `apps/checkin/*.js` and the worker.
- `package.json`: `test:checkin-browser`, the core test in `test`, and the
  browser suite in `test:browser`.
- `.github/workflows/tests.yml`: a Check-in browser suite step.
- `site/index.html`, `site/404.html`: a fifth app card and link.
- `STORAGE.md`: object path row `checkin-backup.json`. `README.md`: app
  section. `docs/CHECKIN.md`: file formats.
- Shared tests that enumerate apps: `settings-parity-browser.cjs`,
  `site.test.cjs`, `site-browser.cjs`, `connection*.cjs`,
  `first-run-browser.cjs`, `theme-bars-browser.cjs`.

## Tests

- `tests/checkin.test.cjs`: `prepare` accepts and rejects (newer version,
  foreign app, duplicate ids, unknown item ids, out-of-range values), day
  keys around 04:00 and DST changes, merge window edges, summaries with
  missing values, CSV escaping.
- `tests/checkin-browser.cjs`: phone width under the built CSP, the tap
  counts in the table above, Undo, offline reload, recovery of an
  unreadable state, restore from a backup file.
- Settings parity: add the Check-in section order to `APPS` in
  `tests/shared/settings-parity-browser.cjs`.

## Phases

1. Done. App folder, adapter, build, site card, Settings with shared
   panels (tracked items, timing, Delete all check-ins…), parity test green.
   Today with mood, pinned symptoms on a 3-level scale, a note, the merge
   window and Undo. History lists days and check-ins. About 850 lines with
   tests.
   Ongoing symptoms (added after phase 1): symptom value 0 means gone (data
   version 2). A symptom recorded mild or worse in the last 7 days shows in an
   Ongoing row with all four levels, so one tap records it each day. **+
   Other** on Today records a new symptom as mild and adds it unpinned.
2. Usable daily: number and tag items, More… sheet, edit and remove a
   check-in, earlier days, a 7 versus 28 day comparison in History, CSV and
   JSON export.
3. Candidates after a few weeks of real use: co-occurrence counts, per-item
   strips, optional periodic questionnaires, a home-screen shortcut that
   opens Today with mood focused.

## Open decisions

- Name and id (`checkin` is a placeholder). Renaming later changes the
  storage namespace, so it needs a migration once real data exists.
- Severity scale: decided, 3 levels.
- Mood scale: 5 faces or labels, or a two-axis mood and energy grid.
- Backup privacy: the shared engine uploads plain JSON to the user's own
  bucket. Client-side encryption would be a shared-engine change for every
  app, so it belongs in its own change if wanted.
