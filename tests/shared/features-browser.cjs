const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {appWithTestAPI}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  for(const app of ['liftlog','bike-cardio']){
   const contexts=[],pages=[],errors=[];
   const html=app==='liftlog'?appWithTestAPI('{workoutHandoff,backupPayload,prepareBackup,newWorkout,render,flushSave,save, get state(){return state},set state(v){state=v},timer}'):
    fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,showHistory,showSummary,get state(){return storage.state},get records(){return records},set records(v){records=v}};');
   for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://features.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://features.test/'+app);
   }
   const [source,target]=pages;
   // OS preference and selected theme use one surface-colour hint in both apps.
   for(const colour of ['light','dark']){
    await source.emulateMedia({colorScheme:colour});await navigate(source,'settings');
    for(const theme of ['light','dark','nord','system']){
     if(app==='liftlog')await source.locator('label:has(input[name=theme][value='+theme+'])').click();else await source.selectOption('#themeChoice',theme);
     assert.equal(await source.evaluate(()=>{const nodes=document.querySelectorAll('meta[name="theme-color"]');return nodes.length===1&&nodes[0].content===getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()&&!document.documentElement.hasAttribute('data-statusbar');}),true,app+' bar policy '+colour+'/'+theme);
    }
   }
   await navigate(source,app==='liftlog'?'today':'setup');
   if(app==='liftlog'){await source.locator('[data-action="routine-start"]').first().click();await navigate(source,'settings');}
   else{await navigate(source,'settings');await source.uncheck('#voice');await source.uncheck('#beeps');await navigate(source,'setup');await source.click('#start');await navigate(source,'settings');}
   if(app==='liftlog'){
    const click=source.click('#handoffOffer');await source.getByRole('button',{name:'Prepare handoff',exact:true}).click();await click;
   }else{source.once('dialog',dialog=>dialog.accept());await source.click('#handoffOffer');}
   await source.waitForFunction(()=>document.getElementById('handoffCode')!==null);
   const payload=await source.evaluate(key=>key==='liftlog'?window.testAPI.workoutHandoff.held().payload:window.testAPI.storage.handoff.held().payload,app);
   assert.equal(app==='liftlog'?payload.backup.activeWorkout.timer.running:payload.backup.active.status,app==='liftlog'?false:'paused');
   await source.reload();await navigate(source,'settings');assert(await source.locator('#handoffCode').isVisible(),'hold survives reload');
   await source.screenshot({path:'/tmp/wellbeing-'+app+'-handoff.png',animations:'disabled'});
   await navigate(target,'settings');
   if(app==='liftlog'){
    await target.setInputFiles('#handoffImport',{name:'handoff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});await target.getByRole('button',{name:'Receive workout',exact:true}).click();
   }else{target.once('dialog',dialog=>dialog.accept());await target.setInputFiles('#handoffImport',{name:'handoff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});}
   await target.waitForFunction(app=>{const s=window.testAPI.state;return !!(app==='liftlog'?s.activeWorkout:s.active);},app);
   assert.equal(await target.locator('#handoffImport').isDisabled(),true,'another active workout blocks receipt');
   if(app==='liftlog'){
    assert.equal(await target.evaluate(()=>window.testAPI.timer.running),false);
    await target.evaluate(()=>{const api=window.testAPI,active=api.state.activeWorkout;const a=structuredClone(active),b=structuredClone(active);a.id='earlier';a.startedAt-=86400000;a.finishedAt=a.startedAt+60000;b.id='later';b.finishedAt=b.startedAt+120000;a.exercises.forEach(ex=>ex.sets.forEach(s=>{s.reps=5;s.completed=true;}));b.exercises.forEach(ex=>ex.sets.forEach(s=>{s.reps=6;s.completed=true;}));api.state.activeWorkout=null;api.state.workouts=[b,a];api.state=api.prepareBackup(api.state);api.save({immediate:true});api.render();});
   }else{
    assert.equal(await target.evaluate(()=>window.testAPI.state.active.status),'paused');
    await target.evaluate(()=>{const api=window.testAPI,s=WorkoutCore.create({},Date.now()-1000,'earlier');WorkoutCore.end(s,Date.now());const a=WorkoutCore.record(s),b=structuredClone(a);a.startedAt-=86400000;a.endedAt-=86400000;a.metrics={averageWatts:'100'};b.id='later';b.metrics={averageWatts:'115'};api.storage.write('bike-cardio.active.v1',null);api.storage.write('bike-cardio.history.v1',[b,a]);api.records=api.state.history;});
   }
   await navigate(target,'history');assert(await target.locator('#compareFirst').isVisible());assert.match(await target.locator('.comparison-table').textContent(),/Difference/);
   assert.match(await target.locator('.comparison-table').textContent(),app==='liftlog'?/\+/:/\+15/);
   for(const width of [320,390,1024]){await target.setViewportSize({width,height:844});assert.equal(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,app+' comparison fits '+width);}
   await target.setViewportSize({width:390,height:844});await target.locator('#workout-comparison').scrollIntoViewIfNeeded();await target.locator('#workout-comparison').screenshot({path:'/tmp/wellbeing-'+app+'-comparison.png',animations:'disabled'});
   assert.deepEqual(errors,[]);for(const context of contexts)await context.close();console.log('PASS '+app+': two-device file handoff, paused receipt, comparisons and mobile bar/theme matrix');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
