// Straight sets only + superset warnings: the rule, the routine editor, the pair dialog (routine and live workout), import review, the Library toggle and old files. node tests/superset-warning.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

/* A library with generic names: [id, name, movementFamily, group, straightSetsOnly]. */
const lib = [
  ['bss', 'Bulgarian Split Squat', 'squat', null, true],
  ['hip-thrust', 'Hip Thrust (Machine A)', 'hinge'],
  ['row', 'Seated Cable Row (neutral grip)', 'horizontal_pull'],
  ['face-pull', 'Face Pull', 'other', 'back'],
  ['db-bench', 'DB Bench Press', 'horizontal_push'],
  ['chest', 'Chest Press Machine', 'horizontal_push'],
  ['pulldown', 'Lat Pulldown (neutral grip)', 'vertical_pull'],
  ['pallof', 'Pallof Press', 'core'],
  ['band-pa', 'Band Pull-Apart', 'horizontal_pull', 'none'],
  ['leg-press', 'Leg Press', 'squat', null, true],
  ['leg-ext', 'Leg Extension', 'squat']
].map(([id, name, movementFamily, group, straight]) => ({ id, name, category:'Other', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily,
  ...(group ? { group } : {}), ...(straight ? { straightSetsOnly:true } : {}), archived:false, notes:'', url:'' }));

const item = (id, exerciseId, extra = {}) => ({ id, exerciseId, sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null, ...extra });
const withPlan = (id, exerciseId, extra = {}) => item(id, exerciseId, { sets:2, setPlan:[
  { type:'working', weight:40, repsMin:6, repsMax:8, targetRir:2 }, { type:'working', weight:40, repsMin:6, repsMax:8, targetRir:2 }], ...extra });
/* The routines the editor flows use: the same flagged pair in three of them. */
const routines = () => [
  { id:'r1', name:'Split me', items:[item('i1', 'band-pa', { sets:1 }), withPlan('i2', 'bss', { supersetOf:'k1' }), item('i3', 'hip-thrust', { supersetOf:'k1' }), item('i4', 'pallof', { sets:2 })] },
  { id:'r2', name:'Keep me', items:[withPlan('j1', 'bss', { supersetOf:'k2' }), item('j2', 'hip-thrust', { supersetOf:'k2' })] },
  { id:'r3', name:'Same pair, another routine', items:[item('l1', 'hip-thrust', { supersetOf:'k3' }), item('l2', 'bss', { supersetOf:'k3' })] },
  { id:'r4', name:'Clean pair', items:[item('m1', 'db-bench', { supersetOf:'k4' }), item('m2', 'row', { supersetOf:'k4' })] }
];

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, openPairDialog, newRoutineDraft, prepareBackup, supersetWarning, exerciseById,
      get state(){return state}, get ui(){return ui} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const reset = () => page.evaluate(([lib, routines]) => {
      const t = window.testAPI;
      t.state.exercises = lib; t.state.routines = routines; t.state.workouts = []; t.state.activeWorkout = null;
      t.ui.routineDraft = null; t.ui.exerciseDraft = null; t.ui.showExerciseForm = false;
      window.pair = (a, b) => t.supersetWarning(t.exerciseById(a), t.exerciseById(b));
      t.navigate('routines');
    }, [lib, routines()]);
    await reset();
    const warn = (a, b) => page.evaluate(([a, b]) => window.pair(a, b), [a, b]);
    const state = path => page.evaluate(path => JSON.parse(JSON.stringify(window.testAPI[path])), path);
    const edit = id => page.evaluate(id => { const t = window.testAPI; t.ui.routineDraft = t.newRoutineDraft(t.state.routines.find(r => r.id === id)); t.render(); }, id);
    const save = async () => { await page.click('#routine-form button[type="submit"]'); await page.waitForFunction(() => !window.testAPI.ui.routineDraft); };
    const flags = page.locator('#routine-form .superset-warning');

    /* 1-7. The rule: a straight-sets-only exercise, or two in one group that is not none. */
    assert.deepEqual(await warn('bss', 'hip-thrust'), ['Bulgarian Split Squat is straight-sets-only']);
    assert.deepEqual(await warn('row', 'face-pull'), ['both in group back']);
    assert.deepEqual(await warn('db-bench', 'row'), []);
    assert.deepEqual(await warn('chest', 'pulldown'), []);
    assert.deepEqual(await warn('pallof', 'face-pull'), []);
    assert.deepEqual(await warn('band-pa', 'face-pull'), [], 'group none never triggers the group rule');
    assert.deepEqual(await warn('leg-press', 'db-bench'), ['Leg Press is straight-sets-only'], 'the groups differ');
    assert.deepEqual(await warn('band-pa', 'band-pa'), [], 'two exercises in group none');
    assert.deepEqual(await warn('bss', 'leg-press'), ['Bulgarian Split Squat is straight-sets-only', 'Leg Press is straight-sets-only', 'both in group quads'],
      'both conditions show both reasons, a reason for each flagged exercise');
    assert.deepEqual(await warn('leg-press', 'leg-ext'), ['Leg Press is straight-sets-only', 'both in group quads']);
    console.log('PASS the superset rule: straight sets only, shared group, group none, both reasons');

    /* Routine editor: the warning sits on the flagged pair only, with both actions. */
    await edit('r4'); assert.equal(await flags.count(), 0, 'a clean pair shows nothing');
    await edit('r1'); assert.equal(await flags.count(), 1);
    assert.match(await flags.textContent(), /Bulgarian Split Squat is straight-sets-only/);
    assert.deepEqual(await flags.locator('button').allTextContents(), ['Keep superset', 'Split into straight sets']);
    const rowAfter = await page.evaluate(() => { const w = document.querySelector('#routine-form .superset-warning'); return w.previousElementSibling.classList.contains('superset-last'); });
    assert.equal(rowAfter, true, 'the warning follows the second row of the pair');

    /* 9. Split into straight sets: the link goes from both items; order, sets and set plans stay. */
    const before = (await routines()).find(r => r.id === 'r1').items;
    await flags.locator('[data-action="superset-split"]').click();
    assert.equal(await flags.count(), 0);
    await save();
    const after = (await state('state')).routines.find(r => r.id === 'r1').items;
    assert.deepEqual(after.map(({ supersetOf, ...rest }) => rest), before.map(({ supersetOf, ...rest }) => rest), 'order, sets, set plans and loads are untouched');
    assert.ok(after.every(it => !it.supersetOf), 'both items lost the link');
    assert.equal((await state('state')).routines.find(r => r.id === 'r1').keptSupersets, undefined);
    console.log('PASS Split into straight sets removes only the link');

    /* 10. Keep superset: that pair, that routine. */
    await edit('r2'); await flags.locator('[data-action="superset-keep"]').click();
    assert.equal(await flags.count(), 0, 'the warning goes');
    await save();
    assert.deepEqual((await state('state')).routines.find(r => r.id === 'r2').keptSupersets, ['bss|hip-thrust']);
    await edit('r2'); assert.equal(await flags.count(), 0, 'it stays kept when the routine is opened again');
    await page.evaluate(() => { window.testAPI.ui.routineDraft = null; window.testAPI.render(); });
    await edit('r3'); assert.equal(await flags.count(), 1, 'the same pair in another routine warns again');
    await page.evaluate(() => { window.testAPI.ui.routineDraft = null; window.testAPI.render(); });
    /* a kept pair that is split loses its keep; a new partner is a new pair */
    await edit('r2'); await page.evaluate(() => { const d = window.testAPI.ui.routineDraft; d.items.forEach(it => { delete it.supersetOf; }); d.items[1].exerciseId = 'leg-press'; d.items.forEach(it => { it.supersetOf = 'k9'; }); window.testAPI.render(); });
    assert.equal(await flags.count(), 1, 'another partner is another pair: it warns');
    await save();
    assert.equal((await state('state')).routines.find(r => r.id === 'r2').keptSupersets, undefined, 'a kept choice that names no superset any more is dropped');
    console.log('PASS Keep superset is per pair and per routine');

    /* The pair dialog warns before a superset is made, never blocks, and the choice to go on is the answer. */
    await reset();
    await page.evaluate(() => {
      const t = window.testAPI; t.ui.routineDraft = { id:null, name:'New', items:[
        { id:'n1', exerciseId:'bss', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null }, { id:'n2', exerciseId:'hip-thrust', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null },
        { id:'n3', exerciseId:'row', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null }] };
      t.render(); t.openPairDialog('routine', 'supersetOf');
    });
    const dialog = page.locator('#pair-dlg');
    await page.selectOption('#pair-first', '1'); await page.selectOption('#pair-second', '2');
    assert.equal(await page.locator('#pair-warning').isVisible(), false, 'hip thrust and a row: nothing to say');
    assert.equal((await page.textContent('#pair-add')).trim(), 'Create superset');
    await page.selectOption('#pair-first', '0'); await page.selectOption('#pair-second', '1');
    assert.match(await page.textContent('#pair-warning'), /Bulgarian Split Squat is straight-sets-only.*still create the superset/);
    assert.equal((await page.textContent('#pair-add')).trim(), 'Create superset anyway');
    assert.equal(await page.evaluate(() => window.testAPI.ui.routineDraft.items.some(it => it.supersetOf)), false, 'nothing is paired before the button');
    await page.click('#pair-add'); await dialog.waitFor({ state:'hidden' });
    assert.equal(await page.evaluate(() => window.testAPI.ui.routineDraft.items.filter(it => it.supersetOf).length), 2);
    assert.deepEqual(await page.evaluate(() => window.testAPI.ui.routineDraft.keptSupersets), ['bss|hip-thrust'], 'going on from the dialog keeps it');
    assert.equal(await flags.count(), 0, 'no second warning for a pair already asked about');
    console.log('PASS the routine pair dialog warns, then goes on when asked');

    /* A workout in progress: the same warning before the pairing is confirmed. */
    await reset();
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.routines = [{ id:'live', name:'Live', items:[
        { id:'a1', exerciseId:'bss', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null }, { id:'a2', exerciseId:'hip-thrust', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null },
        { id:'a3', exerciseId:'db-bench', sets:3, repsMin:8, repsMax:10, targetRir:2, weight:null }] }];
      t.startRoutine('live'); t.openPairDialog('session', 'supersetOf');
    });
    await page.selectOption('#pair-first', '0'); await page.selectOption('#pair-second', '1');
    assert.match(await page.textContent('#pair-warning'), /Bulgarian Split Squat is straight-sets-only/);
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.some(ex => ex.supersetOf)), false, 'not paired while the warning is up');
    await page.selectOption('#pair-second', '2');
    assert.match(await page.textContent('#pair-warning'), /Bulgarian Split Squat is straight-sets-only/, 'still the straight-sets exercise');
    await page.click('#pair-add'); await dialog.waitFor({ state:'hidden' });
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.filter(ex => ex.supersetOf).length), 2, 'it pairs when you go on');
    assert.equal(await page.evaluate(() => 'keptSupersets' in window.testAPI.state.activeWorkout), false, 'the routine and the workout record keep nothing extra');
    console.log('PASS the live workout pairing warns before it is confirmed');

    /* Import review: flagged supersets are listed per routine, the import goes on, nothing is rewritten. */
    await reset();
    await page.evaluate(() => { const t = window.testAPI; t.state.exercises = []; t.state.routines = []; t.navigate('routines'); });
    const file = (routines, exercises, schemaVersion = '1.17.0') => ({ name:'routines.json', mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify({ app:'liftlog', kind:'routines', schemaVersion, source:'test', exercises, routines })) });
    const exDef = (id, name, movementFamily, extra = {}) => ({ id, name, category:'Legs', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily, archived:false, notes:'', url:'', ...extra });
    const exercises = [exDef('x1', 'Bulgarian Split Squat', 'squat', { straightSetsOnly:true }), exDef('x2', 'Hip Thrust (Machine A)', 'hinge'),
      exDef('x3', 'DB Bench Press', 'horizontal_push'), exDef('x4', 'Seated Cable Row (neutral grip)', 'horizontal_pull')];
    const fileRoutines = [{ name:'Flagged day', items:[item('f1', 'x1', { supersetOf:'p' }), item('f2', 'x2', { supersetOf:'p' })] },
      { name:'Clean day', items:[item('c1', 'x3', { supersetOf:'q' }), item('c2', 'x4', { supersetOf:'q' })] }];
    const picker = page.locator('#main input[data-change="import-routines"]').first();
    await picker.setInputFiles(file(fileRoutines, exercises));
    const review = page.locator('#import-match-dlg');
    await review.waitFor({ state:'visible' });
    assert.equal(await page.textContent('#import-match-title'), 'Review imported supersets');
    const listed = await page.textContent('#import-superset-flags');
    assert.match(listed, /Flagged day: Bulgarian Split Squat \+ Hip Thrust \(Machine A\) \(Bulgarian Split Squat is straight-sets-only\)/);
    assert.doesNotMatch(listed, /Clean day/, 'only flagged supersets are listed');
    await page.click('#import-match-cancel'); await review.waitFor({ state:'hidden' });
    assert.equal((await state('state')).routines.length, 0, 'cancel changes nothing');
    await picker.setInputFiles(file(fileRoutines, exercises));
    await review.waitFor({ state:'visible' }); await page.click('#import-match-ok'); await review.waitFor({ state:'hidden' });
    await page.waitForFunction(() => window.testAPI.state.routines.length === 2);
    const imported = await state('state');
    assert.equal(imported.routines.length, 2, 'the import is never blocked');
    assert.equal(imported.routines.find(r => r.name === 'Flagged day').items.filter(it => it.supersetOf).length, 2, 'the superset is imported as written');
    assert.equal(imported.exercises.find(e => e.name === 'Bulgarian Split Squat').straightSetsOnly, true, 'the flag comes with the exercise');
    assert.equal(imported.exercises.find(e => e.name === 'Hip Thrust (Machine A)').straightSetsOnly, undefined);
    console.log('PASS import review lists flagged supersets and never blocks');

    /* A file with no flagged superset imports without the extra step; and an old file without the field reads as false everywhere. */
    await page.evaluate(() => { const t = window.testAPI; t.state.exercises = []; t.state.routines = []; t.render(); });
    await picker.setInputFiles(file([fileRoutines[1]], exercises.slice(2), '1.15.0'));
    await page.waitForFunction(() => window.testAPI.state.routines.length === 1);
    assert.equal(await review.evaluate(d => d.open), false, 'no dialog for a file with nothing to flag');
    assert.ok((await state('state')).exercises.every(e => !e.straightSetsOnly), 'a 1.15 routines file imports as false');
    console.log('PASS older routine files import unchanged');

    /* 8. Older backups: every exercise false, no errors; the new fields survive a round trip and bad values are refused. */
    await reset();
    const old = await page.evaluate(() => {
      const t = window.testAPI, out = {};
      for (const version of [15, 16]){
        const data = JSON.parse(JSON.stringify(t.state)); data.version = version;
        data.exercises.forEach(e => { delete e.straightSetsOnly; }); data.routines.forEach(r => { delete r.keptSupersets; });
        const prepared = t.prepareBackup(data);
        out[version] = { version:prepared.version, flagged:prepared.exercises.filter(e => e.straightSetsOnly).length, count:prepared.exercises.length };
      }
      const full = t.prepareBackup(JSON.parse(JSON.stringify({ ...t.state, routines:t.state.routines.map(r => r.id === 'r2' ? { ...r, keptSupersets:['bss|hip-thrust'] } : r) })));
      out.round = { flagged:full.exercises.filter(e => e.straightSetsOnly).map(e => e.name), kept:full.routines.find(r => r.id === 'r2').keptSupersets };
      const bad = patch => { const d = JSON.parse(JSON.stringify(t.state)); patch(d); try { t.prepareBackup(d); return 'accepted'; } catch (e) { return e.message; } };
      out.bad = [bad(d => { d.exercises[0].straightSetsOnly = 'yes'; }), bad(d => { d.routines[0].keptSupersets = 'x'; })];
      return out;
    });
    for (const version of [15, 16]){
      assert.deepEqual(old[version], { version:17, flagged:0, count:lib.length }, 'a ' + version + ' file without the field: the schema moves to 17 and every exercise is false');
    }
    assert.deepEqual(old.round, { flagged:['Bulgarian Split Squat', 'Leg Press'], kept:['bss|hip-thrust'] });
    assert.match(old.bad[0], /straightSetsOnly.*boolean/); assert.match(old.bad[1], /keptSupersets.*array/);
    console.log('PASS old backups read as false; the new fields round trip; bad values are refused');

    /* The Library toggle: new exercise, edit, tag, detail. */
    await reset();
    await page.evaluate(() => { window.testAPI.state.exercises.forEach(e => { delete e.straightSetsOnly; }); window.testAPI.navigate('exercises'); window.testAPI.ui.showExerciseForm = true; window.testAPI.render(); });
    assert.equal(await page.locator('[data-form="ex-new"] label[for="ex-new-straight"] strong').textContent(), 'Straight sets only');
    assert.match(await page.locator('[data-form="ex-new"] label[for="ex-new-straight"] .hint').textContent(), /^Heavy or technical lift that needs full rest — warn when paired in a superset$/);
    await page.fill('[data-form="ex-new"] input[name="exname"]', 'Heavy Carry');
    await page.locator('[data-form="ex-new"] .switch').click();
    await page.click('[data-form="ex-new"] button[type="submit"]');
    await page.waitForFunction(() => window.testAPI.state.exercises.some(e => e.name === 'Heavy Carry'));
    assert.equal((await state('state')).exercises.find(e => e.name === 'Heavy Carry').straightSetsOnly, true);
    assert.equal(await page.locator('.ex-row', { hasText:'Heavy Carry' }).locator('.tag', { hasText:'Straight sets only' }).count(), 1, 'the list shows it for review');
    await page.evaluate(() => { const t = window.testAPI; t.ui.exerciseDraft = JSON.parse(JSON.stringify(t.state.exercises.find(e => e.name === 'Heavy Carry'))); t.render(); });
    assert.equal(await page.isChecked('#ex-edit-straight'), true);
    await page.locator('#ex-edit-form .switch').click();
    await page.click('#ex-edit-form button[type="submit"]');
    await page.waitForFunction(() => !window.testAPI.ui.exerciseDraft);
    assert.equal((await state('state')).exercises.find(e => e.name === 'Heavy Carry').straightSetsOnly, undefined, 'switched off, the field is gone (false)');
    console.log('PASS the Library toggle on new and existing exercises');

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
