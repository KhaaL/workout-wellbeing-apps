// Workout screen and routine editor: Start on the top routine only, one way in to pairing, rows with a handle and a pencil. node tests/routine-rows.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, openDetail, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI, mk = (id, name) => ({ id, name, category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' });
      t.state.exercises = [mk('a', 'Bench'), mk('b', 'Row'), mk('c', 'Plank')];
      const item = (id, ex) => ({ id, exerciseId:ex, sets:3, repsMin:8, repsMax:10 });
      t.state.routines = [{ id:'r1', name:'Day A', items:[item('i1', 'a'), item('i2', 'b'), item('i3', 'c')] }, { id:'r2', name:'Day B', items:[item('j1', 'b')] }];
      t.state.workouts = []; t.state.activeWorkout = null; t.navigate('today');
    });

    /* 1. Start sits on the top routine's row only; the other row opens its sheet, which has Start. */
    assert.deepEqual(await page.locator('#main [data-action="routine-start"]').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label'))), ['Start Day A']);
    await page.getByRole('button', { name:'Day B', exact:true }).click();
    assert.equal(await page.locator('#detail-start').isVisible(), true, 'the sheet starts it');
    await page.locator('#detail-close').click();

    /* 2. The editor has one Pair exercises row; its menu offers Superset… and Either of…. */
    await page.waitForFunction(() => !document.querySelector('#detail-dlg').open);
    await page.getByRole('button', { name:'Day A', exact:true }).click();
    await page.locator('#detail-edit').click();
    assert.equal(await page.locator('#routine-form [data-action="pair-open"]').count(), 0, 'no separate pair buttons');
    await page.locator('#routine-pair-open').click();
    const choose = page.getByRole('dialog', { name:'Pair exercises' });
    assert.deepEqual(await choose.locator('button').allTextContents(), ['Superset…', 'Either of…', 'Cancel']);
    await choose.getByRole('button', { name:'Superset…' }).click();
    await page.getByRole('dialog', { name:'Superset' }).waitFor();
    assert.equal(await page.getByRole('dialog', { name:'Superset' }).isVisible(), true);
    await page.getByRole('dialog', { name:'Superset' }).getByRole('button', { name:'Close' }).click();

    /* 3. Each row has a handle and a pencil, no arrows or trash; the pencil moves and removes. */
    assert.equal(await page.locator('#routine-form .item-row [data-action="ritem-up"], #routine-form .item-row [data-action="ritem-rm"]').count(), 0);
    assert.equal(await page.locator('#routine-form .item-row').evaluateAll(rs => rs.every(r => r.querySelector('.grip') && r.querySelector('.ri-more'))), true);
    await page.locator('#ri-more-0').click();
    const menu = page.getByRole('dialog', { name:'Bench' });
    assert.equal(await menu.getByRole('button', { name:'Move Bench up' }).isDisabled(), true, 'the first row cannot move up');
    await menu.getByRole('button', { name:'Move Bench down' }).click();
    await page.waitForFunction(() => window.testAPI.ui.routineDraft.items.map(it => it.exerciseId).join() === 'b,a,c');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'ri-more-1', 'focus follows the moved row, on its pencil');
    await page.locator('#ri-more-2').click();
    await page.getByRole('dialog', { name:'Plank' }).getByRole('button', { name:'Remove Plank' }).click();
    await page.waitForFunction(() => window.testAPI.ui.routineDraft.items.length === 2);

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('routine-rows: 10 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
