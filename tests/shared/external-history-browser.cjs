const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {navigate}=require('./ui-navigation.cjs');
const {confirmAction}=require('./confirm-dialog.cjs');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://app.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://app.test/');await navigate(page,'history');
  await confirmAction(page,()=>page.setInputFiles('#importHistory',path.join(root,'examples/bike-history-sprint-v2.json')));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===1);
  await confirmAction(page,()=>page.setInputFiles('#importHistory',path.join(root,'examples/bike-history-external-v3.json')));
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===3);
  await page.selectOption('#historyMode','external');assert.equal(await page.locator('.history-item').count(),1);
  assert.match(await page.locator('.history-item').textContent(),/Externally recorded.*Unknown bike.*Unknown context/);
  await page.locator('.history-item').click();assert.match(await page.locator('#summaryContext').textContent(),/Externally recorded/);assert.equal(await page.locator('#summaryWork').textContent(),'Not recorded');assert.doesNotMatch(await page.locator('#comparisonNote').textContent(),/This ride used/);
  assert.match(await page.locator('#externalReadings').textContent(),/Peak power250 W.*Distance7 km|Distance7 km/);
  await page.fill('#notes','Edited after import');await page.locator('#notes').press('Tab');
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')));
  let ride=(await saved()).history.find(r=>r.config.mode==='external');assert.equal(ride.metrics.peakWatts,250);
  await page.click('#editSession');await page.fill('#editBikeId','external-machine');await page.locator('#editForm button[type=submit]').click();
  ride=(await saved()).history.find(r=>r.id==='example-follow-along-video');assert.equal(ride.config.mode,'external');assert.equal(ride.config.bike,'unknown');assert.equal(ride.config.context,'unknown');assert.equal(ride.metrics.externalSource,'Follow-along video + external recorder (example)');
  const waitDownload=page.waitForEvent('download');await page.click('#exportSummary');const download=await waitDownload,csv=fs.readFileSync(await download.path(),'utf8');
  assert.match(csv,/peakWatts/);assert.match(csv,/polar_z5_ms/);assert.match(csv,/Follow-along video/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/bike-cardio-external-history.png',animations:'disabled'});
  await page.reload();await navigate(page,'history');assert.equal((await saved()).history.length,3);
  assert.deepEqual(errors,[]);console.log('PASS external history: v2/v3 merge, preserved sessions, category filter, external readings, edits, CSV, reload and mobile layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
