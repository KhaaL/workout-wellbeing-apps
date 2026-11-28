// One look for the same action everywhere: the floppy-disk save on every editor, the trash icon on every sheet, one exercise picker, one Progression row. node tests/editor-buttons.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, openDetail, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI, now = Date.now(), mk = (id, name) => ({ id, name, category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' });
      t.state.exercises = [mk('a', 'Chest Press'), mk('b', 'Pec Fly'), mk('c', 'Dip Machine')];
      t.state.routines = [{ id:'r', name:'Push', items:[{ id:'i1', exerciseId:'a', sets:3, repsMin:8, repsMax:10 }] }];
      t.state.activeWorkout = null;
      t.state.workouts = [{ id:'w1', routineId:'r', routineName:'Push', startedAt:now - 86400000, finishedAt:now - 86400000 + 3600000, notes:'',
        exercises:[{ exerciseId:'a', name:'Chest Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', notes:'', skipped:false,
          plannedSets:1, targetRepsMin:8, targetRepsMax:10, sets:[{ id:'s1', weight:50, reps:8, rir:2, completed:true, completedAt:now - 86400000 + 600000, unit:'kg' }] }] }];
      t.render();
    });
    const isSave = loc => loc.evaluate(b => !!b.querySelector('svg path[d^="M5 3h11"]') && b.textContent.trim() === b.querySelector('.sr-only').textContent.trim());

    /* 1. The history sheet deletes with the trash icon, as the routine and exercise sheets do. */
    await page.evaluate(() => { window.testAPI.navigate('history'); window.testAPI.openDetail('workout', 'w1'); });
    const del = page.locator('#detail-delete-workout');
    assert.equal(await del.getAttribute('aria-label'), 'Delete session');
    assert.equal(await del.evaluate(b => !!b.querySelector('svg') && !b.querySelector('span:not(.sr-only)')), true, 'icon only');

    /* 2. The history editor saves with the floppy disk and shows the Progression row. */
    await page.locator('#detail-edit').click();
    const saveSession = page.getByRole('button', { name:'Save session', exact:true });
    assert.equal(await isSave(saveSession), true);
    assert.equal(await page.locator('#hedit .ov-tool .ov-tool-title').textContent(), 'Progression');
    assert.equal(await page.locator('#hedit [data-action="exclude-all"]').textContent(), 'Exclude all…');
    await saveSession.click();

    /* 3. The routine editor saves with the floppy disk and adds through the picker dialog. */
    await page.evaluate(() => { window.testAPI.navigate('today'); window.testAPI.openDetail('routine', 'r'); });
    await page.locator('#detail-edit').click();
    assert.equal(await isSave(page.getByRole('button', { name:'Save routine', exact:true })), true);
    assert.equal(await page.locator('#routine-form select#routine-add-select').count(), 0, 'no inline picker');
    await page.locator('#routine-add-open').click();
    const pick = page.getByRole('dialog', { name:'Add exercise' });
    await pick.locator('select').selectOption({ label:'Dip Machine' });
    await pick.getByRole('button', { name:'Add' }).click();
    await page.waitForFunction(() => window.testAPI.ui.routineDraft && window.testAPI.ui.routineDraft.items.some(it => it.exerciseId === 'c'));
    await page.getByRole('button', { name:'Save routine', exact:true }).click();
    await page.waitForFunction(() => window.testAPI.state.routines[0].items.length === 2);

    /* 4. The exercise editor and the set editor save with the floppy disk. */
    await page.evaluate(() => { window.testAPI.navigate('exercises'); window.testAPI.openDetail('exercise', 'a'); });
    await page.locator('#detail-edit').click();
    assert.equal(await isSave(page.locator('#ex-edit-form').getByRole('button', { name:'Save', exact:true })), true);
    await page.evaluate(() => { const t = window.testAPI; t.ui.exerciseDraft = null; t.startRoutine('r'); t.navigate('today'); });
    await page.locator('#main .set-done-btn').first().click();
    await page.locator('#main .set-row.is-done .set-summary').first().click();
    assert.equal(await isSave(page.locator('dialog.numeric-editor').getByRole('button', { name:'Save changes', exact:true })), true);

    assert.deepEqual(errors, []);
    console.log('editor-buttons: 11 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
