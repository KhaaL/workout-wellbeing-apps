// Coming back to a superset shows the member that is not resting: after pairing from the overview, after another tab, after the app was hidden. node tests/superset-return.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

const lib = [['bench', 'Bench Press', 'horizontal_push'], ['row', 'Seated Row', 'horizontal_pull'], ['curl', 'Cable Curl', 'other']]
  .map(([id, name, movementFamily]) => ({ id, name, category:'Other', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily, archived:false, notes:'', url:'' }));

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, toggleSet, switchSupersetMember, currentMemberIndex,
      get timer(){return timer}, get restTimers(){return restTimers}, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(lib => {
      const t = window.testAPI;
      t.state.exercises = lib; t.state.workouts = []; t.state.activeWorkout = null; t.state.settings.autoRest = true; t.state.settings.defaultRest = 90;
      t.state.routines = [{ id:'r', name:'Upper', items:lib.map((e, i) => ({ id:'i' + i, exerciseId:e.id, sets:3, repsMin:8, repsMax:10, targetRir:2, weight:40 })) }];
      t.startRoutine('r'); t.navigate('today');
    }, lib);
    const onScreen = () => page.evaluate(() => { const t = window.testAPI, w = t.state.activeWorkout; return w.exercises[t.currentMemberIndex(w)].name; });

    /* 1. A set of bench starts its rest; the bench is paired with the row from the overview. Back in the workout, the row is up. */
    await page.locator('#main .set-done-btn').first().click();
    assert.equal(await page.evaluate(() => window.testAPI.timer.running), true, 'the bench rests');
    await page.locator('#overview-toggle-btn').click();
    await page.locator('#session-superset-open').click();
    await page.locator('#pair-first').selectOption({ label:'Bench Press · #1' });
    await page.locator('#pair-second').selectOption({ label:'Seated Row · #2' });
    await page.locator('#pair-add').click();
    assert.equal(await onScreen(), 'Bench Press', 'pairing alone does not move the cursor');
    await page.locator('#overview-dlg [data-action="close-overview"]').first().click();
    assert.equal(await onScreen(), 'Seated Row', 'closing the overview shows the member that is not resting');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'ex-panel-top', 'focus lands on the exercise');
    assert.equal(await page.locator('#timer-label').textContent(), 'Rest · Bench Press', 'the bench clock keeps counting in the bar');

    /* 2. Both resting: the member on screen stays, whatever tab was visited. */
    await page.locator('#main .set-done-btn').first().click();
    assert.equal(await onScreen(), 'Bench Press', 'a logged set hands over as before');
    await page.evaluate(() => { const t = window.testAPI; t.navigate('history'); t.navigate('today'); });
    assert.equal(await onScreen(), 'Bench Press', 'both resting: no switch');

    /* 3. The row's rest ends while away on another tab: the row comes to the front. */
    await page.evaluate(() => {
      const t = window.testAPI, row = t.restTimers.get('exercise:row');
      row.endsAt = Date.now() - 1000;
      t.navigate('history'); t.navigate('today');
    });
    assert.equal(await onScreen(), 'Seated Row', 'the ready member is shown on return to the Workout tab');

    /* 4. Returning to the app does the same, unless a field is being edited. */
    const viaVisibility = async editing => page.evaluate(editing => {
      const t = window.testAPI, w = t.state.activeWorkout;
      t.switchSupersetMember(0);
      if (document.activeElement) document.activeElement.blur();
      const clock = key => t.timer.key === key ? t.timer : t.restTimers.get(key);
      Object.assign(clock('exercise:bench'), { running:true, done:false, endsAt:Date.now() + 60000 });
      const row = clock('exercise:row'); if (row) row.running = false;
      if (editing) document.querySelector('#main input[data-field="weight"]').focus();
      document.dispatchEvent(new Event('visibilitychange'));
      return w.exercises[t.currentMemberIndex(w)].name;
    }, editing);
    assert.equal(await viaVisibility(true), 'Bench Press', 'a field being edited keeps its exercise');
    assert.equal(await viaVisibility(false), 'Seated Row', 'back in the app, the ready member');

    /* 5. Neither resting: a choice made by hand stands. */
    await page.evaluate(() => {
      const t = window.testAPI;
      t.switchSupersetMember(0);
      t.timer.running = false; t.restTimers.forEach(c => { c.running = false; });
      t.ui.overviewOpen = true; t.render();
    });
    await page.locator('#overview-dlg [data-action="close-overview"]').first().click();
    assert.equal(await onScreen(), 'Bench Press', 'no rest running: the cursor stays');

    assert.deepEqual(errors, []);
    console.log('superset-return: 12 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
