// The Routines tab imports a routines file without a trip to Settings. node tests/routines-import.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ navigate, render, sampleRoutinesFile, get state(){return state} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const sample = await page.evaluate(() => {
      const t = window.testAPI;
      t.state.exercises = []; t.state.routines = []; t.state.workouts = [];
      t.navigate('routines');
      return JSON.stringify(t.sampleRoutinesFile());
    });
    const file = { name:'routines.json', mimeType:'application/json', buffer:Buffer.from(sample) };
    const pickers = page.locator('#main input[data-change="import-routines"]');

    /* With no routines, the empty state carries the one import button. */
    assert.equal(await pickers.count(), 1, 'the empty Routines tab shows one import button');
    assert.equal(await page.locator('.empty .file-btn').textContent(), ' Import routines');
    await pickers.first().setInputFiles(file);
    await page.waitForFunction(() => window.testAPI.state.routines.length === 2);
    assert.match(await page.locator('#toast-region').textContent(), /Imported 2 routines/);

    /* With routines, a quiet Import sits right of New routine in the header. */
    const quiet = page.locator('.view-head .file-btn.is-quiet');
    assert.equal(await quiet.count(), 1, 'the header shows a quiet import button');
    assert.equal((await quiet.textContent()).trim(), 'Import');
    const [q, n] = [await quiet.boundingBox(), await page.locator('.view-head [data-action="routine-new"]').boundingBox()];
    assert.ok(q.height < n.height, 'the import button is smaller than New routine');
    assert.ok(q.x > n.x + n.width, 'the import button sits to the right of New routine');
    await quiet.locator('input').setInputFiles(file);
    await page.waitForFunction(() => /skipped/.test(document.querySelector('#toast-region').textContent));
    assert.equal(await page.evaluate(() => window.testAPI.state.routines.length), 2, 'importing the same file again adds nothing');

    /* The editor replaces the header's actions. */
    await page.locator('.view-head [data-action="routine-new"]').click();
    assert.equal(await page.locator('.view-head input[data-change="import-routines"]').count(), 0, 'the routine editor has no import button');

    assert.deepEqual(errors, []);
    console.log('routines-import: 9 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
