// A talk test end to end at phone width: HR bands checked live, a question per step, and the zone 2 ceiling it proposes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {confirmAction}=require('./confirm-dialog.cjs');
const {navigate}=require('./ui-navigation.cjs');
const root=path.join(__dirname,'..','..');
const sample=name=>fs.readFileSync(path.join(root,'examples',name),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,handle,render,get session(){return session},get h10(){return h10}};');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://talk.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://talk.test/');
  const api=fn=>page.evaluate(fn);
  const noSideScroll=async where=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),where+' fits the screen width');
  const add=async (json,expect)=>{await page.click('#importPlan');const dialog=page.getByRole('dialog',{name:'Import planned sessions'});await page.fill('#planInput',json);
    await dialog.getByRole('button',{name:'Check plan'}).click();const text=await dialog.locator('.plan-preview').textContent();
    await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'detached'});return text;};

  // Both samples import. The Zone 2 ride's footer counts its own 35-minute main block.
  assert.match(await add(sample('bike-plan-zone2.json')),/45 min minimum/);
  const preview=await add(sample('bike-plan-talk-test.json'));
  assert.match(preview,/25 min minimum/);assert.match(preview,/115–120 · 80–90 rpm · Settle into 115 to 120\. Adjust resistance, keep cadence\. · Asks: Count aloud to 20/);
  assert.match(preview,/the last step passed before the first failed one proposes your zone 2 ceiling/);
  await page.getByRole('button',{name:'Use Zone 2 ride'}).click();await confirmAction(page,()=>page.click('#start'));await page.waitForFunction(()=>!!window.testAPI.session);
  assert.equal(await page.textContent('#mainElapsed'),'Main 0:00 / 35:00','the plan’s main block, not the Settings length');
  await api(()=>{const t=window.testAPI;t.handle(WorkoutCore.end(t.session,Date.now()));});await page.locator('#summary').waitFor();
  await navigate(page,'setup');

  // The talk test: a band per step, checked against a live strap reading.
  await page.getByRole('button',{name:'Use Talk test'}).click();await confirmAction(page,()=>page.click('#start'));await page.waitForFunction(()=>window.testAPI.session?.config.plan?.name==='Talk test');
  assert.equal(await page.textContent('#mainElapsed'),'','no main block, no main counter');
  const skipTo=title=>page.evaluate(title=>{const t=window.testAPI;for(let n=0;n<20&&WorkoutCore.phase(t.session).title!==title;n++)t.handle(WorkoutCore.skip(t.session,Date.now()));},title);
  const intoWindow=()=>page.evaluate(()=>{const t=window.testAPI;t.session.phaseMs=215000;t.session.lastAt=Date.now();t.handle(WorkoutCore.advance(t.session,Date.now()));});
  await skipTo('Step 1');
  assert.equal(await page.textContent('#targetHR'),'115–120');assert.equal(await page.textContent('#liveAdvice'),'Hold 115–120 · read HR on your watch');
  await api(()=>{const t=window.testAPI;t.h10.reading={bpm:122,valid:true,contact:true,rr:[],at:Date.now()};t.render();});
  assert.equal(await page.textContent('#liveAdvice'),'Above 120 · ease one level','the step band, not the zone 2 targets');
  assert.equal(await page.getAttribute('.live-heart','data-alert'),'high');
  await api(()=>{const t=window.testAPI;t.h10.reading={bpm:118,valid:true,contact:true,rr:[],at:Date.now()};t.render();});
  assert.equal(await page.textContent('#liveAdvice'),'In 115–120 · hold resistance');
  await api(()=>{window.testAPI.h10.reading=null;window.testAPI.render();});

  // The question opens 30 s before the step ends and stays answerable into the next step.
  assert.equal(await page.isVisible('#stepCheck'),false,'not before the window');
  await intoWindow();await page.locator('#stepCheck').waitFor();
  assert.equal(await page.textContent('#stepCheckTitle'),'Step 1 · 115–120: Count aloud to 20');
  await page.locator('#stepCheckOptions').getByRole('button',{name:'Smooth'}).click();
  assert.equal(await page.getAttribute('#stepCheckOptions button:first-child','aria-pressed'),'true');
  await skipTo('Step 2');assert.equal(await page.textContent('#stepCheckTitle'),'Step 1 · 115–120: Count aloud to 20','still open during the next step');
  await noSideScroll('Ride with a step question');
  await intoWindow();assert.equal(await page.textContent('#stepCheckTitle'),'Step 2 · 120–125: Count aloud to 20');
  await page.locator('#stepCheckOptions').getByRole('button',{name:'Smooth'}).click();
  await skipTo('Step 3');await intoWindow();await page.locator('#stepCheckOptions').getByRole('button',{name:'Broken'}).click();
  assert.equal(JSON.stringify(await api(()=>window.testAPI.session.checks.map(c=>c.answer))),'["Smooth","Smooth","Broken"]');
  await api(()=>{const t=window.testAPI;t.handle(WorkoutCore.end(t.session,Date.now()));});

  // The summary lists the answers and proposes the top of step 2's band (no strap); applying it rewrites the targets, Undo restores them.
  await page.locator('#checkTable table').waitFor();await noSideScroll('Talk-test summary');
  assert.equal(await page.locator('#checkTable tbody tr').count(),3);assert.equal(await page.inputValue('#check-2'),'Broken');
  assert.match(await page.textContent('#ceilingText'),/Last step passed: Step 2 \(120–125\), no strap reading, so the top of its band\. Step 3 failed first, so this is your ceiling\. Steps after it do not count\./);
  await page.getByRole('button',{name:'Set zone 2 ceiling to 125'}).click();
  const targets=()=>api(()=>JSON.stringify(window.testAPI.storage.state.settings.targets));
  assert.equal(await targets(),JSON.stringify({zoneMin:105,zoneMax:125,targetMin:111,targetMax:123,adjustBelow:109,comparisonHR:117}));
  assert.match(await page.textContent('#ceilingNote'),/Zone 2 is now 105–125 bpm, working band 111–123\. Rides with these targets start a new progress series\./);
  assert.equal(await page.isVisible('#applyCeiling'),false,'nothing left to apply');
  await page.locator('#toast').getByRole('button',{name:'Undo'}).click();
  assert.equal(await targets(),JSON.stringify({zoneMin:105,zoneMax:122,targetMin:110,targetMax:120,adjustBelow:108,comparisonHR:115}));

  // A corrected answer saves with the ride and moves the proposal.
  await page.selectOption('#check-2','Smooth');
  assert.equal(await api(()=>window.testAPI.storage.state.history[0].checks[2].answer),'Smooth');
  assert.match(await page.textContent('#ceilingText'),/Step 3 \(125–130\).*Every step you answered passed, so the limit may be higher\./);
  assert.equal(await page.textContent('#applyCeiling'),'Set zone 2 ceiling to 130');

  // The adaptive sample: a hard cap, a band shift after a failed step, HR and watts typed in, and the note hint.
  await navigate(page,'setup');
  assert.equal(await page.isVisible('#importPlan'),true,'the import button sits at the top of the Workout screen');
  const adaptivePreview=await add(sample('bike-plan-talk-test-adaptive.json'));
  assert.match(adaptivePreview,/40 min minimum/);assert.match(adaptivePreview,/125–130 \(max 132\)/);
  assert.match(adaptivePreview,/A failed answer lowers the HR bands of later steps by 5 bpm\./);assert.match(adaptivePreview,/write in the conditions note: Sleep last night, hours and quality\./);
  await page.getByRole('button',{name:'Use Talk test, adaptive'}).click();await confirmAction(page,()=>page.click('#start'));await page.waitForFunction(()=>window.testAPI.session?.config.plan?.id==='talk-test-adaptive');
  assert.equal(JSON.stringify(await api(()=>window.testAPI.session.confirmed)),'["Incline: 2% fixed","Cadence: 80 to 85 rpm","Strap: Electrodes wet"]');
  const longWindow=()=>page.evaluate(()=>{const t=window.testAPI;t.session.phaseMs=575000;t.session.lastAt=Date.now();t.handle(WorkoutCore.advance(t.session,Date.now()));});
  const reading=bpm=>page.evaluate(bpm=>{const t=window.testAPI;t.h10.reading={bpm,valid:true,contact:true,rr:[],at:Date.now()};t.render();},bpm);
  await skipTo('Step 1');await longWindow();await page.locator('#stepCheckOptions').getByRole('button',{name:'Smooth'}).click();
  await skipTo('Step 2');await longWindow();await page.locator('#stepCheckOptions').getByRole('button',{name:'Needed a breath'}).click();
  await skipTo('Step 3');
  assert.equal(await page.textContent('#targetHR'),'120–125 (max 127)','the failed step 2 lowered step 3 by 5');
  assert.match(await page.textContent('#cue'),/Bands are 5 bpm lower after a failed check\./);
  await reading(126);assert.equal(await page.textContent('#liveAdvice'),'Above 125 · ease one level');
  await reading(128);assert.equal(await page.textContent('#liveAdvice'),'Above 127 · ease resistance now','past the cap');
  await api(()=>{window.testAPI.h10.reading=null;window.testAPI.render();});
  await api(()=>{const t=window.testAPI;t.handle(WorkoutCore.end(t.session,Date.now()));});
  await page.locator('#checkTable table').waitFor();await noSideScroll('Adaptive talk-test summary');
  assert.match(await page.textContent('#checkTable tbody tr:nth-child(3) td:first-child'),/Step 3.*120–125 \(max 127\) · -5 bpm/);
  assert.equal(await page.getAttribute('#condNote','placeholder'),'Sleep last night, hours and quality');
  assert.match(await page.textContent('#ceilingText'),/Last step passed: Step 1 \(115–120\), no strap reading, so the top of its band\. Step 2 failed first, so this is your ceiling\./);
  await page.fill('#checkHR-0','117');await page.fill('#checkWatts-0','98');
  const saved=await api(()=>window.testAPI.storage.state.history[0].checks[0]);
  assert.equal(JSON.stringify([saved.averageHR,saved.hrSource,saved.averageWatts,saved.wattsSource]),'[117,"manual",98,"manual"]');
  assert.match(await page.textContent('#ceilingText'),/measured 117 bpm/,'a typed HR counts as the step reading');
  await page.fill('#checkWatts-0','');assert.equal(await api(()=>window.testAPI.storage.state.history[0].checks[0].wattsSource),null);
  assert.deepEqual(errors,[]);
  console.log('PASS bike-cardio: talk test bands, step questions, ceiling proposal and the Zone 2 sample');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
