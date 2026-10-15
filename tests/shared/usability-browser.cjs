const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {appWithTestAPI}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const {confirmAction}=require('./confirm-dialog.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  for(const app of ['bike-cardio','liftlog']){
   const html=app==='liftlog'?appWithTestAPI('{newWorkout,navigate,save,render,deleteSet,finishWorkout,recentChanges,readUndoTarget,get state(){return state},get ui(){return ui}}'):
    fs.readFileSync('dist/bike-cardio/index.html','utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,journal,showHistory,showSummary,h10,renderSensors,get state(){return storage.state},set records(v){records=v}};');
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));await page.route('https://usability.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://usability.test/'+app);
   if(app==='bike-cardio'){
    assert.equal(await page.locator('#sensors h2').textContent(),'Sensors');assert.equal(await page.locator('#sensorSetup h3').textContent(),'Heart-rate strap');assert.match(await page.locator('#powerSetup h3').textContent(),/Bike power & cadence/);
    // Without Bluetooth one notice explains both sensors and neither shows a dead Connect button.
    assert.match(await page.locator('#sensorNotice').textContent(),/Bluetooth/);assert.equal(await page.locator('#connectH10').isVisible(),false);assert.equal(await page.locator('#connectPower').isVisible(),false);
    await page.locator('#setup').getByText('By feel',{exact:true}).click();assert.equal(await page.locator('input[name=bike]:checked').inputValue(),'feel');await page.locator('#setup').getByText('Levels',{exact:true}).click();
    await page.locator('#saved-setups summary').click();
    await page.locator('#rideAdjustments > summary').click();await page.fill('#mainMinutes','40');await page.locator('#mainMinutes').press('Tab');await page.fill('#bikeId','bike-a');await page.fill('#saved-setup-name','Steady 40');
    const setups=page.locator('#saved-setups details');await setups.getByRole('button',{name:'Save as preset',exact:true}).click();
    const saved=await page.evaluate(()=>window.testAPI.state.presets[0]);assert.equal(saved.config.mainMinutes,40);assert.equal(saved.config.bikeId,'bike-a');
    await page.reload();await page.locator('#saved-setups summary').click();await page.selectOption('#saved-setup-select','presets:'+saved.id);await setups.getByRole('button',{name:'Use',exact:true}).click();assert.equal(await page.inputValue('#mainMinutes'),'40');
    await page.fill('#saved-setup-name','Bike A');await setups.getByRole('button',{name:'Save as machine',exact:true}).click();assert.equal(await page.locator('#saved-setups summary').textContent(),'Saved setups · 2');
    await page.fill('#bikeId','other');await setups.getByRole('button',{name:'Use',exact:true}).click();assert.equal(await page.inputValue('#bikeId'),'bike-a');
    await page.selectOption('#saved-setup-select','presets:'+saved.id);
    await confirmAction(page,()=>setups.getByRole('button',{name:'Delete selected',exact:true}).click(),false);assert.equal(await page.evaluate(()=>window.testAPI.state.presets.length),1);
    await page.click('#start');assert.equal(await page.locator('#hrBar').isVisible(),false,'no bar without a live reading');
    // A live reading above the zone places the marker right of the band and marks it high.
    await page.evaluate(()=>{const api=window.testAPI;api.h10.reading={bpm:130,valid:true,at:Date.now()};api.renderSensors();});
    assert.equal(await page.locator('#hrBar').isVisible(),true);assert.equal(await page.locator('#hrBar').getAttribute('data-alert'),'high');
    assert.equal(await page.evaluate(()=>Math.round(parseFloat(document.querySelector('#hrBar .hr-marker').style.left))),85);assert.equal(await page.locator('#hrBar .hr-min').textContent(),'105');
    await page.evaluate(()=>{const api=window.testAPI;api.h10.reading=null;api.renderSensors();});
    await navigate(page,'setup');
    const activeBefore=await page.evaluate(()=>JSON.stringify(window.testAPI.state.active.config));
    await navigate(page,'settings');await navigate(page,'history');
    await page.evaluate(()=>{const api=window.testAPI,s=WorkoutCore.create({},Date.now()-10000,'current');WorkoutCore.end(s,Date.now());const a=WorkoutCore.record(s);a.metrics={averageWatts:'120'};a.power={source:'Bluetooth bike sensor',measuredMs:600000,coverage:95,averageWatts:140,peak5sWatts:180,main:{averageWatts:147.5,cadence:90,coverage:100,decouplingPct:3.2,fixedHRWatts:150}};a.hr={...a.hr,main:{averageHR:118,coverage:96,driftPct:2.5},recovery60:[25,null]};const b=structuredClone(a);b.id='previous';b.startedAt-=86400000;b.metrics.averageWatts='100';const c=structuredClone(b);c.id='different';c.startedAt=a.startedAt-1000;c.config.bikeId='different';api.storage.write('bike-cardio.history.v1',[a,c,b],{atomic:true});api.records=api.state.history;api.showSummary(a);});
    assert.equal(await page.evaluate(()=>JSON.stringify(window.testAPI.state.active.config)),activeBefore);
    assert.match(await page.locator('#finished-comparison').textContent(),/\+20 W/);
    // Measured power and the HR trace's readings appear in the ride summary.
    assert.match(await page.locator('#powerTiles').innerText(),/Main-block power\s+147\.5 W\s+90 rpm · 100% measured\s+Watts at 115 bpm\s+150 W\s+within 2 bpm\s+Aerobic decoupling\s+3\.2%/);
    assert.match(await page.locator('#sensorAnalysis').innerText(),/Main-block HR\s*118 bpm\s*96% measured\s*HR drift\s*\+2\.5%[\s\S]*60-second HR recovery\s*25 · — bpm/);assert.equal(await page.locator('#finished-comparison details').getAttribute('open'),null);
    await page.fill('#averageWatts','135');await page.locator('#undo-bar').getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await page.inputValue('#averageWatts'),'120');
    await page.fill('#averageWatts','140');await page.locator('#undo-bar').getByRole('button',{name:'Dismiss'}).click();
    await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='bike-cardio.v1.recent-changes')throw Error('quota');return window.originalSetItem.call(this,key,value);};});
    await confirmAction(page,()=>page.click('#deleteSession'));assert.equal(await page.evaluate(()=>window.testAPI.state.history.length),3,'failed recovery write cancels deletion');
    await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
    await confirmAction(page,()=>page.click('#deleteSession'));assert.equal(await page.evaluate(()=>window.testAPI.state.history.length),2);
    await page.reload();await navigate(page,'history');await page.locator('#recent-changes summary').click();await page.getByRole('button',{name:'Restore Deleted session',exact:true}).click();assert.equal(await page.evaluate(()=>window.testAPI.state.history.length),3);
    assert.equal(await page.evaluate(()=>window.testAPI.storage.backup().presets.length),1);
   }else{
    await page.locator('[data-action="routine-start"]').first().click();
    const original=await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets[0]);
    await page.locator('[data-action="edit-set"]').first().click();const editor=page.getByRole('dialog',{name:'Edit set 1'});const weight=editor.locator('input').first();await weight.fill('42');await editor.getByRole('button',{name:'Save changes'}).click();
    // An edit goes to Recent changes without a prompt; a deletion offers Undo in the toast.
    assert.equal(await page.locator('#undo-bar').count(),0,'an edit opens no undo prompt');assert.equal(await page.locator('#toast-region .toast-action').count(),0);
    const deleteFirst=async()=>{await page.locator('[data-action="edit-set"]').first().click();await page.getByRole('dialog',{name:'Edit set 1'}).getByRole('button',{name:'Delete set 1…',exact:true}).click();};
    const setCount=await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets.length);await deleteFirst();
    assert.equal(await page.locator('#toast-region .toast').textContent(),'Deleted setUndo');await page.locator('#toast-region').getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets.length),setCount);assert.equal(await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets[0].id),original.id);
    await deleteFirst();
    assert.equal(await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets.some(s=>s.id===window.testAPI.recentChanges.list()[0].target.id)),false);
    // Changes to another set do not prevent restoring the deleted set.
    await page.evaluate(()=>{const api=window.testAPI;api.state.activeWorkout.exercises[0].sets[0].weight=99;api.save({immediate:true});});
    await page.reload();await navigate(page,'history');await page.locator('#recent-changes summary').click();await page.getByRole('button',{name:'Restore Deleted set',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets[1].weight),99);
    await page.evaluate(()=>{const api=window.testAPI,ex=api.state.activeWorkout.exercises[0];ex.sets=ex.sets.slice(0,1);api.save({immediate:true});api.deleteSet(ex.sets[0].id);if(api.state.activeWorkout.exercises[0].sets.length!==0)throw Error('Last set was not deleted');api.recentChanges.undo(api.recentChanges.list()[0].id);});
    assert.equal(await page.evaluate(()=>window.testAPI.state.activeWorkout.exercises[0].sets.length),1,'last-set recovery retains the parent exercise');

    await page.evaluate(()=>{const api=window.testAPI,w=api.state.activeWorkout;w.exercises.forEach(ex=>ex.sets.forEach(s=>{s.completed=true;s.reps=5;s.weight=20;}));const a=structuredClone(w);a.id='previous';a.startedAt-=86400000;a.finishedAt=a.startedAt+60000;const b=structuredClone(a);b.id='different';b.startedAt=w.startedAt-1000;b.routineId='different';api.state.workouts=[b,a];api.save({immediate:true});api.finishWorkout();});
    assert.equal(await page.locator('#finished-comparison').isVisible(),true);assert.equal(await page.locator('#finished-comparison details').getAttribute('open'),null);// Each exercise is compared with its latest earlier session, here the one from a different routine.
    const finished=await page.locator('#finished-comparison').textContent();assert.match(finished,/Compared with each exercise’s last session/);assert.match(finished,/max logged load/);assert.equal(await page.locator('#finished-comparison .comparison-measure').first().textContent(),'max logged load');assert(await page.locator('#finished-comparison .comparison-name').count()>0);assert(await page.locator('#toast-region .toast').count()<=1,'one toast at a time');assert.doesNotMatch(finished,/Completed working sets/);
    await page.locator('#finished-comparison summary').click();assert.equal(await page.locator('#finished-comparison td',{hasText:/^20 · /}).count()>0,true,'each earlier figure names its session');
    // History pairs any workouts that share an exercise, most shared first, then the most recent.
    const partners=await page.locator('#compareSecond option').allTextContents();assert.equal(partners.length,2,'a different routine sharing exercises is offered');
    assert.match(partners[0],/\d+ shared exercises/);assert.equal(await page.locator('#compareSecond').inputValue(),'different');
    await confirmAction(page,()=>page.getByRole('button',{name:'Delete session',exact:true}).click());assert.equal(await page.evaluate(()=>window.testAPI.state.workouts.length),2);
    await page.reload();await navigate(page,'history');await page.locator('#recent-changes summary').click();await page.getByRole('button',{name:'Restore Deleted session',exact:true}).click();assert.equal(await page.evaluate(()=>window.testAPI.state.workouts.length),3);
   }
   for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,app+' no horizontal overflow at '+width);}
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/wellbeing-'+app+'-recovery.png',fullPage:true});assert.deepEqual(errors,[]);await context.close();console.log('PASS '+app+': recovery survives reload, edits undo safely, summaries compare matching sessions'+(app==='bike-cardio'?', presets and machine profiles persist':''));
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
