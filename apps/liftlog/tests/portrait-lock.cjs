// The Lock to portrait switch asks the browser to hold the screen upright and degrades with a hint. node tests/portrait-lock.cjs after npm run build.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');

async function open(browser, stub){
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(stub);
  const html = appWithTestAPI(`{ navigate, render, get state(){return state} }`);
  await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
  await page.goto('https://liftlog.test/');
  await page.evaluate(() => { window.testAPI.navigate('settings'); });
  return { page, errors };
}
const calls = page => page.evaluate(() => window.__orientationCalls.slice());

(async () => {
  const browser = await launchBrowser();
  try {
    /* 1. Supported: on locks to portrait, off unlocks, the choice is saved. */
    let { page, errors } = await open(browser, () => {
      window.__orientationCalls = [];
      Object.defineProperty(screen, 'orientation', { configurable:true, value:{
        lock: type => { window.__orientationCalls.push('lock:' + type); return Promise.resolve(); },
        unlock: () => { window.__orientationCalls.push('unlock'); } } });
    });
    const sw = page.locator('#sw-portrait');
    assert.equal(await sw.isDisabled(), false, 'the switch is usable where the lock exists');
    assert.equal(await sw.isChecked(), false, 'off by default');
    assert.deepEqual(await calls(page), [], 'nothing is locked until asked');
    await sw.check({ force:true });
    await page.waitForFunction(() => window.__orientationCalls.includes('lock:portrait'));
    assert.equal(await page.evaluate(() => window.testAPI.state.settings.portraitLock), true, 'the choice is saved');
    await page.evaluate(() => window.testAPI.render());
    assert.deepEqual(await calls(page), ['lock:portrait'], 'a render does not ask again');
    await page.locator('#sw-portrait').uncheck({ force:true });
    assert.deepEqual(await calls(page), ['lock:portrait', 'unlock'], 'off unlocks');
    assert.deepEqual(errors, []);
    await page.close();

    /* 2. Rejected (a browser tab): one toast, no retry on later renders. */
    ({ page, errors } = await open(browser, () => {
      window.__orientationCalls = [];
      Object.defineProperty(screen, 'orientation', { configurable:true, value:{
        lock: () => { window.__orientationCalls.push('lock'); return Promise.reject(new Error('NotSupportedError')); },
        unlock: () => {} } });
    }));
    await page.locator('#sw-portrait').check({ force:true });
    await page.waitForFunction(() => /did not allow the portrait lock/.test(document.querySelector('#toast-region').textContent));
    await page.evaluate(() => window.testAPI.render());
    assert.deepEqual(await calls(page), ['lock'], 'a refusal is not retried on every render');
    assert.deepEqual(errors, []);
    await page.close();

    /* 3. No API (iOS): the switch is disabled and says why. */
    ({ page, errors } = await open(browser, () => {
      Object.defineProperty(screen, 'orientation', { configurable:true, value:{} });
    }));
    assert.equal(await page.locator('#sw-portrait').isDisabled(), true, 'the switch is disabled without the API');
    assert.match(await page.locator('label[for="sw-portrait"] .hint').textContent(), /iOS/);
    assert.deepEqual(errors, []);
    console.log('portrait-lock: 12 checks passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
