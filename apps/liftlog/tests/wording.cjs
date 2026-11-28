// Same words and weights for the same thing: the weight column, search fields, header buttons and the empty-finish dialog. node tests/wording.cjs after npm run build.
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
      const t = window.testAPI;
      t.state.exercises = [{ id:'a', name:'Chest Press', category:'Push', unit:'kg', loadMode:'machine_stack', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' }];
      t.state.routines = [{ id:'r', name:'Push', items:[{ id:'i1', exerciseId:'a', sets:3, repsMin:8, repsMax:10 }] }];
      const now = Date.now();
      t.state.workouts = [{ id:'w1', routineName:'Push', startedAt:now - 86400000, finishedAt:now - 86000000, notes:'', exercises:[{ exerciseId:'a', name:'Chest Press', category:'Push', unit:'kg',
        loadMode:'machine_stack', movementFamily:'horizontal_push', notes:'', sets:[{ id:'s1', weight:50, reps:8, completed:true, completedAt:now - 86300000, unit:'kg' }] }] }];
      t.state.activeWorkout = null; t.navigate('today');
    });
    const visible = loc => loc.evaluate(el => el.innerText.trim());

    /* 1. Header buttons: New routine, Import and New exercise are all outlined, none filled. */
    assert.equal(await page.locator('.view-head [data-action="routine-new"]').evaluate(b => b.classList.contains('btn-primary')), false);
    assert.equal(await page.locator('.view-head .file-btn.is-quiet').count(), 0, 'Import is a full button');
    await page.evaluate(() => window.testAPI.navigate('exercises'));
    assert.equal(await page.locator('.view-head [data-action="ex-form-toggle"]').evaluate(b => b.classList.contains('btn-primary')), false);

    /* 2. Search fields: both labelled Search, with placeholders that fit. */
    assert.equal(await page.getByLabel('Search', { exact:true }).getAttribute('placeholder'), 'Name, category or movement');
    assert.equal(await page.locator('#ex-search').evaluate(i => i.scrollWidth <= i.clientWidth), true);
    await page.evaluate(() => window.testAPI.navigate('history'));
    assert.equal(await page.locator('#history-search').getAttribute('placeholder'), 'Exercise or session');
    assert.equal(await page.getByLabel('Search', { exact:true }).getAttribute('id'), 'history-search');

    /* 3. The routine editor's weight is "Weight", with the unit hidden on a phone. */
    await page.evaluate(() => { window.testAPI.navigate('today'); window.testAPI.openDetail('routine', 'r'); });
    await page.locator('#detail-edit').click();
    assert.equal(await visible(page.locator('#routine-form .target-weight .cap')), 'WEIGHT');

    /* 4. The empty finish dialog: Cancel left, Save anyway right, Discard workout apart on its own line. */
    await page.evaluate(() => { const t = window.testAPI; t.ui.routineDraft = null; t.startRoutine('r'); t.navigate('today'); });
    await page.locator('[data-action="finish-workout"]').first().click();
    const dlg = page.getByRole('dialog', { name:'No sets completed' });
    const boxes = await dlg.locator('button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return { t:b.textContent, x:Math.round(r.x), y:Math.round(r.y) }; }));
    const [cancel, save, discard] = ['Cancel', 'Save anyway', 'Discard workout'].map(t => boxes.find(b => b.t === t));
    assert.ok(cancel.y === save.y && cancel.x < save.x, 'Cancel and Save anyway side by side, Cancel left');
    assert.ok(discard.y > save.y, 'Discard workout below them');
    await dlg.getByRole('button', { name:'Cancel' }).click();

    assert.deepEqual(errors, []);
    console.log('wording: 10 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
