// Bike notes as Markdown at phone width: plan notes in the plan preview and on setup, ride notes with a Preview switch.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {navigate}=require('./ui-navigation.cjs');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8');
const csp=require('./site-headers.cjs').csp('bike-cardio');
const plan={...JSON.parse(fs.readFileSync(path.join(root,'examples','bike-plan-sprint.json'),'utf8')),
  notes:'**Baseline** ride.\nSame bike as last time.\n\n- fan on\n- [protocol](https://example.com/sprints)\n\n<img src=x onerror=alert(1)> [bad](javascript:alert(1))'};
const ride=(id,startedAt,notes)=>({id,startedAt,endedAt:startedAt+1980000,config:{mode:'zone2',bike:'touchscreen'},activeMs:1980000,mainMs:1500000,outcome:'complete',effortsCompleted:0,metrics:{averageHR:'128',notes}});
const rides=[ride('newer',1720100000000,'first ride'),ride('older',1720000000000,'')];
// Plan notes: bold, a line break, a list and a safe link render; raw HTML and javascript: links stay text.
async function checkPlanNotes(box,where){
  const md=box.locator('.md');
  assert.match(await md.innerHTML(),/<p><strong>Baseline<\/strong> ride\.<br>Same bike as last time\.<\/p><ul><li>fan on<\/li><li><a /,where+' renders bold, line breaks and lists');
  const link=md.locator('a');assert.equal(await link.count(),1,where+' has one link');
  assert.deepEqual(await link.evaluate(a=>[a.getAttribute('href'),a.target,a.rel]),['https://example.com/sprints','_blank','noopener noreferrer']);
  assert.equal(await md.locator('img').count(),0);assert.match(await md.textContent(),/<img src=x onerror=alert\(1\)> \[bad\]\(javascript:alert\(1\)\)/,where+' shows unsafe input as typed');
}
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await context.route('https://bike.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.addInitScript(rides=>{if(!localStorage.getItem('bike-cardio.state.v1')&&!localStorage.getItem('bike-cardio.history.v1'))localStorage.setItem('bike-cardio.history.v1',JSON.stringify(rides));},rides);
    await page.goto('https://bike.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history);
    const noSideScroll=async where=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),where+' fits the screen width');

    await page.click('#addPlan');const add=page.getByRole('dialog',{name:'Add planned sessions'});
    await page.fill('#planInput',JSON.stringify(plan));await add.getByRole('button',{name:'Check plan'}).click();
    await checkPlanNotes(add.locator('.plan-preview'),'The plan preview');
    await add.getByRole('button',{name:'Save',exact:true}).click();await add.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Use '+plan.name}).click();
    assert.equal(await page.isVisible('#planNotes'),true);await checkPlanNotes(page.locator('#planNotes'),'The setup card');await noSideScroll('Setup');
    console.log('PASS plan notes render as Markdown in the plan preview and on setup, with safe links only');

    await navigate(page,'history');await page.locator('.history-item').first().click();
    const box=page.locator('#notes'),preview=page.locator('#notes-preview'),toggle=page.locator('#notesPreview');
    assert.equal(await box.inputValue(),'first ride');
    const typed='Felt **easy**.\nFan on.\n\n1. drift low\n2. see [guide](https://example.com/zone2)';
    await box.fill(typed);await toggle.click();
    assert.equal(await box.isVisible(),false);assert.equal(await preview.isVisible(),true);assert.equal(await toggle.getAttribute('aria-pressed'),'true');
    assert.match(await preview.innerHTML(),/<p>Felt <strong>easy<\/strong>\.<br>Fan on\.<\/p><ol><li>drift low<\/li><li>see <a href="https:\/\/example\.com\/zone2" target="_blank" rel="noopener noreferrer">guide<\/a><\/li><\/ol>/);
    assert.equal((await saved()).find(r=>r.id==='newer').metrics.notes,typed,'typing saves the ride notes');await noSideScroll('Ride notes preview');
    await toggle.click();assert.equal(await box.isVisible(),true);assert.equal(await preview.isVisible(),false);
    assert.equal(await box.inputValue(),typed,'Edit keeps the typed text');assert.equal(await page.evaluate(()=>document.activeElement.id),'notes');
    console.log('PASS ride notes switch between editing and a formatted preview, and save as typed');

    await toggle.click();await page.click('#summaryHistory');await page.locator('.history-item').nth(1).click();
    assert.equal(await box.isVisible(),true,'another ride opens in edit mode');assert.equal(await toggle.textContent(),'Preview');assert.equal(await box.inputValue(),'');
    await toggle.click();assert.equal(await preview.textContent(),'Nothing to preview yet.');
    console.log('PASS opening another ride returns to editing; empty notes preview says so');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
