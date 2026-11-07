// Tabata partner pyramid at phone width: mode switch, swap-call entry and validation, partner labels, recovery and finish.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/tabata/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('tabata');
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await page.route('https://tabata.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.clock.install({time:new Date('2026-01-01T12:00:00Z')});
    await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
    await page.goto('https://tabata.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tabata.state.v1')));
    const text=selector=>page.locator(selector).textContent();

    // Work & rest stays the default; the pyramid starts from the standard swap calls.
    assert.equal(await page.isChecked('input[name=mode][value=intervals]'),true);
    assert.equal(await page.locator('#ladder').isVisible(),false);assert.equal(await page.locator('#work').isVisible(),true);
    await page.getByText('Partner pyramid',{exact:true}).click();
    assert.equal(await page.locator('#work').isVisible(),false,'Work, rest and rounds hide in a pyramid');
    assert.equal(await page.locator('#rounds').isVisible(),false);
    assert.equal(await page.inputValue('#ladder'),'30, 30, 45, 45, 60, 60, 45, 45, 30, 30');
    assert.equal(await text('#totalTime'),'7:05','5 s get ready plus 420 s of swap calls');
    assert.equal(await text('#planHint'),'5s to get ready · 10 swap calls. Partner A works 3:30, Partner B works 3:30.');
    assert.equal((await saved()).settings.mode,'pyramid','The mode saves on change');
    assert.equal(await page.locator('#ladderHint').count(),0,'The swap calls field has no help text');
    assert.equal(await page.inputValue('#ladderRest'),'0','No rest between calls by default');
    for(const width of [320,390]){
      await page.setViewportSize({width,height:700});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Pyramid setup fits '+width);
    }
    await page.setViewportSize({width:390,height:844});

    // Invalid swap calls block Start and keep the last saved ladder.
    await page.fill('#ladder','30');
    assert.equal(await page.locator('#start').isDisabled(),true);assert.match(await text('#planHint'),/Enter 2 to 40 swap calls/);
    await page.fill('#ladder','30, abc');assert.match(await text('#planHint'),/separated by commas/);
    await page.locator('#ladder').press('Tab');assert.equal((await saved()).settings.ladder.length,10,'An invalid ladder never saves');
    await page.getByRole('button',{name:'Standard pyramid',exact:true}).click();
    assert.equal(await page.inputValue('#ladder'),'30, 30, 45, 45, 60, 60, 45, 45, 30, 30');assert.equal(await page.locator('#start').isDisabled(),false);
    await page.fill('#ladder','2,3 , 2');await page.locator('#ladder').press('Tab');
    assert.equal(await text('#totalTime'),'0:12');assert.deepEqual((await saved()).settings.ladder,[2,3,2]);
    await page.reload();
    assert.equal(await page.isChecked('input[name=mode][value=pyramid]'),true,'The mode survives a reload');
    assert.equal(await page.inputValue('#ladder'),'2, 3, 2','Swap calls show comma separated');
    await page.screenshot({path:'/tmp/wellbeing-tabata-pyramid-setup.png'});

    // Each swap call belongs to one partner; the other partner rests.
    await page.click('#start');
    assert.equal(await text('#phaseName'),'Get ready');assert.equal(await text('#nextPhase'),'Next: Partner A · 2s');
    await page.clock.fastForward(5000);
    assert.equal(await text('#phaseName'),'Partner A');assert.equal(await text('#roundLabel'),'Swap 1 of 3 · 2s');
    assert.equal(await text('#nextPhase'),'Next: Partner B · 3s');assert.equal(await page.getAttribute('#timerPanel','data-partner'),'A');
    const colorA=await page.locator('#timerPanel').evaluate(node=>getComputedStyle(node).borderTopColor);
    await page.clock.fastForward(2000);
    assert.equal(await text('#phaseName'),'Partner B');assert.equal(await text('#roundLabel'),'Swap 2 of 3 · 3s');
    assert.notEqual(await page.locator('#timerPanel').evaluate(node=>getComputedStyle(node).borderTopColor),colorA,'Partners have different colours');
    assert.match(await page.title(),/^Partner B /);
    await page.screenshot({path:'/tmp/wellbeing-tabata-pyramid-run.png'});
    await page.clock.fastForward(1000);
    await page.reload();
    assert.equal(await page.locator('#recovered').isVisible(),true,'A running pyramid recovers paused');
    assert.equal(await text('#phaseName'),'Paused · Partner B');assert.equal((await saved()).active.config.mode,'pyramid');
    await page.click('#pause');await page.clock.fastForward(2000);
    assert.equal(await text('#phaseName'),'Partner A');assert.equal(await text('#nextPhase'),'Next: Finish');
    await page.clock.fastForward(2000);
    assert.equal(await page.locator('#complete').isVisible(),true);
    assert.equal(await text('#completeSummary'),'3 of 3 swap calls · 0:12 total');
    const row=(await saved()).history[0];assert.equal(row.outcome,'complete');assert.deepEqual(row.config.ladder,[2,3,2]);

    // Switching back keeps both setups.
    await page.click('#editSetup');await page.getByText('Work & rest',{exact:true}).click();
    assert.equal(await page.locator('#ladder').isVisible(),false);assert.equal(await page.inputValue('#work'),'60');
    assert.equal(await text('#totalTime'),'8:26');
    const settings=(await saved()).settings;assert.equal(settings.mode,'intervals');assert.deepEqual(settings.ladder,[2,3,2],'The ladder is remembered in interval mode');
    await page.getByText('Partner pyramid',{exact:true}).click();assert.equal(await page.inputValue('#ladder'),'2, 3, 2');

    // A rest between calls follows each call except the last.
    await page.fill('#ladderRest','4');await page.locator('#ladderRest').press('Tab');
    assert.equal(await text('#totalTime'),'0:20','5 s get ready, 7 s of calls and two 4 s rests');
    assert.equal(await text('#planHint'),'5s to get ready · 3 swap calls / 4s rest. Partner A works 0:04, Partner B works 0:03.');
    assert.equal((await saved()).settings.ladderRest,4);
    await page.click('#start');await page.clock.fastForward(5000);
    assert.equal(await text('#nextPhase'),'Next: Rest · 4s');
    await page.clock.fastForward(2000);
    assert.equal(await text('#phaseName'),'Rest');assert.equal(await text('#roundLabel'),'After swap 1 of 3');
    assert.equal(await text('#nextPhase'),'Next: Partner B · 3s');assert.equal(await page.getAttribute('#timerPanel','data-partner'),'');
    const restColor=await page.locator('#timerPanel').evaluate(node=>getComputedStyle(node).borderTopColor);
    await page.clock.fastForward(4000);assert.equal(await text('#phaseName'),'Partner B');
    assert.notEqual(await page.locator('#timerPanel').evaluate(node=>getComputedStyle(node).borderTopColor),restColor,'Partner B and rest have different colours');
    await page.clock.fastForward(7000);assert.equal(await text('#phaseName'),'Partner A');assert.equal(await text('#nextPhase'),'Next: Finish');
    await page.clock.fastForward(2000);assert.equal(await text('#completeSummary'),'3 of 3 swap calls · 0:20 total');
    assert.equal((await saved()).history[0].config.ladderRest,4);
    assert.equal((await saved()).version,3);
    assert.deepEqual(errors,[]);
    console.log('PASS Tabata pyramid: mode switch, swap-call validation, partner labels and colours, recovery, rests between calls, finish and remembered setups');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
