// The open exercise in a session: icon links and last session beside the title, the note icon in the timer bar, superset partners on the Add set row, and the either-or question. node tests/session-panel.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

const names = { bench:'Bench Press With A Rather Long Machine Name', row:'Seated Row', curl:'Cable Curl', press:'Leg Press', ext:'Leg Extension' };
const lib = Object.entries(names).map(([id, name]) => ({ id, name, category:'Other', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:id === 'row' ? 'horizontal_pull' : id === 'bench' ? 'horizontal_push' : id === 'curl' ? 'other' : 'squat', archived:false, notes:'',
  url:id === 'bench' ? 'https://example.com/bench' : '', ...(id === 'bench' ? { instructions:'Lie flat. Lower to the chest.' } : {}) }));

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, toggleSet, workoutController, get ui(){return ui}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const item = (id, ex, extra = {}) => ({ id:'i-' + id, exerciseId:ex, sets:2, repsMin:8, repsMax:10, targetRir:2, weight:55, ...extra });
    const begin = (items, past) => page.evaluate(({ lib, items, past }) => {
      const t = window.testAPI;
      t.state.exercises = lib; t.state.activeWorkout = null; t.state.settings.autoRest = false;
      if (past){
        t.state.workouts = [];
        t.state.routines = [{ id:'past', name:'Past', items:[{ id:'p1', exerciseId:'bench', sets:2, repsMin:8, repsMax:10, weight:55 }] }];
        t.startRoutine('past');
        const ex = t.state.activeWorkout.exercises[0];
        ex.sets[0].weight = 55; ex.sets[0].reps = 8; ex.sets[1].weight = 55; ex.sets[1].reps = 10;
        ex.sets.forEach(s => t.toggleSet(s.id, true));
        t.workoutController().finishWorkout();
        if (t.state.activeWorkout) t.state.activeWorkout = null;
      }
      t.state.routines = [{ id:'r1', name:'Mixed', items }];
      t.startRoutine('r1'); t.navigate('today');
    }, { lib, items, past });
    const items = [item('bench', 'bench'), item('row', 'row', { supersetOf:'s' }), item('curl', 'curl', { supersetOf:'s' }), item('press', 'press', { eitherOf:'e' }), item('ext', 'ext', { eitherOf:'e' })];
    await begin(items, true);

    /* 1. Instructions, how-to and last session are icons on the title's row. */
    const row = await page.evaluate(() => {
      const t = document.querySelector('#workout-title').getBoundingClientRect();
      return [...document.querySelectorAll('.workout-title-row .ex-links > *')].map(el => { const r = el.getBoundingClientRect();
        return { label:el.getAttribute('aria-label'), text:el.textContent.trim(), sameRow:Math.abs((r.top + r.bottom) / 2 - (t.top + t.bottom) / 2) < t.height / 2 + 8, size:[Math.round(r.width), Math.round(r.height)] }; });
    });
    assert.equal(row.length, 3, 'three icons: instructions, how to, last session');
    assert.ok(row.every(r => r.text === '' && r.sameRow && r.size[0] >= 44 && r.size[1] >= 44), 'icons only, 44px, on the title row: ' + JSON.stringify(row));
    assert.match(row[0].label, /^Instructions for /);assert.match(row[1].label, /^How to perform /);assert.match(row[2].label, /^Last session of /);
    assert.equal(await page.locator('.ex-head, .prev-perf').count(), 0, 'no separate links row and no standing results row');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no side scroll');

    /* 2. The history icon shows one line: the day and the working sets. */
    const toggle = page.locator('[data-action="last-toggle"]');
    assert.equal(await page.locator('#last-line').count(), 0, 'closed by default');
    await toggle.click();
    assert.match(await page.locator('#last-line').textContent(), /^[A-Za-z]{3} \d{1,2} · 55 × 8, 55 × 10 kg/, 'the last session on one line');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.doesNotMatch(await page.locator('#ex-panel-top').textContent(), /e1RM|Best volume/, 'bests are not here');
    await toggle.click();assert.equal(await page.locator('#last-line').count(), 0, 'a second tap closes it');
    await toggle.click();
    await page.evaluate(() => window.scrollTo(0, 300));

    /* 3. Moving on keeps the new title in view, and the line is closed again. */
    await page.locator('#btn-next-ex').click();
    const view = await page.evaluate(() => { const t = document.querySelector('#workout-title').getBoundingClientRect(), s = document.querySelector('.session-strip').getBoundingClientRect();
      return { name:document.querySelector('#workout-title').textContent, below:t.top >= s.bottom - 1, onScreen:t.bottom <= innerHeight, last:!!document.querySelector('#last-line') }; });
    assert.deepEqual(view, { name:names.row, below:true, onScreen:true, last:false }, 'the next exercise opens with its title visible');

    /* 4. The session note is an icon at the right of the timer bar. */
    assert.equal(await page.getByText('Add session note').count(), 0, 'no text button for the note');
    const note = await page.evaluate(() => { const b = document.querySelector('#timer-panel [data-action="open-session-note"]').getBoundingClientRect(), p = document.querySelector('#timer-panel').getBoundingClientRect();
      return { text:document.querySelector('#timer-panel [data-action="open-session-note"]').textContent.trim(), rightGap:Math.round(p.right - b.right), inside:b.bottom <= p.bottom && b.top >= p.top, label:document.querySelector('#timer-panel [data-action="open-session-note"]').getAttribute('aria-label') }; });
    assert.deepEqual([note.text, note.inside, note.rightGap <= 24, note.label], ['', true, true, 'Add session note'], 'icon, bottom right of the bar: ' + JSON.stringify(note));
    assert.equal(await page.locator('#wnotes').count(), 0);
    await page.locator('#timer-panel [data-action="open-session-note"]').click();
    assert.equal(await page.locator('#wnotes').isVisible(), true, 'the icon opens the note field');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'wnotes');

    /* 5. Superset partners sit on the Add set row, after Add set and More…. */
    const foot = await page.evaluate(() => { const f = document.querySelector('.sets-foot'), btns = [...f.querySelectorAll('button')].map(b => ({ action:b.dataset.action, name:b.textContent.trim(), y:Math.round(b.getBoundingClientRect().top) }));
      return { order:btns.map(b => b.action), names:btns.map(b => b.name), sameRow:new Set(btns.map(b => b.y)).size === 1, noteRow:!!document.querySelector('.superset-note') }; });
    assert.deepEqual(foot.order, ['add-set', 'exercise-menu', 'superset-switch'], 'Add set, More…, then the partner');
    assert.equal(foot.names[2], names.curl);assert.equal(foot.sameRow, true, 'one row');assert.equal(foot.noteRow, false, 'no separate superset row');
    await page.locator('.sets-foot .superset-switch').click();
    assert.equal(await page.locator('#workout-title').textContent(), names.curl, 'the partner button switches to it');

    /* 6. Either-or: starting one asks about the other, once. Decline keeps both. */
    const dialog = page.locator('#dlg[open]');
    await page.evaluate(() => { const t = window.testAPI, w = t.state.activeWorkout; w.currentExerciseIndex = 3; w.supersetSide = 0; t.render(); });
    assert.equal(await page.locator('#workout-title').textContent(), names.press);
    await page.locator('.set-done-btn').first().click();
    assert.equal(await page.locator('#dlg-title').textContent(), 'Remove ' + names.ext + '?');
    await dialog.locator('#dlg-actions button').first().click();
    assert.deepEqual(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.map(e => [e.name, !!e.eitherOf])), [[names.bench, false], [names.row, false], [names.curl, false], [names.press, false], [names.ext, false]], 'declining keeps both and ends the pairing');
    await page.locator('.set-done-btn').first().click();
    assert.equal(await dialog.count(), 0, 'not asked again');

    /* 7. Accepting removes the other alternative from this session only. */
    await begin(items, false);
    await page.evaluate(() => { const t = window.testAPI, w = t.state.activeWorkout; w.currentExerciseIndex = 3; w.supersetSide = 0; t.render(); });
    await page.locator('.set-done-btn').first().click();
    assert.equal(await page.locator('#dlg-title').textContent(), 'Remove ' + names.ext + '?');
    await dialog.locator('#dlg-actions button').last().click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout.exercises.length === 4);
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.some(e => e.name === 'Leg Extension')), false);
    assert.equal(await page.evaluate(() => window.testAPI.state.routines[0].items.length), 5, 'the saved routine keeps both');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[3].eitherOf), undefined, 'the started exercise is no longer paired');
    await page.screenshot({ path:'/tmp/liftlog-session-panel.png' });

    assert.deepEqual(errors, []);
    console.log('session-panel: 27 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
