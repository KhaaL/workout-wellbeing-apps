// Dragging a row to an edge of a long list scrolls the list. node tests/reorder-scroll.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

/* Presses the handle, moves to `y` and holds there, then releases. Returns the
   pointer's distance below the dragged row's top edge at the start and just
   before release, which must match for the row to stay under the finger, and
   how far the page, or the `scroller` element, scrolled while the pointer was
   held and where it ended up. The drop's render then focuses the moved handle, which can scroll again. */
async function dragAndHold(page, handle, y, ms, scroller){
  await handle.scrollIntoViewIfNeeded();
  const pos = () => page.evaluate(sel => sel ? document.querySelector(sel).scrollTop : window.scrollY, scroller || null);
  const initial = await pos();
  const b = await handle.boundingBox();
  const x = b.x + b.width/2, y0 = b.y + b.height/2;
  const offset = at => page.evaluate(p => p - document.querySelector('.is-dragging').getBoundingClientRect().top, at);
  await page.mouse.move(x, y0); await page.mouse.down();
  const start = await offset(y0);
  await page.mouse.move(x, y, { steps:10 });
  await page.waitForTimeout(ms);
  const end = await offset(y);
  const scrolled = await pos();
  await page.mouse.up();
  return { start, end, scrolled:scrolled - initial, at:scrolled };
}

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, newRoutineDraft, startRoutine, get state(){return state}, get ui(){return ui} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    await page.evaluate(() => {
      const t = window.testAPI;
      const ex = Array.from({ length:16 }, (_, i) => ({ id:'e' + i, name:'Exercise ' + i, category:'Legs', unit:'kg' }));
      const r = { id:'r1', name:'Long', items:ex.map(e => ({ exerciseId:e.id, sets:3, repsMin:5, repsMax:8, weight:null })) };
      t.state.exercises = ex; t.state.workouts = []; t.state.routines = [r];
      t.navigate('routines');
      t.ui.routineDraft = t.newRoutineDraft(r); t.render();
    });
    const order = () => page.evaluate(() => window.testAPI.ui.routineDraft.items.map(i => i.exerciseId));

    /* The routine editor scrolls the page. */
    const up = await dragAndHold(page, page.locator('#routine-form [data-drag]').last(), 80, 6000);
    assert.ok(up.scrolled < -500, 'holding a routine item at the top scrolls the page up');
    assert.equal(Math.round(up.end), Math.round(up.start), 'the dragged routine item stays under the pointer while the page scrolls');
    assert.ok((await order()).indexOf('e15') < 12, 'the last routine item moves up past the rows scrolled into view');

    const down = await dragAndHold(page, page.locator('#routine-form [data-drag]').first(), 835, 2000);
    assert.ok(down.scrolled > 500, 'holding a routine item at the bottom scrolls the page down');
    assert.equal(Math.round(down.end), Math.round(down.start), 'the dragged routine item stays under the pointer while scrolling down');
    assert.ok((await order()).indexOf('e0') > 2, 'holding the first routine item at the bottom carries it down the list');

    /* The session sheet scrolls its own body. */
    await page.evaluate(() => {
      const t = window.testAPI;
      t.ui.routineDraft = null; t.startRoutine('r1'); t.ui.overviewOpen = true; t.render();
    });
    const body = page.locator('#overview-dlg-body');
    const top = (await body.boundingBox()).y;
    const sheet = await dragAndHold(page, page.locator('#overview-dlg-body [data-drag]').last(), top + 10, 4000, '#overview-dlg-body');
    assert.ok(sheet.scrolled < -500 && sheet.at < 1, 'holding a session exercise at the top scrolls the sheet to its start');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].exerciseId), 'e15',
      'the last session exercise lands first');

    assert.deepEqual(errors, []);
    console.log('reorder-scroll: 8 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
