# Test suite

Run these commands from the repository root with Node.js 22.13 or later and Python 3:

```sh
npm ci
npm run lint
npm test
npm run test:s3-cors
npx playwright install --only-shell chromium
npm run test:browser
```

`npm test` rebuilds all three apps and runs the workout, shared storage and Liftlog
remote and safe-clear scenarios, plus Tabata timing/schema checks.
`npm run test:browser` runs all browser suites. Set
`BROWSER_PATH` to an existing Chromium executable to use that browser instead.
All scenarios use synthetic records, isolated storage and mocked cloud requests.

| Location | Coverage |
|---|---|
| `tabata.test.cjs` | Tabata phase boundaries, delayed callbacks, zero rest, pause/resume, checkpoints, instructions, data version 2 and backup validation |
| `foodlog.test.cjs` | Foodlog free sugars, micronutrient targets, favourites, copying meals, 7-day trends, day import (linking by id, name and values, new foods, filled values, add and replace, sample round trip), catalog import, merge and export round trip, frozen versions, totals with unknowns, day changes, search with stable ranking and match quality, start amounts, day export, validation and storage versions |
| `foodlog-phase2-browser.cjs` | Foodlog free sugar marks, vitamins and minerals panel, copying a meal with undo, favourites, vitamin editing, micronutrient targets and 7-day trends at phone width |
| `foodlog-browser.cjs` | Foodlog at phone width under its CSP: format help and sample downloads, day import preview, undo and replace, catalog import and targets, portions, quick-created foods, unknown fibre, edit and undo, day export, history, archiving, settings, backup restore and 320 px layouts |
| `foodlog-logging-browser.cjs` | Foodlog add sheet: one-tap + at the start amount, a list that keeps its order, undo and edits inside the open sheet, per-meal start amounts, no clock time on earlier days, a search that stays in view and selects the last query on tap, and the search, Enter, amount, Enter keyboard path |
| `tabata-instructions-browser.cjs` | Tabata instructions at phone width: editor and Preview, run-screen pop-out over a running timer, focus return, close on finish, reload and blank text |
| `tabata-browser.cjs` | Mobile layout, quick setups, wake-lock release/reacquisition, recovery, file/cloud backups, data isolation, CSP, safe updates, offline shell and direct HTTP/file source previews |
| `workout-core.test.cjs` | Phase skipping, HR gates, custom targets/durations and comparable history series |
| `bike-modules.test.cjs` | Canonical HR parsing, Bluetooth reconnects, stale notifications, visibility and manual fallback |
| `s3-cors.test.py` | Explicit signed headers, per-origin rules, unrelated-origin preservation, rollback and CLI failure paths |
| `shared/features.test.cjs` | Cached history serialization, unchanged backups, file/cloud handoff, cancellation, stale reviews, receipts, failed writes and comparison semantics |
| `shared/features-browser.cjs` | Two mobile profiles, held-source reload, paused receipt, comparison layout and selected/OS theme colour matrix |
| `shared/storage.test.cjs` | Migration, save failures, restore, configuration transfer, stable comparison, history merge/clear, recovery, conflicts and independent uploads despite ignored write conditions |
| `shared/bike-plans-browser.cjs` | Bike planned sessions at phone width: paste and check a plan, use it, confirm conditions, effort prompts and the cadence rule, effort table, conditions, baseline comparison, stale-input protection and plan deletion |
| `shared/connection.test.cjs` | Shared cloud connection across two apps' engines: per-app paths and history, history tied to its destination, moving older connections, switching, forgetting and storage events |
| `shared/connection-browser.cjs` | Shared connection on one local origin: save in Tabata, use in Foodlog, separate backup paths, live change in an open app, Bike and Liftlog text, switching an app's own connection, forgetting everywhere |
| `shared/site.test.cjs` | Built site: one security policy per page, exact inline hashes per app, separate manifest identities and scopes, home page links and redirects |
| `shared/settings-parity-browser.cjs` | All four apps on one origin: Settings section order, status card, one h1, theme list, an identical Backups & cloud storage panel (parts, fields, buttons), and the same cloud buttons for separate files and conditional sync, running and paused; no legacy restore |
| `shared/site-browser.cjs` | Whole site from one local origin with the root `_headers`, `_redirects` and 404 page: home page, trailing-slash redirects, three worker scopes and caches, offline launches |
| `shared/markdown.test.cjs` | Shared Markdown renderer: supported subset, escaping, hostile input, optional safe links and bounded rendering time |
| `shared/bike-notes-browser.cjs` | Bike plan notes as Markdown in the plan preview and on setup, safe links only, and the ride notes Preview switch |
| `shared/browser.cjs` | Bike UI, production CSP, history editing/merging, backup/restore, configuration transfer, persistence, reminders, cloud and mobile layout |
| `shared/updates-browser.cjs` | Real local service-worker install/update, multiple-tab workout deferral, saved-workout protection, retained data and offline version |
| `shared/updates.test.cjs` | Startup/foreground/reconnect update checks, throttling, delayed waiting-state notification and active-workout protection |
| `shared/liftlog-library-browser.cjs` | Planned-workout preview, archive/unarchive, hidden history and picker entries, focus return, reload, retained workout blocks, session exercise swap and per-exercise rest |
| `shared/theme-bars-browser.cjs` | Saved theme before main scripts, full-height canvas/body backgrounds, browser hints, every appearance under both OS color schemes, and live theme changes |
| `shared/app-ui-browser.cjs` | Shared themes, phone/desktop navigation, touch targets, ride defaults versus adjustments, set-editor drafts and preserved active workouts/timers |
| `shared/remote-tools-browser.cjs` | Both apps with production CSP and generated browser CORS: provider probes, independent SigV4 verification, diagnostics redaction, mode-aware connection tests, global newest-first ordering across provider pages, local pagination/preview/download/restore and mobile layout |
| `../apps/liftlog/tests/remote.cjs` | Signing, conditional writes, retries, races and recovery |
| `../apps/liftlog/tests/clear.cjs` | Bulk-clear recovery, active workouts, cancellation, concurrent edits and storage failures |
| `../apps/liftlog/tests/regression.cjs` | Liftlog workflows, persistence and mobile layout |
| `../apps/liftlog/tests/security.cjs` | Backup validation, migrations, hostile inputs and unreadable-data recovery |
| `../apps/liftlog/tests/recovery.cjs` | Paused restore, review, reload and explicit cloud publication |

Browser and Liftlog suites load the built apps in `dist/`; `npm test` and the
browser npm scripts build first, and a direct `node` run needs `npm run build`.
Liftlog's harness replaces the single `/* @test-seam */` marker in the served
test copy with an internal test handle. The shipped app exposes no test handle.
Browser screenshots go to `/tmp`; the root GitHub workflow retains screenshots
when a check fails. Layout can vary slightly with the locally installed fonts.
