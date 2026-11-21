// Resistance and incline: filled in at setup, adjusted with buttons on the run screen, logged with the time of each change and kept in the saved ride, summary, CSV and backup.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..','..');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,handle,render,get session(){return session},get h10(){return h10}};');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://load.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://load.test/');
  const text=sel=>page.locator(sel).textContent();

  // Without start values nothing is recorded and the run screen has no buttons.
  await page.click('#start');await page.waitForFunction(()=>!!window.testAPI.session);
  assert.equal(await page.locator('#loadCard').isVisible(),false,'no card when nothing was filled in');
  assert.equal(await page.evaluate(()=>window.testAPI.session.loadLog.length),0);
  await page.evaluate(()=>{const t=window.testAPI;t.handle(WorkoutCore.end(t.session,Date.now()));});await page.locator('#summary').waitFor();
  assert.equal(await page.locator('#loadSummary').isVisible(),false,'no log, no summary card');
  await page.click('#again');

  // Starting values are typed at setup; the steppers work on them and they are remembered for the next ride.
  await page.fill('#startResistance','6');await page.fill('#startIncline','2');await page.locator('#startIncline').press('Tab');
  await page.click('button[aria-label="Increase Starting incline"]');
  assert.equal(await page.inputValue('#startIncline'),'2.5','incline steps by half a percent');
  await page.click('button[aria-label="Decrease Starting incline"]');
  await page.click('#start');await page.waitForFunction(()=>!!window.testAPI.session);
  assert.equal(await page.locator('#loadCard').isVisible(),true);
  assert.deepEqual([await text('#resistanceValue'),await text('#inclineValue')],['6','2'],'the run screen starts at the recorded values');
  assert.deepEqual(await page.evaluate(()=>window.testAPI.session.loadLog.map(e=>[e.ms,e.resistance,e.incline])),[[0,6,2]],'the start is logged');

  // Buttons are touch sized and each tap is a logged change.
  for(const id of ['#resistanceDown','#resistanceUp','#inclineDown','#inclineUp']){const box=await page.locator(id).boundingBox();assert.ok(box.width>=44&&box.height>=44,id+' is at least 44px');}
  await page.evaluate(()=>{window.testAPI.session.lastAt-=65000;}); // a minute of riding before the first change
  await page.click('#resistanceUp');await page.click('#resistanceUp');await page.click('#inclineUp');
  assert.deepEqual([await text('#resistanceValue'),await text('#inclineValue')],['8','2.5']);
  const log=await page.evaluate(()=>window.testAPI.session.loadLog.map(e=>[e.resistance,e.incline,e.ms>=60000]));
  assert.deepEqual(log,[[6,2,false],[7,2,true],[8,2,true],[8,2.5,true]],'start plus one entry per tap, in order, stamped with riding time');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no side scroll');
  // Pausing stops the buttons.
  await page.click('#pause');await page.locator('#resume').waitFor();
  assert.equal(await page.locator('#resistanceUp').isDisabled(),true,'buttons are off while paused');
  await page.click('#resume');

  // Saved ride: log in the record, in the summary, in the CSV and valid as a backup.
  await page.evaluate(()=>{const t=window.testAPI;t.handle(WorkoutCore.end(t.session,Date.now()));});await page.locator('#summary').waitFor();
  assert.equal(await page.locator('#loadSummary').isVisible(),true);
  const lines=await page.locator('#loadList li').allTextContents();
  assert.equal(lines.length,4);assert.match(lines[0],/^0:00 · Resistance 6 · Incline 2% · .* \(start\)$/);assert.match(lines[3],/Resistance 8 · Incline 2\.5%/);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history[0]);
  assert.equal(saved.config.startResistance,6);assert.equal(saved.load.changes.length,4);assert.equal(saved.load.changes[0].ms,0);assert.equal(saved.load.changes.at(-1).untilMs,saved.activeMs);
  const backup=await page.evaluate(()=>JSON.parse(JSON.stringify(window.testAPI.storage.backup())));
  assert.equal(await page.evaluate(b=>{try{window.testAPI.storage.prepare(b);return 'ok';}catch(e){return e.message;}},backup),'ok','the backup with a load log is accepted');
  const bad=JSON.parse(JSON.stringify(backup));bad.history[0].load.changes[1].ms=-5;
  assert.match(await page.evaluate(b=>{try{window.testAPI.storage.prepare(b);return 'ok';}catch(e){return e.message;}},bad),/Change time/,'a bad log is rejected');
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportSummary')]);
  const csv=fs.readFileSync(await download.path(),'utf8'),[header,row]=csv.split('\r\n');
  assert.match(header,/"start_resistance","start_incline","load_changes","resistance_incline_log"/);assert.match(row,/"6","2","4","0:00 R6 I2 HR/);

  // Setup remembers the values.
  await page.click('#again');
  assert.deepEqual([await page.inputValue('#startResistance'),await page.inputValue('#startIncline')],['6','2'],'setup keeps the last values');
  assert.deepEqual(errors,[]);
  console.log('bike-load: ok');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
