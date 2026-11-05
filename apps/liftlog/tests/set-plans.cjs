// Per-set plans: import, the rows a workout starts with, per-set targets and roles, implements, progression, volume and validation. node tests/set-plans.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

const BENCH = '64e8a621-047e-45d3-ad3d-654ce2469441';
const routinesFile = {
  app:'liftlog', kind:'routines',
  exercises:[
    { id:BENCH, name:'Bench Press', category:'Push', unit:'kg', loadMode:'total' },
    { id:'ex-chest', name:'Chest Press', category:'Push', unit:'kg', loadMode:'machine_stack', equipmentKey:'chest-press-a' },
    { id:'ex-db', name:'Dumbbell Press', category:'Push', unit:'kg', loadMode:'total' }
  ],
  routines:[{ id:'rt-push', name:'Push A', items:[
    { id:'it-1105-4', exerciseId:BENCH, sets:3, repsMin:6, repsMax:10, targetRir:2, weight:55, implementCount:2, setPlan:[
      { type:'warmup', weight:30, reps:8, restSec:45 },
      { type:'warmup', weight:45, reps:4, restSec:90 },
      { type:'working', weight:55, repsMin:6, repsMax:10, targetRir:2 },
      { type:'working', weight:55, repsMin:6, repsMax:10, targetRir:2 },
      { type:'working', weight:55, repsMin:6, repsMax:10, targetRir:2 }] },
    /* sets says 4 but the plan has 3 non-warm-up entries: the plan wins */
    { id:'it-chest', exerciseId:'ex-chest', sets:4, repsMin:6, repsMax:12, targetRir:1, weight:70, setPlan:[
      { type:'warmup', weight:41, reps:8 },
      { type:'warmup', weight:59, reps:3 },
      { type:'top', weight:70, repsMin:6, repsMax:8, targetRir:1 },
      { type:'backoff', weight:59, repsMin:10, repsMax:12, targetRir:2 },
      { type:'backoff', weight:59, repsMin:10, repsMax:12, targetRir:2 },
      { type:'tempo', weight:1 }] },
    { id:'it-db', exerciseId:'ex-db', sets:3, repsMin:8, repsMax:12, weight:45, implementCount:2 }
  ] }]
};

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, planRoutineImport, applyRoutineImport, validateBackup, prepareBackup, cascadeWeight,
      loadCueFor, progressionStatus, workoutVolume, routineById, newRoutineDraft, get timer(){return timer}, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');

    /* Import keeps the plan, drops unknown entry types, and lets the plan decide the set count. */
    const items = await page.evaluate(file => {
      const t = window.testAPI;
      t.state.exercises = []; t.state.routines = []; t.state.workouts = []; t.state.activeWorkout = null;
      t.state.settings.autoRest = true; t.state.settings.effortMetric = 'none';
      t.applyRoutineImport(t.planRoutineImport(file), new Map());
      return t.state.routines[0].items.map(it => ({ sets:it.sets, plan:it.setPlan ? it.setPlan.map(e => e.type).join() : null, implements:it.implementCount ?? null }));
    }, routinesFile);
    assert.deepEqual(items, [
      { sets:3, plan:'warmup,warmup,working,working,working', implements:2 },
      { sets:3, plan:'warmup,warmup,top,backoff,backoff', implements:null },
      { sets:3, plan:null, implements:2 }], 'the plan survives import; "tempo" is dropped; sets follows the plan');

    /* The workout starts with one row per planned set. */
    await page.evaluate(() => { const t = window.testAPI; t.startRoutine('rt-push'); t.navigate('today'); });
    const rows = () => page.evaluate(() => window.testAPI.state.activeWorkout.exercises[window.testAPI.state.activeWorkout.currentExerciseIndex].sets
      .map(s => [s.weight, s.reps, s.restSeconds ?? null, s.countForVolume === false ? 'W' : s.role || '', s.targetRepsMin ?? null, s.targetRepsMax ?? null, s.targetRir ?? null]));
    assert.deepEqual(await rows(), [
      [30, 8, 45, 'W', null, null, null], [45, 4, 90, 'W', null, null, null],
      [55, null, null, '', 6, 10, 2], [55, null, null, '', 6, 10, 2], [55, null, null, '', 6, 10, 2]],
      'warm-ups arrive tagged with load, count and rest; working rows carry load and target');
    const marks = () => page.locator('#main .set-num').evaluateAll(bs => bs.map(b => (b.querySelector('.wu, .role') || {}).textContent || ''));
    assert.deepEqual(await marks(), ['W', 'W', '', '', ''], 'the warm-up rows are marked W');
    assert.equal(await page.locator('#main .ex-tags').count(), 0, 'no target tag: each row shows its own target');
    assert.equal(await page.locator('#main .sets-head').textContent().then(t => t.includes('RIR')), true, 'a planned RIR shows the RIR column');
    assert.equal(await page.locator('#main .implement-split').first().textContent(), '2 × 15', 'each load says what one implement weighs');
    assert.ok(await page.evaluate(() => { const row = document.querySelector('#main .set-row:not(.is-done)'), [load, reps] = row.querySelectorAll('input');
      const a = load.getBoundingClientRect(), b = reps.getBoundingClientRect(), split = row.querySelector('.implement-split').getBoundingClientRect();
      return Math.abs(a.top - b.top) < 1 && split.top >= a.top && split.bottom <= a.bottom; }), 'the split sits inside the load box, level with the other boxes');

    /* A warm-up rests for its own time; warm-ups stay out of volume. */
    await page.locator('.set-done-btn').nth(0).click();
    assert.equal(await page.evaluate(() => window.testAPI.timer.seconds), 45, 'the first warm-up rests 0:45');

    /* Top and back-off rows carry their own targets. */
    await page.evaluate(() => { const t = window.testAPI; t.state.activeWorkout.currentExerciseIndex = 1; t.render(); });
    assert.deepEqual((await rows()).slice(2), [[70, null, null, 'top', 6, 8, 1], [59, null, null, 'backoff', 10, 12, 2], [59, null, null, 'backoff', 10, 12, 2]]);
    assert.deepEqual(await marks(), ['W', 'W', 'T', 'B', 'B'], 'top and back-off rows are marked T and B');
    assert.deepEqual(await page.locator('#main .row-role').evaluateAll(els => els.filter(e => e.offsetParent).map(e => e.textContent)), ['W', 'W', 'T', 'B', 'B'],
      'below 400px, where the set number is hidden, a badge on each row carries the letter');
    assert.equal(await page.locator('#main .set-done-btn').nth(2).getAttribute('aria-label'), 'Mark set 3 (top set) as done', 'the done button names the role');
    assert.deepEqual(await page.locator('#main .set-row [data-field="targetRir"], #main .set-row [data-field="rir"]').evaluateAll(els => els.map(e => e.placeholder)).then(p => p.slice(2)), ['1', '2', '2'],
      'each row shows its own RIR target');
    const placeholders = await page.locator('#main .set-row [data-field="reps"]').evaluateAll(els => els.map(e => e.placeholder));
    assert.deepEqual(placeholders.slice(2), ['6–8', '10–12', '10–12'], 'each row shows its own range');
    assert.equal(await page.locator('#main .implement-split').count(), 0, 'a machine stack has no implements');

    /* A load typed on the top set never fills a blank back-off row. */
    const kept = await page.evaluate(() => {
      const t = window.testAPI, ex = t.state.activeWorkout.exercises[1];
      ex.sets[3].weight = null; ex.sets[4].weight = null; t.render();
      t.cascadeWeight(ex.sets[2].id, 72);
      return ex.sets.map(s => s.weight);
    });
    assert.deepEqual(kept, [41, 59, 72, null, null]);

    /* Logging: an untouched row logs its own lower bound. */
    await page.evaluate(() => { const ex = window.testAPI.state.activeWorkout.exercises[1]; ex.sets[2].weight = 70; ex.sets[3].weight = 59; ex.sets[4].weight = 59; window.testAPI.render(); });
    for (let i = 0; i < 5; i++) await page.locator('#main .set-row:not(.is-done) .set-done-btn').first().click();
    const logged = await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[1].sets.map(s => [s.completed, s.reps]));
    assert.deepEqual(logged, [[true, 8], [true, 3], [true, 6], [true, 10], [true, 10]], 'warm-ups keep their count; others log their own lower bound');

    /* The dumbbell total updates its split as it is typed. */
    await page.evaluate(() => { const t = window.testAPI; t.state.activeWorkout.currentExerciseIndex = 2; t.render(); });
    await page.locator('#main .set-row input[data-field="weight"]').first().fill('50');
    await page.locator('#main .set-row input[data-field="weight"]').first().press('Tab');
    assert.deepEqual(await page.locator('#main .implement-split').allTextContents(), ['2 × 25', '2 × 22.5', '2 × 22.5']);

    /* Volume counts top and back-off sets and leaves the warm-ups out. */
    const volume = await page.evaluate(() => {
      const t = window.testAPI, w = t.state.activeWorkout;
      return [t.workoutVolume({ ...w, exercises:[w.exercises[1]] }), 70 * 6 + 59 * 10 * 2];
    });
    assert.equal(volume[0], volume[1]);

    /* Progression holds each set to its own target: the top set to 8 at RIR 1, the back-offs to 12 at RIR 2. */
    const finishWith = (top, backoff) => page.evaluate(([top, backoff]) => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.startRoutine('rt-push');
      const w = t.state.activeWorkout, ex = w.exercises[1];
      [top, ...backoff].forEach(([reps, rir], i) => Object.assign(ex.sets[i + 2], { reps, rir, completed:true, completedAt:Date.now() + i }));
      ex.sets.slice(0, 2).forEach(s => Object.assign(s, { completed:true, completedAt:Date.now() }));
      w.exercises = [ex]; w.finishedAt = Date.now() + 1000; w.startedAt = Date.now() + t.state.workouts.length * 60000;
      t.state.workouts.unshift(w); t.state.activeWorkout = null;
      const item = t.routineById('rt-push').items[1], status = t.progressionStatus('ex-chest');
      return { ready:status.ready, load:status.latest && status.latest.load, cue:!!t.loadCueFor('ex-chest', item) };
    }, [top, backoff]);
    assert.deepEqual(await finishWith([8, 1], [[12, 2], [11, 2]]), { ready:false, load:70, cue:false }, 'one back-off short of 12: not ready');
    assert.deepEqual(await finishWith([8, 1], [[12, 2], [12, 2]]), { ready:true, load:70, cue:true }, 'every set at its own top: ready, and the top set load leads');
    assert.deepEqual(await finishWith([8, 0], [[12, 2], [12, 2]]), { ready:false, load:70, cue:false }, 'the top set at RIR 0 misses its RIR 1 target');

    /* Backups validate the plan. */
    const verdicts = await page.evaluate(() => {
      const t = window.testAPI, copy = () => JSON.parse(JSON.stringify(t.state));
      const check = s => { try { t.validateBackup(s); return 'ok'; } catch (e) { return e.message; } };
      const badType = copy(); badType.routines[0].items[0].setPlan[0].type = 'drop';
      const badCount = copy(); badCount.routines[0].items[0].sets = 4;
      const badRole = copy(); badRole.workouts[0].exercises[0].sets[2].role = 'amrap';
      return [check(copy()), check(badType), check(badCount), check(badRole)];
    });
    assert.equal(verdicts[0], 'ok');
    assert.match(verdicts[1], /setPlan\[0\]\.type: expected one of warmup, working, top, backoff/);
    assert.match(verdicts[2], /items\[0\]\.sets: expected the number of non-warm-up setPlan entries \(3\)/);
    assert.match(verdicts[3], /sets\[2\]\.role: expected one of top, backoff/);

    /* The routine editor shows the plan in words and can drop it. */
    await page.evaluate(() => { const t = window.testAPI; t.navigate('today'); t.ui.routineDraft = t.newRoutineDraft(t.routineById('rt-push')); t.render(); });
    const summaries = await page.locator('.set-plan-summary > span').allTextContents();
    assert.deepEqual(summaries, ['Set plan · 2 warm-ups · 3 × 6–10 @ 55 (2 × 27.5) RIR 2',
      'Set plan · 2 warm-ups · top 1 × 6–8 @ 70 RIR 1 · back-off 2 × 10–12 @ 59 RIR 2']);
    assert.equal(await page.locator('#main [data-bind="ritem"][data-idx="0"]').count(), 0, 'no fields to edit that the plan would override');
    await page.locator('[data-action="ritem-clear-plan"][data-idx="1"]').click();
    assert.equal(await page.evaluate(() => window.testAPI.ui.routineDraft.items[1].setPlan), undefined);
    assert.equal(await page.locator('#main [data-bind="ritem"][data-idx="1"]').count(), 4, 'its own sets, reps, RIR and load come back');

    assert.deepEqual(errors, []);
    console.log('set-plans: 31 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
