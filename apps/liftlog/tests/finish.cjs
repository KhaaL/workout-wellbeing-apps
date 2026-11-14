// Finishing a workout: the question when planned sets are left, the single save toast with its backup button, and the last-session date. node tests/finish.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');


(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, workoutController, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const start = () => page.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null;
      t.state.exercises = [{ id:'bench', name:'Bench Press' }, { id:'fly', name:'Fly' }].map(e => ({ ...e, category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' }));
      t.state.routines = [{ id:'r1', name:'Push', items:[{ id:'i1', exerciseId:'bench', sets:3, repsMin:6, repsMax:8, weight:100 }, { id:'i2', exerciseId:'fly', sets:3, repsMin:10, repsMax:12, weight:20 }] }];
      t.state.settings.autoRest = false;
      t.startRoutine('r1'); t.navigate('today');
    });
    /* On a phone Finish sits top right in the title row; the one beside the exercise name is hidden there. */
    const finish = page.locator('.shell-actions [data-action="finish-workout"]');
    const ask = page.getByRole('dialog', { name:'Finish workout?' });
    await start();
    const where = await page.evaluate(() => { const b = document.querySelector('.shell-actions [data-action="finish-workout"]').getBoundingClientRect(),
      panel = document.querySelector('#main .workout-head-actions [data-action="finish-workout"]');
      return { right:Math.round(innerWidth - b.right), top:Math.round(b.top), panelShown:!!panel.getClientRects().length,
        menuFirst:document.querySelector('.shell-title').firstElementChild.classList.contains('shell-menu-button') }; });
    assert.ok(where.right <= 24 && where.top <= 16 && !where.panelShown && where.menuFirst, 'Finish top right, menu top left: ' + JSON.stringify(where));
    await page.evaluate(() => window.testAPI.navigate('history'));
    assert.equal(await page.locator('.shell-actions [data-action="finish-workout"]').count(), 0, 'only on the workout screen');
    await page.evaluate(() => window.testAPI.navigate('today'));

    /* Planned sets left: Finish asks first, and Cancel keeps the workout going. */
    await page.evaluate(() => { const t = window.testAPI; t.state.workouts = []; });
    await start();
    await page.locator('.set-done-btn').nth(0).click();
    await finish.click();
    assert.match(await ask.textContent(), /5 planned sets are not logged\. Finishing removes them from this workout\./, 'the question names the unlogged sets');
    assert.equal(await ask.getByRole('button', { name:'Cancel' }).evaluate(b => b === document.activeElement), true, 'Cancel has focus');
    await ask.getByRole('button', { name:'Cancel' }).click();
    assert.ok(await page.evaluate(() => !!window.testAPI.state.activeWorkout), 'Cancel keeps the workout');
    await finish.click();
    await ask.getByRole('button', { name:'Finish workout' }).click();
    assert.ok(await page.evaluate(() => !window.testAPI.state.activeWorkout && window.testAPI.state.workouts.length === 1), 'Finish workout saves it');

    /* One toast says saved and, the first time, that a backup is due, with a button there. */
    const toast = page.locator('#toast-region .toast');
    assert.match(await toast.textContent(), /^Workout saved — 600 kg total\. 1 workout since your last backup\.Back up$/);
    await toast.getByRole('button', { name:'Back up' }).click();
    assert.equal(await page.evaluate(() => window.testAPI.ui.view), 'settings', 'Back up opens Settings');
    assert.ok(await page.locator('[data-settings-section="storage"]').evaluate(d => d.open), 'with Backups & cloud storage open');

    /* Every planned set logged: Finish saves without a question. */
    await start();
    for (let i = 0; i < 3; i++) await page.locator('.set-done-btn').nth(i).click();
    for (let i = 0; i < 3; i++) await page.locator('.set-done-btn').nth(i).click();
    await page.evaluate(() => { const w = window.testAPI.state.activeWorkout; w.currentExerciseIndex = 0; window.testAPI.render(); });
    await finish.click();
    assert.equal(await ask.count(), 0, 'no question when nothing planned is left');
    assert.match(await toast.textContent(), /^Workout saved — /, 'the reminder is said once per page load');

    /* Nothing logged keeps its own question. */
    await start();
    await finish.click();
    assert.equal(await page.getByRole('dialog', { name:'No sets completed' }).count(), 1);
    await page.getByRole('dialog', { name:'No sets completed' }).getByRole('button', { name:'Cancel' }).click();

    /* What counts as open: an either-of pair once, at its larger member; skipped exercises and warm-ups not at all. */
    assert.deepEqual(await page.evaluate(() => {
      const open = window.testAPI.workoutController().openWorkSets;
      const set = (done, warm) => ({ completed:done, ...(warm ? { countForVolume:false, countForPR:false } : {}) });
      return [
        open({ exercises:[{ eitherOf:'p', sets:[set(), set(), set()] }, { eitherOf:'p', sets:[set(), set()] }] }),
        open({ exercises:[{ supersetOf:'s', sets:[set(), set()] }, { supersetOf:'s', sets:[set(true), set()] }] }),
        open({ exercises:[{ skipped:true, sets:[set(), set()] }, { sets:[set(false, true), set(true), set()] }] })];
    }), [3, 3, 1]);

    /* The last-session strip names the day as the rest of the app does. */
    await page.evaluate(() => { window.testAPI.state.activeWorkout = null; });
    await start();
    const day = await page.evaluate(() => new Date(window.testAPI.state.workouts[0].startedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' }));
    assert.equal(await page.locator('#main .prev-perf .pp-k').first().textContent(), day);

    assert.deepEqual(errors, []);
    console.log('finish: 15 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
