// Lighter rows: no Archive on active exercise rows, and history edit sets on one line like a workout set. node tests/list-rows.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:360, height:900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, openDetail, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI, now = Date.now(), mk = (id, name, archived) => ({ id, name, category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived, notes:'', url:'' });
      t.state.exercises = [mk('a', 'Chest Press', false), mk('b', 'Old Press', true)];
      t.state.routines = []; t.state.activeWorkout = null;
      t.state.workouts = [{ id:'w1', routineName:'Push', startedAt:now - 86400000, finishedAt:now - 86000000, notes:'', exercises:[{ exerciseId:'a', name:'Chest Press', category:'Push', unit:'kg',
        loadMode:'total', movementFamily:'horizontal_push', notes:'', sets:[{ id:'s1', weight:102.5, reps:8, rir:2, completed:true, completedAt:now - 86300000, unit:'kg' },
        { id:'s2', weight:100, reps:10, rir:1, completed:true, completedAt:now - 86200000, unit:'kg' }] }] }];
      t.navigate('exercises');
    });

    /* 1. An active exercise row opens its sheet and carries no Archive button; an archived row keeps Unarchive. */
    assert.equal(await page.locator('#ex-list [data-action="ex-archive"]').count(), 0, 'no Archive on active rows');
    await page.locator('#ex-archived-toggle').click();
    assert.equal(await page.locator('#archive-ex-b').textContent(), 'Unarchive');
    await page.locator('#archive-ex-b').click();
    await page.waitForFunction(() => !window.testAPI.state.exercises.find(e => e.id === 'b').archived);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'open-exercise-b', 'focus lands on the restored row');

    /* 2. A history set is one line: role mark, three figures, done box and pencil; nothing below it. */
    await page.evaluate(() => { window.testAPI.navigate('history'); window.testAPI.openDetail('workout', 'w1'); });
    await page.locator('#detail-edit').click();
    const line = await page.locator('.hset-row:not(.hset-head)').first().evaluate(r => {
      const tops = [...r.children].map(c => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2));
      return { level:Math.max(...tops) - Math.min(...tops) <= 4, buttons:[...r.querySelectorAll('button')].map(b => b.getAttribute('aria-label')),
        fits:[...r.querySelectorAll('input')].every(i => i.scrollWidth <= i.clientWidth) };
    });
    assert.deepEqual(line, { level:true, buttons:['Set 1 completed', 'More for set 1'], fits:true });
    assert.equal(await page.getByRole('button', { name:'Remove Chest Press from this session' }).textContent(), 'Remove exercise…');

    /* 3. The pencil holds Mark as warm-up and Delete set, as the workout's set editor does. */
    await page.locator('#hmore-s1').click();
    const menu = page.getByRole('dialog', { name:'Set 1' });
    await menu.getByRole('button', { name:'Mark as warm-up' }).click();
    await page.waitForFunction(() => window.testAPI.state.workouts[0].exercises[0].sets[0].countForVolume === false);
    assert.equal(await page.locator('.hset-row:not(.hset-head) .set-mark').first().textContent(), 'W');
    await page.locator('#hmore-s2').click();
    await page.getByRole('dialog', { name:'Set 2' }).getByRole('button', { name:/^Delete set 2/ }).click();
    await page.waitForFunction(() => window.testAPI.state.workouts[0].exercises[0].sets.length === 1);

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('list-rows: 9 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
