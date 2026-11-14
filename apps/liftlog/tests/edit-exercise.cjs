// More… → Edit exercise… in a running workout: the library entry's editor in a sheet over the session. node tests/edit-exercise.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, startTimer, exerciseById, get timer(){return timer}, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.exercises = [{ id:'press', name:'Chest Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' },
        { id:'row', name:'Seated Row', category:'Pull', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_pull', archived:false, notes:'', url:'' }];
      t.state.workouts = []; t.state.activeWorkout = null;
      t.state.routines = [{ id:'r', name:'Upper', items:[{ id:'i1', exerciseId:'press', sets:3, repsMin:8, repsMax:10, weight:40 }, { id:'i2', exerciseId:'row', sets:3, repsMin:8, repsMax:10, weight:40 }] }];
      t.startRoutine('r'); t.navigate('today'); t.startTimer();
    });
    const menu = () => page.locator('#main [data-action="exercise-menu"]').click();
    const sheet = page.getByRole('dialog', { name:'Edit Chest Press' });

    /* 1. The menu offers it; the editor opens over the running session, which stays as it was. */
    await menu();
    const entries = await page.locator('dialog.numeric-editor button').allTextContents();
    assert.equal(entries[0], 'Edit exercise…', 'first in the menu: ' + entries.join(' | '));
    await page.getByRole('button', { name:'Edit exercise…' }).click();
    await sheet.waitFor();
    assert.equal(await page.evaluate(() => window.testAPI.ui.view), 'today', 'the workout stays the view behind the sheet');
    assert.equal(await sheet.locator('[data-field="name"]').inputValue(), 'Chest Press');
    assert.equal(await page.evaluate(() => window.testAPI.timer.running), true, 'the rest clock keeps running');

    /* 2. Save writes the library entry, the session shows it at once, and focus returns to the exercise. */
    await sheet.locator('[data-field="name"]').fill('Chest Press Machine');
    await sheet.locator('[data-field="notes"]').fill('Seat 4, handles 2');
    await sheet.locator('[data-field="restSeconds"]').fill('120');
    await sheet.getByRole('button', { name:'Save', exact:true }).click();
    await page.waitForFunction(() => !document.querySelector('#detail-dlg').open);
    const after = await page.evaluate(() => { const t = window.testAPI, e = t.exerciseById('press');
      return { name:e.name, notes:e.notes, rest:e.restSeconds, block:t.state.activeWorkout.exercises[0].name, detail:t.ui.detail, draft:t.ui.exerciseDraft,
        title:document.querySelector('#workout-title').textContent, focus:document.activeElement && document.activeElement.id }; });
    assert.deepEqual(after, { name:'Chest Press Machine', notes:'Seat 4, handles 2', rest:120, block:'Chest Press Machine', detail:null, draft:null,
      title:'Chest Press Machine', focus:'ex-panel-top' });
    assert.match(await page.locator('#toast, .toast').last().textContent(), /Exercise updated/);

    /* 3. Cancel and Escape leave the entry untouched. */
    await menu(); await page.getByRole('button', { name:'Edit exercise…' }).click();
    const again = page.getByRole('dialog', { name:'Edit Chest Press Machine' });
    await again.locator('[data-field="notes"]').fill('changed');
    await again.getByRole('button', { name:'Cancel', exact:true }).click();
    await page.waitForFunction(() => !document.querySelector('#detail-dlg').open);
    await menu(); await page.getByRole('button', { name:'Edit exercise…' }).click();
    await again.locator('[data-field="notes"]').fill('changed again');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#detail-dlg').open);
    assert.deepEqual(await page.evaluate(() => [window.testAPI.exerciseById('press').notes, window.testAPI.ui.exerciseDraft]), ['Seat 4, handles 2', null]);

    /* 4. A block whose library entry is gone has nothing to edit. */
    await page.evaluate(() => { const t = window.testAPI; t.state.exercises = t.state.exercises.filter(e => e.id !== 'press'); t.render(); });
    await menu();
    assert.equal(await page.getByRole('button', { name:'Edit exercise…' }).count(), 0);
    await page.keyboard.press('Escape');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('edit-exercise: 8 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
