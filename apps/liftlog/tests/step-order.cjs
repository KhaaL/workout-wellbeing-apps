// The < and > buttons step through the session list one exercise at a time, supersets or not. node tests/step-order.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

const names = ['Bench Press', 'Seated Row', 'Cable Curl', 'Leg Press', 'Calf Raise'];
const lib = names.map((name, i) => ({ id:'e' + i, name, category:'Other', unit:'kg', loadMode:'total', equipmentKey:'', movementFamily:'other', archived:false, notes:'', url:'' }));

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, startRoutine, currentMemberIndex, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    /* Row + Curl and Leg Press + Calf Raise are supersets; Bench is alone. */
    await page.evaluate(lib => {
      const t = window.testAPI;
      t.state.exercises = lib; t.state.workouts = []; t.state.activeWorkout = null;
      t.state.routines = [{ id:'r', name:'All', items:lib.map((e, i) => ({ id:'i' + i, exerciseId:e.id, sets:2, repsMin:8, repsMax:10, targetRir:2, weight:40,
        ...(i === 1 || i === 2 ? { supersetOf:'a' } : i >= 3 ? { supersetOf:'b' } : {}) })) }];
      t.startRoutine('r'); t.navigate('today');
    }, lib);
    const at = () => page.evaluate(() => { const t = window.testAPI, w = t.state.activeWorkout; return t.currentMemberIndex(w); });
    const supersets = await page.evaluate(() => window.testAPI.state.activeWorkout.exercises.map(x => x.supersetOf || null));
    assert.deepEqual(supersets.map(Boolean), [false, true, true, true, true], 'the session carries both supersets');

    for (let i = 1; i < names.length; i++){
      await page.locator('#btn-next-ex').click();
      assert.equal(await at(), i, 'next lands on exercise ' + (i + 1));
    }
    assert.equal(await page.locator('#btn-next-ex').getAttribute('aria-label'), 'Wrap up', 'the last exercise offers Wrap up');
    for (let i = names.length - 2; i >= 0; i--){
      await page.locator('#btn-prev-ex').click();
      assert.equal(await at(), i, 'previous lands on exercise ' + (i + 1));
    }
    assert.equal(await page.locator('#btn-prev-ex').isDisabled(), true, 'previous is off on the first exercise');
    assert.deepEqual(errors, []);
    console.log('step-order: ' + (names.length * 2 + 3) + ' checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
