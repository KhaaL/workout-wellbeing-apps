// Warm-up sets: the button on the current exercise, their rests, and the rules in Settings. node tests/warmups.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, startRoutine, get timer(){return timer}, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const start = () => page.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.state.workouts = [];
      t.state.exercises = [{ id:'bench', name:'Bench Press', category:'Chest', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' }];
      t.state.routines = [{ id:'r1', name:'Push', items:[{ id:'i1', exerciseId:'bench', sets:3, repsMin:6, repsMax:8, weight:100 }] }];
      t.state.settings.defaultRest = 90; t.state.settings.autoRest = true; t.state.settings.loadStep = 2.5;
      t.startRoutine('r1'); t.navigate('today');
    });
    const sets = () => page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets.map(s => [s.weight, s.reps, s.restSeconds ?? null]));
    const restAfterLogging = async n => {
      await page.locator('.set-done-btn').nth(n).click();
      return page.evaluate(() => window.testAPI.timer.seconds);
    };
    const button = page.locator('#main [data-action="add-warmups"]');

    /* Defaults: two warm-ups at 50% and 75% for the working reps, resting 1:00 then 2:00. */
    await start();
    assert.equal((await button.textContent()).trim(), '2 warm-up sets · first horizontal push', 'a small button above the sets offers the default two warm-ups');
    assert.ok(await button.evaluate(b => b.classList.contains('btn-sm') && b.classList.contains('btn-quiet')), 'the button is small and quiet');
    await button.click();
    assert.deepEqual(await sets(), [[50, 6, 60], [75, 6, 120], [100, null, null], [100, null, null], [100, null, null]],
      'warm-ups use the target reps and 50% then 75% of the working load');
    assert.equal(await button.count(), 0, 'the button goes once warm-ups are added');
    assert.equal(await restAfterLogging(0), 60, 'the first warm-up rests 1:00');
    assert.match(await page.locator('.ex-tags').textContent(), /rest 1:00 \(warm-up\)/);
    assert.equal(await restAfterLogging(1), 120, 'the second warm-up rests 2:00');
    assert.equal(await restAfterLogging(2), 90, 'working sets rest for the normal time');

    /* Settings: the rules are a form with its own Save and status line. */
    await page.evaluate(() => { const t = window.testAPI; t.state.activeWorkout = null; t.navigate('settings'); });
    const form = page.locator('#warmup-form');
    const values = name => form.locator('[name="' + name + '"]').evaluateAll(els => els.map(el => el.value));
    assert.deepEqual(await values('wu-percent'), ['50', '75']);
    assert.deepEqual(await values('wu-rest'), ['60', '120']);
    await form.locator('[data-action="warmup-step-add"]').click();
    await form.locator('[name="wu-percent"]').nth(2).fill('70');
    await form.locator('[name="wu-rest"]').nth(2).fill('150');
    await form.getByRole('button', { name:'Save warm-ups' }).click();
    assert.match(await page.locator('#warmup-status').textContent(), /Warm-up 3 needs/, 'a step lighter than the one before is refused');
    assert.deepEqual(await page.evaluate(() => window.testAPI.state.settings.warmupSteps.length), 2, 'nothing is saved while a step is wrong');
    assert.deepEqual(await values('wu-percent'), ['50', '75', '70'], 'the typed values stay for correction');
    await form.locator('[name="wu-percent"]').nth(2).fill('90');
    await form.locator('[data-action="warmup-step-remove"]').first().click();
    await form.getByRole('button', { name:'Save warm-ups' }).click();
    assert.match(await page.locator('#warmup-status').textContent(), /^Saved: 75% then 2:00 rest, 90% then 2:30 rest\.$/);
    assert.equal(JSON.stringify(await page.evaluate(() => window.testAPI.state.settings.warmupSteps)),
      '[{"percent":75,"rest":120},{"percent":90,"rest":150}]');

    /* The saved rules decide the next warm-ups. */
    await start();
    await button.click();
    assert.deepEqual((await sets()).slice(0, 2), [[75, 6, 120], [90, 6, 150]]);

    /* The button says whether the movement family has worked yet in this workout. */
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null;
      t.state.exercises = [
        { id:'bench', name:'Bench Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' },
        { id:'incline', name:'Incline Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'horizontal_push', archived:false, notes:'', url:'' },
        { id:'curl', name:'Curl', category:'Pull', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'other', archived:false, notes:'', url:'' }];
      t.state.routines = [{ id:'r2', name:'Push', items:['bench', 'incline', 'curl'].map((id, i) => ({ id:'j' + i, exerciseId:id, sets:2, repsMin:6, repsMax:8, weight:60 })) }];
      t.startRoutine('r2'); t.navigate('today');
    });
    const goTo = i => page.evaluate(i => { const t = window.testAPI; t.state.activeWorkout.currentExerciseIndex = i; t.render(); }, i);
    const warmAdd = page.locator('#main .warmup-add');
    assert.equal((await button.textContent()).trim(), '2 warm-up sets · first horizontal push', 'the first exercise of a family says so');
    await goTo(1);
    assert.equal((await warmAdd.textContent()).trim(), '2 warm-up sets · first horizontal push', 'nothing logged yet: still fresh');
    await goTo(0); await button.click(); await page.locator('.set-done-btn').nth(0).click();
    await goTo(1);
    assert.equal((await warmAdd.textContent()).trim(), '2 warm-up sets · first horizontal push', 'a warm-up is not work');
    await goTo(0); await page.locator('.set-done-btn').nth(2).click();
    await goTo(1);
    assert.equal(await warmAdd.locator('.warmup-note').textContent(), 'horizontal push worked: Bench Press', 'after a working set the family is worked');
    assert.equal((await button.textContent()).trim(), '2 warm-up sets');
    assert.match(await button.getAttribute('aria-label'), /horizontal push already worked by Bench Press$/);
    await goTo(2);
    assert.equal((await warmAdd.textContent()).trim(), '2 warm-up sets', 'an unclassified exercise says nothing');

    assert.deepEqual(errors, []);
    console.log('warmups: 25 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
