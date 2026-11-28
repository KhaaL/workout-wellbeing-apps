// The session overview: exercise rows that open on tap, and the tools in their own band below. node tests/overview.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:360, height:900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI, mk = (id, name, fam) => ({ id, name, category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:fam, archived:false, notes:'', url:'' });
      t.state.exercises = [mk('a', 'Leg Press', 'squat'), mk('b', 'Chest Press', 'horizontal_push'), mk('c', 'Face Pull', 'horizontal_pull'), mk('e', 'Barbell Bench Press', 'horizontal_push')];
      t.state.workouts = []; t.state.activeWorkout = null;
      t.state.routines = [{ id:'r', name:'Full', items:['a', 'b', 'c'].map((x, i) => ({ id:'i' + i, exerciseId:x, sets:3, repsMin:8, repsMax:10 })) }];
      t.startRoutine('r'); t.navigate('today');
    });
    const sheet = page.locator('#overview-dlg');
    await page.locator('#overview-toggle-btn').click();

    /* 1. Every row shows its set count; the current row is plain text, the others open on tap with a chevron. */
    const rows = await sheet.locator('.overview-row').evaluateAll(rs => rs.map(r => ({
      meta:(r.querySelector('.ov-meta') || {}).textContent, jump:!!r.querySelector('button.ov-open .ov-chev') })));
    assert.deepEqual(rows, [{ meta:'0/3 sets', jump:false }, { meta:'0/3 sets', jump:true }, { meta:'0/3 sets', jump:true }]);

    /* 2. The tools sit in bands after the list, each as title, hint and one button; Discard has its own band. */
    const bands = await sheet.locator('.ov-tools').evaluateAll(bs => bs.map(b => [...b.querySelectorAll('.ov-tool-title')].map(t => t.textContent)));
    assert.deepEqual(bands, [['Add exercise', 'Superset', 'Progression'], ['Discard this workout']]);
    assert.equal(await sheet.locator('.ov-tool').evaluateAll(ts => ts.every(t => t.querySelector('.hint') && t.querySelectorAll('button').length === 1)), true);
    assert.equal(await sheet.evaluate(el => { const list = [...el.querySelectorAll('.overview-row')].pop(), band = el.querySelector('.ov-tools');
      return getComputedStyle(band).backgroundColor !== getComputedStyle(list).backgroundColor && band.getBoundingClientRect().top - list.getBoundingClientRect().bottom >= 12; }),
      true, 'the band has its own background and a gap above it');
    assert.equal(await sheet.locator('.ov-tools select').count(), 0, 'no picker inline in the band');

    /* 3. Add exercise… picks in a dialog; Cancel adds nothing, Add appends and the sheet stays open. */
    await page.locator('#session-add-open').click();
    const add = page.getByRole('dialog', { name:'Add exercise' });
    assert.deepEqual(await add.locator('option').allTextContents(), ['Barbell Bench Press'], 'only what is not in the session');
    await add.getByRole('button', { name:'Cancel' }).click();
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.length), 3);
    await page.locator('#session-add-open').click();
    await add.getByRole('button', { name:'Add' }).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.exercises.length === 4);
    assert.equal(await sheet.evaluate(d => d.open), true, 'the overview stays open');
    assert.equal(await page.locator('#session-add-open').isDisabled(), true, 'nothing left to add');

    /* 4. Tapping a row's name opens that exercise. */
    await sheet.locator('#ov-jump-2').click();
    await page.waitForFunction(() => !document.querySelector('#overview-dlg').open);
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.currentExerciseIndex), 2);

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('overview: 10 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
