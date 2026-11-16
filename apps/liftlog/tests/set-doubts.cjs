// Logging asks first when a count looks like a typo: reps over twice the planned maximum, or 0 reps with an RIR. node tests/set-doubts.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.exercises = [{ id:'press', name:'Chest Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' },
        { id:'plank', name:'Plank', category:'Core', unit:'time', loadMode:'total', equipmentKey:'', movementFamily:'core', archived:false, notes:'', url:'' }];
      t.state.workouts = []; t.state.activeWorkout = null;
      t.state.routines = [{ id:'r', name:'Upper', items:[{ id:'i1', exerciseId:'press', sets:4, repsMin:8, repsMax:10, targetRir:2, weight:40 },
        { id:'i2', exerciseId:'plank', sets:1, repsMin:30, repsMax:30 }] }];
      t.startRoutine('r'); t.navigate('today');
    });
    const sets = () => page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets.map(s => [s.completed, s.reps, s.rir ?? null]));
    const row = n => page.locator('#main .set-row').nth(n);
    const confirm = page.getByRole('dialog', { name:/Check set/ });

    /* 1. 21 reps for a 10 max asks; Cancel leaves the set open with its figures. */
    await row(0).locator('[data-field="reps"]').fill('21');
    await row(0).locator('.set-done-btn').click();
    await confirm.waitFor();
    assert.match(await confirm.textContent(), /21 reps is more than twice the planned maximum of 10/);
    await confirm.getByRole('button', { name:'Cancel' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.deepEqual((await sets())[0], [false, 21, null], 'Cancel logs nothing');

    /* 2. Log set keeps the figures and logs it. */
    await row(0).locator('.set-done-btn').click();
    await confirm.getByRole('button', { name:'Log set' }).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.exercises[0].sets[0].completed);
    assert.deepEqual((await sets())[0], [true, 21, null]);

    /* 3. Exactly twice the maximum, and an untouched row, log without asking. */
    await page.locator('#main .set-row:not(.is-done) [data-field="reps"]').first().fill('20');
    await page.locator('#main .set-row:not(.is-done) .set-done-btn').first().click();
    await page.locator('#main .set-row:not(.is-done) .set-done-btn').first().click();
    assert.equal(await confirm.count(), 0, 'no question for 20 reps or the 8-rep default');
    assert.deepEqual((await sets()).slice(1, 3), [[true, 20, null], [true, 8, null]]);

    /* 4. 0 reps with an RIR asks; a placeholder RIR alone does not count. */
    await page.locator('#main .set-row:not(.is-done) [data-field="reps"]').first().fill('0');
    await page.locator('#main .set-row:not(.is-done) [data-field="rir"]').first().fill('2');
    await page.locator('#main .set-row:not(.is-done) .set-done-btn').first().click();
    await confirm.waitFor();
    assert.match(await confirm.textContent(), /0 reps is recorded with RIR 2/);
    await confirm.getByRole('button', { name:'Cancel' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await page.locator('#main .set-row:not(.is-done) [data-field="rir"]').first().fill('');
    await page.locator('#main .set-row:not(.is-done) .set-done-btn').first().click();
    assert.equal(await confirm.count(), 0, '0 reps with no RIR is a failed set and logs at once');
    assert.deepEqual((await sets())[3], [true, 0, null]);

    /* 5. The set editor asks before saving doubtful figures on a logged set. */
    await page.evaluate(() => { const t = window.testAPI; t.state.activeWorkout.currentExerciseIndex = 0; t.render(); });
    await page.locator('#main .set-row.is-done .set-summary').nth(1).click();
    const editor = page.locator('dialog.numeric-editor');
    await editor.locator('input[data-field="reps"]').fill('25');
    await editor.getByRole('button', { name:'Save changes' }).click();
    await confirm.waitFor();
    await confirm.getByRole('button', { name:'Cancel' }).click();
    assert.equal(await editor.evaluate(d => d.open), true, 'Cancel returns to the editor');
    assert.equal((await sets())[1][1], 20, 'and saves nothing');
    await editor.getByRole('button', { name:'Save changes' }).click();
    await confirm.getByRole('button', { name:'Save changes' }).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.exercises[0].sets[1].reps === 25);

    /* 6. A timed set has no rep target to compare with. */
    await page.evaluate(() => { const t = window.testAPI; t.state.activeWorkout.currentExerciseIndex = 1; t.render(); });
    await page.locator('#main .set-row [data-field="durationSeconds"]').first().fill('90');
    await page.locator('#main .set-row .set-done-btn').first().click();
    assert.equal(await confirm.count(), 0, 'no question for a 90 s hold against 30 s');

    assert.deepEqual(errors, []);
    console.log('set-doubts: 13 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
