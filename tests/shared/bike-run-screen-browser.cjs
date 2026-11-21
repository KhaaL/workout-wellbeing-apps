// The Bike Cardio run screen at phone width: live HR beside the phase timer, three target-state emojis, no check card or status captions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..','..');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,handle,render,get session(){return session},get h10(){return h10}};');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://run.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://run.test/');
  await page.click('#start');await page.waitForFunction(()=>!!window.testAPI.session);
  await page.evaluate(()=>{const t=window.testAPI;for(let n=0;n<20&&WorkoutCore.phase(t.session).kind!=='main';n++)t.handle(WorkoutCore.skip(t.session,Date.now()));});
  const reading=bpm=>page.evaluate(bpm=>{const t=window.testAPI;t.h10.reading={bpm,valid:true,contact:true,rr:[],at:Date.now()};t.render();},bpm);
  const box=sel=>page.locator(sel).boundingBox();
  const shown=async sel=>{const b=await page.locator(sel).boundingBox();return !!b&&b.width>1&&b.height>1;};
  await reading(111);

  // Removed from view: the label above the heading, the stay-awake line, the caption, the advice line, the check card.
  for(const sel of ['#screenStatus','#timerNote','#liveAdvice'])assert.equal(await shown(sel),false,sel+' is not shown');
  assert.equal(await page.locator('#workoutLabel').count(),0,'the small label above the heading is gone');
  assert.equal(await page.locator('#coaching').count(),0,'the check card is gone');
  assert.match(await page.textContent('#screenStatus'),/Screen stay-awake|Stay-awake/,'screen readers still get the stay-awake status');

  // Live HR sits beside the timer, on the same row, to its right.
  const [timer,live,progress,bar]=await Promise.all([box('#timer'),box('#liveHR'),box('.progress'),box('#hrBar')]);
  assert.ok(live.x>timer.x+timer.width-1,'live HR is right of the timer');
  assert.ok(live.y<timer.y+timer.height&&live.y+live.height>timer.y,'live HR shares the timer row');
  assert.ok(progress.y>timer.y+timer.height-1,'the progress bar is below the timer');
  assert.ok(bar.y>progress.y,'the HR gauge is below the progress bar');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no side scroll');

  // The target tile is three emojis; the one matching the reading is lit.
  assert.deepEqual(await page.locator('#hrState span').allTextContents(),['⬇️','✅','⬆️']);
  const lit=()=>page.evaluate(()=>[...document.querySelectorAll('#hrState span')].filter(e=>getComputedStyle(e).opacity==='1').map(e=>e.dataset.s));
  const t=await page.evaluate(()=>window.testAPI.session.config.targets);
  await reading(Math.round((t.zoneMin+t.zoneMax)/2));await page.waitForTimeout(300);
  assert.deepEqual(await lit(),['hold']);assert.equal(await page.getAttribute('#hrState','aria-label'),'In target');
  await reading(t.zoneMax+10);await page.waitForTimeout(300);
  assert.deepEqual(await lit(),['high']);assert.equal(await page.getAttribute('#hrState','aria-label'),'Above target');
  await reading(t.zoneMin-10);await page.waitForTimeout(300);
  assert.deepEqual(await lit(),['low']);assert.equal(await page.getAttribute('#hrState','aria-label'),'Below target');
  assert.match(await page.textContent('#targetHR'),/\d/,'the numeric target stays in the page for screen readers');

  assert.deepEqual(errors,[]);
  console.log('bike-run-screen: ok');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
