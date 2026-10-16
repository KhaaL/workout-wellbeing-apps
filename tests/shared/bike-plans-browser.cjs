// Planned sessions end to end at phone width: paste a plan, ride it, log efforts, mark a baseline, compare.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {navigate}=require('./ui-navigation.cjs');
const {confirmAction}=require('./confirm-dialog.cjs');
const root=path.join(__dirname,'..','..');
const plan=fs.readFileSync(path.join(root,'examples','bike-plan-sprint.json'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,handle,showSummary,get session(){return session},get records(){return records},set records(v){records=v}};');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://plans.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://plans.test/');
  const api=fn=>page.evaluate(fn);
  const noSideScroll=async where=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),where+' fits the screen width');

  // Invalid JSON names the problem; a valid plan previews as its phase table before saving.
  await page.click('#addPlan');const add=page.getByRole('dialog',{name:'Add planned sessions'});
  await page.fill('#planInput','{"name": "x",');await add.getByRole('button',{name:'Check plan'}).click();
  assert.match(await add.locator('.save-status').textContent(),/not valid JSON/);assert.equal(await add.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
  await page.fill('#planInput','```json\n'+plan+'\n```');await add.getByRole('button',{name:'Check plan'}).click();
  assert.match(await add.locator('.plan-preview').textContent(),/20:35 minimum · 4 efforts/);
  assert.equal(await add.locator('.plan-preview tbody tr').count(),11,'one row per phase without the countdowns');
  await add.getByRole('button',{name:'Save',exact:true}).click();await add.waitFor({state:'detached'});
  assert.equal(await api(()=>window.testAPI.storage.state.plans.length),1);await noSideScroll('Workout screen');

  // Use sets up the next ride; Start asks to confirm the plan's conditions.
  await page.getByRole('button',{name:'Use Sprint baseline'}).click();
  assert.equal(await page.textContent('#start'),'Start Sprint baseline');assert.equal(await page.isVisible('#modeChoice'),false);
  await confirmAction(page,()=>page.click('#start'));await page.waitForFunction(()=>!!window.testAPI.session);
  assert.equal(JSON.stringify(await api(()=>window.testAPI.session.confirmed)),'["Incline: 0%"]');
  const skipTo=kind=>page.evaluate(kind=>{const t=window.testAPI;for(let n=0;n<50&&WorkoutCore.phase(t.session).kind!==kind;n++)t.handle(WorkoutCore.skip(t.session,Date.now()));},kind);
  await skipTo('effort');assert.equal(await page.textContent('#targetResistance'),'16');

  // After effort 1 the prompt holds the target; "Above 110" sets effort 2 to 18.
  await api(()=>window.testAPI.handle(WorkoutCore.skip(window.testAPI.session,Date.now())));
  await page.locator('#effortLog').waitFor();assert.equal(await page.inputValue('#effortResistance'),'16');
  await page.locator('#effortLog').getByText('Above 110',{exact:true}).click();
  assert.equal(await page.textContent('#nextEffort'),'Next effort: resistance 18.');
  assert.equal(await page.locator('#gateLabel').textContent(),'My current HR is 122 bpm or below.');
  await skipTo('ready');assert.equal(await page.textContent('#targetResistance'),'18');assert.equal(await page.isVisible('#effortLog'),false);
  await skipTo('recovery');await page.locator('#effortLog').waitFor();
  await page.locator('#effortLog').getByRole('button',{name:'Increase Resistance used'}).click();
  assert.equal(await page.textContent('#nextEffort'),'Next effort: resistance 19.','a changed resistance is the next starting point');
  await api(()=>window.testAPI.handle(WorkoutCore.end(window.testAPI.session,Date.now())));

  // The summary lists the efforts; conditions and the baseline flag save with the ride.
  await page.locator('#effortTable table').waitFor();
  assert.equal(await page.inputValue('#effortRes-0'),'16');assert.equal(await page.inputValue('#effortRes-1'),'19');
  assert.match(await page.textContent('#conditionsConfirmed'),/Incline: 0%/);await noSideScroll('Summary');
  await page.fill('#condHours','44');await page.selectOption('#condFed','fed');await page.selectOption('#condTime','morning');await page.check('#condBaseline');
  await page.fill('#effortWatts-0','610');
  const first=await api(()=>window.testAPI.storage.state.history[0]);
  assert.equal(first.baseline,true);assert.equal(first.conditions.hoursSinceLifting,44);assert.equal(first.efforts[0].watts5s,610);assert.equal(first.efforts[0].wattsSource,'manual');
  assert.equal(first.config.plan.name,'Sprint baseline');

  // A later ride of the same plan compares with the baseline and names the different time of day.
  await api(()=>{const t=window.testAPI,base=t.storage.state.history[0],later=structuredClone(base);later.id='later';later.startedAt=base.startedAt+86400000;delete later.baseline;later.conditions={...base.conditions,timeOfDay:'evening'};later.efforts[0].watts5s=640;
    t.storage.write('bike-cardio.history.v1',[later,base],{atomic:true});t.records=t.storage.state.history;t.showSummary(t.storage.state.history[0]);});
  // Values typed for one ride never save onto the next one shown.
  assert.equal(JSON.stringify(await api(()=>window.testAPI.storage.state.history.map(r=>[r.id==='later',!!r.baseline]))),'[[true,false],[false,true]]');
  const comparison=page.locator('#finished-comparison');
  assert.equal(await comparison.locator('h3').first().textContent(),'Compared with your baseline');
  await comparison.locator('details summary').click();assert.match(await comparison.textContent(),/Conditions differ: time of day \(morning, then evening\)/);
  await navigate(page,'history');assert.match(await page.locator('#historyList').textContent(),/Sprint baseline · Baseline/);

  // Deleting the plan keeps the rides and their copy of it.
  await navigate(page,'setup');await page.getByRole('button',{name:'Details for Sprint baseline'}).click();
  await confirmAction(page,()=>page.getByRole('dialog',{name:'Sprint baseline'}).getByRole('button',{name:'Delete plan…'}).click());
  assert.equal(await api(()=>window.testAPI.storage.state.plans.length),0);assert.equal(await api(()=>window.testAPI.storage.state.history.filter(r=>r.config.plan).length),2);
  assert.equal(await page.textContent('#start'),'Start Zone 2 session','the deleted plan no longer sets up the next ride');
  assert.deepEqual(errors,[]);
  console.log('PASS bike-cardio: planned sessions import, ride prompts, effort logging, baseline comparison and deletion');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
