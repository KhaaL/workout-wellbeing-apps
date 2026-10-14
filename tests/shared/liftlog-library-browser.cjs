const assert=require('node:assert/strict');
const {appWithTestAPI,launchBrowser}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const html=appWithTestAPI('{get state(){return state},get ui(){return ui},prepareBackup,navigate,render,save,flushSave}');
const fixture={version:14,settings:{lastModifiedAt:1},exercises:[
 {id:'press',name:'Visible Press',unit:'kg',category:'Push',movementFamily:'horizontal_push'},
 {id:'row',name:'Archive Row',unit:'kg',category:'Pull',movementFamily:'horizontal_pull'}
],exerciseLinks:[{sourceId:'old-row',targetId:'row'}],routines:[{id:'plan',name:'Planned strength',plan:true,plannedFor:'2030-01-01',items:[
 {id:'p',exerciseId:'press',sets:3,repsMin:8,repsMax:10,weight:20},
 {id:'r',exerciseId:'row',sets:2,repsMin:10,repsMax:12,weight:30}
]}],workouts:[{id:'session',routineName:'Past session',startedAt:1000,finishedAt:2000,exercises:[
 {exerciseId:'old-row',name:'Archive Row',unit:'kg',sets:[{id:'r1',reps:10,weight:30,completed:true}]},
 {exerciseId:'press',name:'Visible Press',unit:'kg',sets:[{id:'p1',reps:8,weight:20,completed:true}]}
]}],activeWorkout:null};
(async()=>{
 const browser=await launchBrowser();
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://app.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://app.test/');
  await page.evaluate(data=>{const prepared=testAPI.prepareBackup(data);localStorage.setItem('liftlog.v1',JSON.stringify(prepared));},fixture);await page.reload();
  const planned=page.locator('[data-action="select-routine"][data-id="plan"]');await planned.click();
  const sheet=page.locator('#detail-dlg');assert.equal(await sheet.isVisible(),true);assert.match(await page.locator('#detail-body').textContent(),/Visible Press.*3 × 8–10 reps.*Archive Row.*2 × 10–12 reps/);
  assert.equal(await page.evaluate(()=>testAPI.state.activeWorkout),null,'preview does not start a workout');
  await page.screenshot({path:'/tmp/liftlog-planned-preview.png',animations:'disabled'});
  await page.locator('#detail-close').click();assert.equal(await planned.evaluate(node=>node===document.activeElement),true,'close returns to planned workout');
  await navigate(page,'exercises');await page.locator('#archive-ex-row').click();
  await page.waitForFunction(()=>testAPI.state.exercises.find(e=>e.id==='row').archived);
  assert.equal(await page.locator('#open-exercise-row').count(),0);assert.equal(await page.locator('#ex-archived-toggle').evaluate(node=>node===document.activeElement),true);
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/liftlog-exercise-archive.png',animations:'disabled'});await page.setViewportSize({width:390,height:844});
  await navigate(page,'history');assert.equal(await page.locator('#progress-exercise-select option').filter({hasText:'Archive Row'}).count(),0);
  await page.fill('#history-search','Archive Row');assert.equal(await page.locator('.hist-row').count(),0);
  await page.fill('#history-search','');await page.locator('.hist-row').click();assert.doesNotMatch(await page.locator('#detail-body').textContent(),/Archive Row/);assert.match(await page.locator('#detail-body').textContent(),/Visible Press/);
  await page.locator('#detail-close').click();
  await navigate(page,'routines');await page.locator('#open-routine-plan').click();await page.locator('#detail-edit').click();
  assert.equal(await page.locator('#routine-add-select option[value="row"]').count(),0,'archived exercises cannot be added');
  await navigate(page,'exercises');await page.click('#ex-archived-toggle');await page.click('#archive-ex-row');
  await page.waitForFunction(()=>!testAPI.state.exercises.find(e=>e.id==='row').archived);await page.evaluate(()=>testAPI.flushSave());
  await page.reload();await navigate(page,'history');assert.equal(await page.locator('#progress-exercise-select option[value="row"]').count(),1);
  await page.locator('.hist-row').click();assert.match(await page.locator('#detail-body').textContent(),/Archive Row/);
  assert.equal(await page.evaluate(()=>testAPI.state.workouts[0].exercises.length),2,'archiving retains saved workout blocks');await page.locator('#detail-close').click();
  await navigate(page,'today');await planned.click();await page.locator('#detail-start').click();await page.waitForFunction(()=>!!testAPI.state.activeWorkout);
  assert.equal(await page.evaluate(()=>testAPI.state.activeWorkout.exercises.length),2);
  assert.equal(await sheet.isVisible(),false,'starting closes the preview and exposes workout controls');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'workout-title');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('PASS Liftlog: plan preview, focus return, archive/unarchive, history visibility, routine picker, persisted recovery and unchanged saved blocks');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
