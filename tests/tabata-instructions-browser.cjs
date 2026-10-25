// Tabata instructions at phone width: the setup editor, the run-screen pop-out and its effect on the timer.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/tabata/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('tabata');
const steps='# Circuit\nTwo moves, alternate each round.\n\n1. **Burpees**\n   - chest to floor\n2. Jump squats\n\n[video](https://example.com/burpee) <img src=x onerror=alert(1)>';
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await page.route('https://tabata.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.clock.install({time:new Date('2026-01-01T12:00:00Z')});
    await page.goto('https://tabata.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tabata.state.v1')));
    const button=page.getByRole('button',{name:'Instructions',exact:true});

    assert.equal(await page.locator('#instructionsBox').evaluate(box=>box.open),false,'the editor starts collapsed');
    assert.equal(await page.textContent('#instructionsState'),'Optional');
    await page.click('#instructionsBox summary');
    const box=page.locator('#instructions'),preview=page.locator('#instructions-preview'),toggle=page.locator('#instructionsPreview');
    assert.equal(await box.getAttribute('maxlength'),'10000');
    await box.fill(steps);
    assert.equal(await page.textContent('#instructionsState'),'Added');
    assert.equal((await saved()).settings.instructions,steps,'typing saves the instructions');assert.equal((await saved()).version,2);
    await toggle.click();
    assert.equal(await box.isVisible(),false);assert.equal(await preview.isVisible(),true);
    assert.match(await preview.innerHTML(),/<h3>Circuit<\/h3><p>Two moves, alternate each round\.<\/p><ol><li><strong>Burpees<\/strong><ul><li>chest to floor<\/li><\/ul><\/li><li>Jump squats<\/li><\/ol>/);
    assert.equal(await preview.locator('a,img').count(),0,'links and HTML show as typed');
    await toggle.click();assert.equal(await box.inputValue(),steps,'Edit keeps the typed text');
    console.log('PASS setup saves instructions as typed and previews them without links or HTML');

    await page.fill('#work','5');await page.fill('#rounds','1');await page.locator('#rounds').press('Tab');
    await page.click('#start');await button.waitFor();
    const before=await page.textContent('#clock');
    await button.click();
    const pop=page.getByRole('dialog',{name:'Instructions'});await pop.waitFor();
    assert.match(await pop.innerText(),/Circuit[\s\S]*Burpees[\s\S]*chest to floor[\s\S]*\[video\]\(https:\/\/example\.com\/burpee\) <img src=x onerror=alert\(1\)>/);
    assert.equal(await pop.locator('a,img').count(),0);
    assert.deepEqual(await pop.locator('.md ol, .md ul').evaluateAll(lists=>lists.map(l=>getComputedStyle(l).listStyleType)),['decimal','circle']);
    await page.setViewportSize({width:320,height:568});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the pop-out fits 320 px');
    await page.setViewportSize({width:390,height:844});
    await page.clock.runFor(2000);
    assert.notEqual(await page.textContent('#clock'),before,'the timer keeps running behind the pop-out');
    assert.equal((await saved()).active.status,'running');
    await page.keyboard.press('Escape');await pop.waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.activeElement.id),'openInstructions','focus returns to the button');
    await button.click();await pop.getByRole('button',{name:'Back to timer',exact:true}).click();await pop.waitFor({state:'hidden'});
    console.log('PASS the run screen opens instructions over a running timer; Escape and Back to timer close it');

    await button.click();await pop.waitFor();
    await page.clock.runFor(10000);
    await page.locator('#complete').waitFor();
    assert.equal(await page.locator('#instructionsDialog').evaluate(dialog=>dialog.open),false,'finishing closes the pop-out');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'again');
    assert.equal((await saved()).history[0].config.instructions,undefined,'history does not copy instructions');
    console.log('PASS finishing closes the pop-out and history keeps no copy');

    await page.reload();await page.click('#instructionsBox summary');
    assert.equal(await page.inputValue('#instructions'),steps,'instructions survive a reload');
    await page.fill('#instructions','   ');
    assert.equal(await page.textContent('#instructionsState'),'Optional');
    await page.click('#start');await page.locator('#run').waitFor();
    assert.equal(await page.locator('#openInstructions').isVisible(),false,'blank instructions show no button');
    console.log('PASS instructions persist; blank instructions hide the run-screen button');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
