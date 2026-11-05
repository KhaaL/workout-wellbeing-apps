// Same-group adjacency: exercise groups, performed order, conflicts, the 3:00 rest, and the exclude-from-progression flag. node tests/adjacency.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

/* A library shaped like a real programme, with generic names. */
const lib = [
  ['db-bench', 'DB Bench Press', 'horizontal_push'], ['chest', 'Chest Press Machine', 'horizontal_push'], ['ohp', 'DB Overhead Press', 'vertical_push'],
  ['pulldown', 'Lat Pulldown', 'vertical_pull'], ['row', 'Seated Cable Row', 'horizontal_pull'], ['face-pull', 'Face Pull', 'other', 'back'],
  ['leg-ext', 'Leg Extension', 'squat'], ['leg-press', 'Leg Press', 'squat'], ['bss', 'Bulgarian Split Squat', 'squat'],
  ['sl-rdl', 'Single-Leg RDL', 'hinge'], ['leg-curl', 'Prone Leg Curl', 'hinge'], ['hip-thrust', 'Hip Thrust', 'hinge'],
  ['captain', "Captain's Chair Leg Raise", 'core'], ['pallof', 'Pallof Press', 'core'],
  ['band-pa', 'Band Pull-Apart', 'horizontal_pull', 'none'], ['sa-row', 'Single Arm Cable Row', 'horizontal_pull', 'none'], ['curl', 'Cable Curl', 'other']
].map(([id, name, movementFamily, group]) => ({ id, name, category:'Other', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily,
  ...(group ? { group } : {}), archived:false, notes:'', url:'' }));

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, toggleSet, exerciseGroup, performedOrder, orderConflict, progressionStatus, loadCueFor,
      validateBackup, importHistory, historyPayload, openDetail, get timer(){return timer}, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(lib => {
      const t = window.testAPI;
      t.state.exercises = lib; t.state.routines = []; t.state.workouts = []; t.state.activeWorkout = null;
      t.state.settings.autoRest = true;
      /* A finished workout from [exerciseId, warm-ups, working sets] steps, two minutes a set.
         `order` lists the stored rows when they differ from the order trained ("Start now" jumps). */
      window.mk = (id, day, steps, opts = {}) => {
        const start = Date.parse(day + 'T17:00:00Z'); let k = 0;
        const blocks = new Map();
        const set = warm => ({ id:id + '-' + k, weight:40, reps:8, rir:2, unit:'kg', completed:true,
          completedAt:opts.noTimes ? 0 : start + (k++) * 120000, ...(warm ? { countForVolume:false, countForPR:false } : {}) });
        for (const [exId, warm, work] of steps){
          if (!blocks.has(exId)){ const def = lib.find(e => e.id === exId);
            blocks.set(exId, { exerciseId:exId, name:def.name, unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:def.movementFamily,
              plannedSets:3, targetRepsMin:6, targetRepsMax:10, targetRir:2, notes:'', skipped:false, sets:[] }); }
          const b = blocks.get(exId);
          for (let i = 0; i < warm; i++) b.sets.push(set(true));
          for (let i = 0; i < work; i++) b.sets.push(set(false));
        }
        const order = opts.order || [...blocks.keys()];
        return { id, routineName:'Day', startedAt:start, finishedAt:start + 3600000, notes:'', exercises:order.map(x => blocks.get(x)) };
      };
    }, lib);

    /* 1. Every exercise gets a group: the movement family's default, or its own. */
    const groups = await page.evaluate(() => Object.fromEntries(window.testAPI.state.exercises.map(e => [e.name, window.testAPI.exerciseGroup(e)])));
    assert.deepEqual(groups, {
      'DB Bench Press':'press', 'Chest Press Machine':'press', 'DB Overhead Press':'press',
      'Lat Pulldown':'back', 'Seated Cable Row':'back', 'Face Pull':'back',
      'Leg Extension':'quads', 'Leg Press':'quads', 'Bulgarian Split Squat':'quads',
      'Single-Leg RDL':'posterior', 'Prone Leg Curl':'posterior', 'Hip Thrust':'posterior',
      "Captain's Chair Leg Raise":'core', 'Pallof Press':'core',
      'Band Pull-Apart':'none', 'Single Arm Cable Row':'none', 'Cable Curl':'none' });

    const conflicts = (w) => page.evaluate(w => {
      const t = window.testAPI;
      return t.performedOrder(w).map(ex => { const c = t.orderConflict(w, ex); return [ex.name, c ? c.by.name : null]; });
    }, w);

    /* 2. A 5 Nov shape: row then face pull conflicts, leg curl then hip thrust too; OHP last follows face pull (back), no conflict. */
    const nov5 = await page.evaluate(() => window.mk('nov5', '2026-11-05', [['leg-curl', 1, 3], ['hip-thrust', 1, 3], ['db-bench', 2, 3], ['row', 1, 3], ['face-pull', 0, 3], ['ohp', 1, 3]]));
    assert.deepEqual(await conflicts(nov5), [['Prone Leg Curl', null], ['Hip Thrust', 'Prone Leg Curl'], ['DB Bench Press', null],
      ['Seated Cable Row', null], ['Face Pull', 'Seated Cable Row'], ['DB Overhead Press', null]]);

    /* 3. Rehab is group none: face pull then single-arm row warns nothing, and a band pull-apart between row and face pull is passed over. */
    const sep30 = await page.evaluate(() => window.mk('sep30', '2026-09-30', [['face-pull', 0, 3], ['sa-row', 0, 2]]));
    assert.deepEqual(await conflicts(sep30), [['Face Pull', null], ['Single Arm Cable Row', null]]);
    const between = await page.evaluate(() => window.mk('between', '2026-10-01', [['row', 0, 3], ['band-pa', 0, 2], ['face-pull', 0, 3]]));
    assert.deepEqual((await conflicts(between))[2], ['Face Pull', 'Seated Cable Row'], 'a group-none exercise in between does not break the conflict');

    /* 4. Performed order comes from set times: OHP second on 28 Oct although its row is stored last. */
    const oct28 = await page.evaluate(() => window.mk('oct28', '2026-10-28', [['sl-rdl', 1, 3], ['ohp', 1, 3], ['pulldown', 1, 3], ['db-bench', 1, 3]],
      { order:['sl-rdl', 'pulldown', 'db-bench', 'ohp'] }));
    assert.deepEqual((await conflicts(oct28)).map(([n]) => n), ['Single-Leg RDL', 'DB Overhead Press', 'Lat Pulldown', 'DB Bench Press']);
    assert.deepEqual((await conflicts(oct28))[1], ['DB Overhead Press', null], 'OHP after the RDL: no conflict');

    /* 5. Supersets: press with back alternates freely; row with face pull conflicts. */
    const pressBack = await page.evaluate(() => window.mk('ss1', '2026-10-02', [['db-bench', 0, 1], ['row', 0, 1], ['db-bench', 0, 1], ['row', 0, 1], ['db-bench', 0, 1], ['row', 0, 1]]));
    assert.deepEqual(await conflicts(pressBack), [['DB Bench Press', null], ['Seated Cable Row', null]]);
    const backBack = await page.evaluate(() => window.mk('ss2', '2026-10-03', [['row', 0, 1], ['face-pull', 0, 1], ['row', 0, 1], ['face-pull', 0, 1]]));
    assert.deepEqual(await conflicts(backBack), [['Seated Cable Row', null], ['Face Pull', 'Seated Cable Row']]);

    /* 6. Without set times the stored order stands in. */
    const untimed = await page.evaluate(() => window.mk('untimed', '2026-08-01', [['face-pull', 0, 2], ['row', 0, 2]], { noTimes:true, order:['row', 'face-pull'] }));
    assert.deepEqual(await conflicts(untimed), [['Seated Cable Row', null], ['Face Pull', 'Seated Cable Row']]);

    /* 7. A flagged exposure between two normal ones changes neither the stall count nor the load suggestion. */
    const progression = await page.evaluate(() => {
      const t = window.testAPI;
      const at = (id, day, reps) => { const w = window.mk(id, day, [['db-bench', 0, 3]]); w.exercises[0].sets.forEach(s => { s.reps = reps; }); return w; };
      const runs = flagged => {
        const middle = at('b', '2026-10-08', 7);
        if (flagged) middle.exercises[0].excludeFromProgression = { reason:'sleep', note:'5 h' };
        t.state.workouts = [at('a', '2026-10-01', 8), middle, at('c', '2026-10-15', 8), at('d', '2026-10-22', 8)];
        const s = t.progressionStatus('db-bench');
        return { streak:s.streak, latest:s.latest.workoutId };
      };
      const without = () => { t.state.workouts = [at('a', '2026-10-01', 8), at('c', '2026-10-15', 8), at('d', '2026-10-22', 8)]; const s = t.progressionStatus('db-bench'); return { streak:s.streak, latest:s.latest.workoutId }; };
      const cue = flagLatest => {
        const last = at('z', '2026-10-29', 6);
        if (flagLatest) last.exercises[0].excludeFromProgression = { reason:'order-conflict' };
        t.state.workouts = [at('y', '2026-10-22', 10), last];
        return !!t.loadCueFor('db-bench', { sets:3, repsMin:6, repsMax:10, targetRir:2 });
      };
      return { flagged:runs(true), unflagged:runs(false), removed:without(), cueFlagged:cue(true), cueUnflagged:cue(false) };
    });
    assert.deepEqual(progression.flagged, progression.removed, 'a flagged session counts as if it were not there');
    assert.notDeepEqual(progression.unflagged, progression.removed, 'unflagged, the weaker session resets the count');
    assert.equal(progression.cueFlagged, true, 'the suggestion reads the last session that counts');
    assert.equal(progression.cueUnflagged, false);

    /* 8. Live: the overview marks the pair, the panel warns, the clock runs the rest of 3:00, targets stay. */
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.workouts = [];
      t.state.routines = [{ id:'r-pull', name:'Pull', items:[
        { id:'i1', exerciseId:'row', sets:2, repsMin:8, repsMax:12, targetRir:2, weight:50 },
        { id:'i2', exerciseId:'face-pull', sets:2, repsMin:12, repsMax:15, targetRir:2, weight:20 }] }];
      t.startRoutine('r-pull'); t.navigate('today');
      t.ui.overviewOpen = true; t.render();
    });
    assert.equal(await page.locator('.overview-row').nth(1).locator('.status-chip.warm').first().textContent(), 'Same group as Seated Cable Row');
    await page.evaluate(() => {
      const t = window.testAPI; t.ui.overviewOpen = false;
      const row = t.state.activeWorkout.exercises[0];
      row.sets.forEach(s => t.toggleSet(s.id));
    });
    const live = await page.evaluate(() => {
      const t = window.testAPI, fp = t.state.activeWorkout.exercises[1];
      return { current:t.state.activeWorkout.currentExerciseIndex, running:t.timer.running, seconds:t.timer.seconds,
        note:(document.querySelector('#main .order-warn p') || {}).textContent, targets:[fp.targetRepsMin, fp.targetRepsMax, fp.sets[0].weight] };
    });
    assert.equal(live.current, 1);
    assert.equal(live.note, 'Seated Cable Row just done (same group): rest 3:00, expect fewer reps.');
    assert.ok(live.running && live.seconds > 170 && live.seconds <= 180, 'the clock runs what is left of 3:00: ' + live.seconds);
    assert.deepEqual(live.targets, [12, 15, 20], 'targets and loads stay as planned');
    assert.match(await page.locator('#main .ex-tags .tag').nth(1).textContent(), /rest 3:00 \(same group\)/, 'the rest tag agrees with the clock');

    /* The suggestion is one tap and reversible; nothing is flagged until then. */
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[1].excludeFromProgression), undefined, 'never flagged on its own');
    await page.locator('#main [data-action="exclude-suggested"]').click();
    assert.deepEqual(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[1].excludeFromProgression), { reason:'order-conflict' });
    await page.locator('#main [data-action="exclude-clear"]').click();
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[1].excludeFromProgression), undefined);

    /* A wait already spent at the station counts: after 3:20 nothing is added. */
    const waited = await page.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.ui.groupGapFor = null; t.startRoutine('r-pull'); t.navigate('today');
      const w = t.state.activeWorkout;
      w.exercises[0].sets.forEach(s => t.toggleSet(s.id));
      w.exercises[0].sets.forEach(s => { s.completedAt -= 200000; });
      t.timer.running = false; t.timer.done = false; t.timer.remaining = t.timer.total; t.ui.groupGapFor = null; t.render();
      return t.timer.running;
    });
    assert.equal(waited, false);

    /* Exclude all, live, with a reason and a note. */
    await page.evaluate(() => { const t = window.testAPI; t.ui.overviewOpen = true; t.render(); });
    await page.locator('[data-action="exclude-all"]').click();
    const ask = page.getByRole('dialog', { name:'Exclude all exercises from progression?' });
    await ask.locator('[name="reason"]').selectOption('illness');
    await ask.locator('[name="note"]').fill('fever');
    await ask.getByRole('button', { name:'Exclude' }).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.exercises.every(ex => ex.excludeFromProgression));
    assert.deepEqual(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.map(ex => ex.excludeFromProgression)),
      [{ reason:'illness', note:'fever' }, { reason:'illness', note:'fever' }]);
    await page.locator('[data-action="include-all"]').click();
    assert.ok(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.every(ex => !ex.excludeFromProgression)), 'reversible');

    /* History: performed order, the same-group note and the exclusion marker; Edit session sets the flag per exercise. */
    await page.evaluate(nov5 => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.ui.overviewOpen = false;
      nov5.exercises[1].excludeFromProgression = { reason:'order-conflict' };
      t.state.workouts = [nov5]; t.navigate('history'); t.openDetail('workout', 'nov5');
    }, { ...nov5, exercises:[...nov5.exercises].reverse() });
    const sheet = page.locator('#detail-dlg');
    assert.deepEqual(await sheet.locator('.hist-ex h4').evaluateAll(hs => hs.map(h => h.childNodes[0].textContent.trim())),
      ['Prone Leg Curl', 'Hip Thrust', 'DB Bench Press', 'Seated Cable Row', 'Face Pull', 'DB Overhead Press'], 'the order trained, not the stored order');
    assert.deepEqual(await sheet.locator('.order-note').allTextContents(),
      ['Same group After Prone Leg Curl (posterior)', 'Same group After Seated Cable Row (back)', 'Not in progression Order conflict']);
    assert.match(await page.locator('.hist-row').first().textContent(), /Not in progression/, 'the History row carries a marker');
    await page.evaluate(() => { const t = window.testAPI; t.ui.detail = null; t.ui.editWorkoutId = 'nov5'; t.render(); });
    const select = page.locator('[data-change="hex-exclude"]').nth(0);
    await select.selectOption('sleep');
    assert.deepEqual(await page.evaluate(() => window.testAPI.state.workouts[0].exercises[0].excludeFromProgression), { reason:'sleep' });

    /* Data: invalid values are refused in backups; a history file keeps the flag; the library editor sets a group by hand. */
    const verdicts = await page.evaluate(() => {
      const t = window.testAPI, copy = () => JSON.parse(JSON.stringify(t.state));
      const check = s => { try { t.validateBackup(s); return 'ok'; } catch (e) { return e.message; } };
      const badGroup = copy(); badGroup.exercises[0].group = 'arms';
      const badReason = copy(); badReason.workouts[0].exercises[0].excludeFromProgression = { reason:'tired' };
      return [check(copy()), check(badGroup), check(badReason)];
    });
    assert.equal(verdicts[0], 'ok');
    assert.match(verdicts[1], /exercises\[0\]\.group: expected one of press, back, quads, posterior, core, none/);
    assert.match(verdicts[2], /excludeFromProgression\.reason: expected one of order-conflict, sleep, illness, injury, other/);
    const kept = await page.evaluate(async () => {
      const t = window.testAPI, file = t.historyPayload(t.state.workouts);
      t.state.workouts = [];
      t.importHistory(new File([JSON.stringify(file)], 'h.json', { type:'application/json' }));
      await new Promise(r => setTimeout(r, 80));
      return t.state.workouts[0].exercises.filter(ex => ex.excludeFromProgression).map(ex => ex.excludeFromProgression.reason);
    });
    assert.deepEqual(kept.sort(), ['order-conflict', 'sleep']);

    assert.deepEqual(errors, []);
    console.log('adjacency: 34 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
