// Set density and warm-up cues: logged sets as one line of text, and the overview's "First <group>" chip. node tests/density.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

const ex = (id, name, category, family = 'other') => ({ id, name, category, unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:family, archived:false, notes:'', url:'' });

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const start = (exercises, ids) => page.evaluate(({ exercises, ids }) => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.state.workouts = [];
      t.state.exercises = exercises;
      t.state.routines = [{ id:'r1', name:'Day', items:ids.map((id, i) => ({ id:'i' + i, exerciseId:id, sets:3, repsMin:6, repsMax:8, weight:100 })) }];
      t.state.settings.effortMetric = 'rpe'; t.state.settings.autoRest = false;
      t.startRoutine('r1'); t.navigate('today');
    }, { exercises, ids });

    /* Logged sets: one line of text that opens the editor; open sets keep their inputs. */
    await start([ex('bench', 'Bench Press', 'Push')], ['bench']);
    const rows = page.locator('#main .set-row');
    const openHeight = await rows.nth(0).evaluate(r => r.getBoundingClientRect().height);
    await page.locator('#main #sw-' + await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets[0].id)).fill('100');
    await page.locator('.set-done-btn').nth(0).click();
    const done = rows.nth(0);
    assert.ok(await done.evaluate(r => r.classList.contains('is-compact')), 'a logged set is drawn compact');
    assert.equal(await done.locator('input').count(), 0, 'a logged set has no inputs');
    assert.equal((await done.locator('.set-summary').textContent()).trim(), '1100 × 6', 'the line reads number, load and the logged count, without the unit');
    assert.equal(await rows.nth(1).locator('input').count(), 3, 'an open set keeps weight, reps and RPE');
    const doneHeight = await done.evaluate(r => r.getBoundingClientRect().height);
    assert.ok(doneHeight <= openHeight - 10, 'the logged row is shorter: ' + doneHeight + 'px against ' + openHeight + 'px');

    await done.locator('.set-summary').click();
    const editor = page.getByRole('dialog', { name:'Edit set 1' });
    assert.equal(await editor.locator('input').count(), 3, 'the editor still holds every field of a logged set');
    assert.deepEqual(await editor.locator('label.field > span:first-child').allTextContents(), ['Weight in kg', 'Reps, target 6–8', 'RPE'],
      'captions leave out the set number the heading already gives');
    assert.deepEqual(await editor.locator('button:not([data-step])').evaluateAll(bs => bs.filter(b => !b.closest('.numeric-stepper')).map(b => b.textContent)),
      ['Cancel', 'Save changes', 'Mark as warm-up', 'Delete set 1…'], 'Cancel and Save first, the rarer set changes below; no Remove exercise');
    assert.equal(await editor.locator('input').first().inputValue(), '100');
    await editor.locator('input').nth(1).fill('8');
    await editor.locator('input').nth(2).fill('8.5');
    await editor.getByRole('button', { name:'Save changes', exact:true }).click();
    assert.equal((await done.locator('.set-text').textContent()).trim(), '100 × 8 · RPE 8.5', 'the line shows the saved edit and the effort');
    assert.equal(await page.evaluate(() => document.activeElement.id.startsWith('sd-')), true, 'focus returns to the set');

    await page.locator('.set-done-btn').nth(0).click();
    assert.equal(await rows.nth(0).locator('input').count(), 3, 'un-logging a set gives its inputs back');
    assert.equal(await rows.nth(0).locator('input').nth(1).inputValue(), '8');
    await page.locator('.set-done-btn').nth(0).click();
    await page.locator('.set-done-btn').nth(0).click({ delay:700 });
    assert.ok(await rows.nth(0).evaluate(r => r.classList.contains('is-warmup')), 'a long press on a logged set still marks a warm-up');
    assert.match(await rows.nth(0).locator('.set-summary').getAttribute('aria-label'), /^Edit set 1, warm-up: 100 kg × 8 · RPE 8\.5$/);

    /* The More… menu can skip the exercise; the overview then marks it skipped. */
    await start([ex('bench', 'Bench Press', 'Push'), ex('row', 'Row', 'Pull')], ['bench', 'row']);
    await page.locator('#main [data-action="exercise-menu"]').click();
    const menu = page.getByRole('dialog', { name:'More for Bench Press' });
    assert.deepEqual(await menu.getByRole('button').allTextContents(), ['Swap for another exercise…', 'Skip exercise', 'Exclude from progression…', 'Remove exercise…', 'Cancel']);
    await menu.getByRole('button', { name:'Skip exercise' }).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.currentExerciseIndex === 1, null, { timeout:2000 }).catch(() => {});
    assert.deepEqual(await page.evaluate(() => { const w = window.testAPI.state.activeWorkout; return [w.exercises[0].skipped, w.currentExerciseIndex]; }), [true, 1],
      'skipping marks the exercise and moves to the next one');

    /* The load step sits with the weight unit in Settings, outside the rest timer. */
    await page.evaluate(() => window.testAPI.navigate('settings'));
    assert.equal(await page.locator('#load-step').evaluate(i => i.closest('.setting-block').querySelector('h3').textContent), 'Weights');

    /* The overview marks the first exercise of each fresh muscle group. */
    await start([ex('squat', 'Squat', 'Legs', 'squat'), ex('rdl', 'Romanian Deadlift', 'Hinge', 'hinge'), ex('bench', 'Bench Press', 'Push', 'horizontal_push'),
      ex('ohp', 'Overhead Press', 'Push', 'vertical_push'), ex('row', 'Row', 'Pull', 'horizontal_pull'), ex('plank', 'Plank', 'Core', 'core')],
      ['squat', 'rdl', 'bench', 'ohp', 'row', 'plank']);
    const chips = () => page.evaluate(() => {
      const t = window.testAPI; t.ui.overviewOpen = true; t.render();
      return [...document.querySelectorAll('.overview-row')].map(r => {
        const chip = [...r.querySelectorAll('.status-chip.warm')].find(c => c.textContent.startsWith('First'));
        return chip ? chip.textContent : '';
      });
    });
    assert.deepEqual(await chips(), ['First quads', 'First posterior', 'First press', '', 'First back', 'First core'],
      'one chip per muscle group, from each exercise\'s group');
    await page.evaluate(() => { const w = window.testAPI.state.activeWorkout; w.exercises.splice(2, 0, w.exercises.splice(3, 1)[0]); });
    assert.deepEqual((await chips()).slice(2, 4), ['First press', ''], 'reordering moves the chip to the new first exercise');
    await page.evaluate(() => { const w = window.testAPI.state.activeWorkout; w.exercises[0].sets[0].completed = true; w.exercises[0].sets[0].completedAt = Date.now(); w.exercises[0].sets[0].countForVolume = false; });
    assert.equal((await chips())[0], 'First quads', 'a warm-up does not make the group worked');
    await page.evaluate(() => { const s = window.testAPI.state.activeWorkout.exercises[0].sets[1]; s.completed = true; s.completedAt = Date.now(); s.weight = 100; s.reps = 6; });
    assert.deepEqual((await chips()).slice(0, 2), ['', 'First posterior'], 'once a working set is logged the group has no chip');
    await page.evaluate(() => { window.testAPI.state.activeWorkout.exercises[2].skipped = true; });
    assert.deepEqual((await chips()).slice(2, 4), ['', 'First press'], 'a skipped exercise passes the chip on');

    assert.deepEqual(errors, []);
    console.log('density: 24 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
