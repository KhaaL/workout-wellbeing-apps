const assert=require('node:assert/strict');
const {appWithTestAPI,launchBrowser}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const html=appWithTestAPI('{get state(){return state},get ui(){return ui},prepareBackup,navigate,render,save,flushSave}');
const fixture={version:14,settings:{lastModifiedAt:1},exercises:[
 {id:'press',name:'Visible Press',unit:'kg',category:'Push',movementFamily:'horizontal_push'},
 {id:'row',name:'Archive Row',unit:'kg',category:'Pull',movementFamily:'horizontal_pull'},
 {id:'incline',name:'Incline Press',unit:'kg',category:'Push',movementFamily:'horizontal_push',restSeconds:150}
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
  const planned=page.locator('#open-routine-plan');await planned.click();
  const sheet=page.locator('#detail-dlg');assert.equal(await sheet.isVisible(),true);assert.match(await page.locator('#detail-body').textContent(),/Visible Press.*3 × 8–10 reps.*Archive Row.*2 × 10–12 reps/);
  assert.equal(await page.evaluate(()=>testAPI.state.activeWorkout),null,'preview does not start a workout');
  await page.screenshot({path:'/tmp/liftlog-planned-preview.png',animations:'disabled'});
  await page.locator('#detail-close').click();assert.equal(await planned.evaluate(node=>node===document.activeElement),true,'close returns to planned workout');
  await navigate(page,'exercises');await page.locator('#archive-ex-row').click();
  await page.waitForFunction(()=>testAPI.state.exercises.find(e=>e.id==='row').archived);
  assert.equal(await page.locator('#open-exercise-row').count(),0);assert.equal(await page.locator('#ex-archived-toggle').evaluate(node=>node===document.activeElement),true);
  await page.setViewportSize({width:320,height:740});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/liftlog-exercise-archive.png',animations:'disabled'});await page.setViewportSize({width:390,height:844});
  await navigate(page,'history');assert.equal(await page.locator('#progress-exercise-select option').filter({hasText:'Archive Row'}).count(),0);
  // History opens on Sessions; Progress and Compare are one tap away.
  assert.equal(await page.locator('[data-history-panel="sessions"]').isVisible(),true);assert.equal(await page.locator('[data-history-panel="progress"]').isVisible(),false);
  await page.locator('[data-action="history-tab"][data-tab="progress"]').click();assert.equal(await page.locator('#progress-exercise-select').isVisible(),true);
  await page.locator('[data-action="history-tab"][data-tab="sessions"]').click();
  await page.fill('#history-search','Archive Row');assert.equal(await page.locator('.hist-row').count(),0);
  await page.fill('#history-search','');await page.locator('.hist-row').click();assert.doesNotMatch(await page.locator('#detail-body').textContent(),/Archive Row/);assert.match(await page.locator('#detail-body').textContent(),/Visible Press/);
  await page.locator('#detail-close').click();
  await navigate(page,'today');await page.locator('#open-routine-plan').click();await page.locator('#detail-edit').click();
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
  // The quiet button above the sets adds the Settings warm-ups (50% then 75%) before the first working set; a swap drops them with the old movement's load.
  const warmButton=page.locator('#main [data-action="add-warmups"]');assert.equal((await warmButton.textContent()).trim(),'2 warm-up sets · first horizontal push');
  await warmButton.click();await page.locator('.set-row.is-warmup').nth(1).waitFor();assert.equal(await page.locator('.set-row.is-warmup').count(),2);
  assert.equal(await page.evaluate(()=>testAPI.state.activeWorkout.exercises[0].sets.map(s=>s.weight+'x'+s.reps).join()),'10x8,15x8,20xnull,20xnull,20xnull');
  assert.equal(await warmButton.count(),0,'one set of warm-ups per exercise');
  await page.locator('[data-action="exercise-menu"]').click();const menu=page.getByRole('dialog',{name:'More for Visible Press'});assert.equal(await menu.getByRole('button',{name:/warm-up/}).count(),0,'the More… menu no longer adds warm-ups');
  // Swap keeps the prescription for this session; the swapped-in exercise brings its own rest.
  await menu.getByRole('button',{name:'Swap for another exercise…',exact:true}).click();const swap=page.getByRole('dialog',{name:'Swap Visible Press'});
  assert.match(await swap.textContent(),/keeps 3 sets of 8 to 10 reps/);assert.equal(await swap.locator('optgroup[label="Same movement family"] option').count(),1);
  await swap.getByRole('button',{name:'Swap',exact:true}).click();
  const swapped=await page.evaluate(()=>testAPI.state.activeWorkout.exercises[0]);assert.equal(swapped.exerciseId,'incline');assert.equal(swapped.sets.length,3);assert.equal(await page.locator('.set-row.is-warmup').count(),0);assert.equal(swapped.targetRepsMax,10);assert.equal(swapped.targetWeight,null);
  assert.equal(await page.evaluate(()=>testAPI.state.routines.find(r=>r.id==='plan').items[0].exerciseId),'press','the routine is unchanged');
  assert.match(await page.locator('#ex-panel-top .ex-tags').textContent(),/rest 2:30 \(this exercise\)/);
  // A rest override is set and cleared in the exercise editor.
  await navigate(page,'exercises');await page.locator('#open-exercise-press').click();await page.locator('#detail-edit').click();
  await page.fill('#ex-edit-form [data-field="restSeconds"]','120');await page.locator('#ex-edit-form button[type=submit]').click();
  assert.equal(await page.evaluate(()=>testAPI.state.exercises.find(e=>e.id==='press').restSeconds),120);
  await page.locator('#open-exercise-press').click();assert.match(await page.locator('#detail-body').textContent(),/2:00 \(this exercise\)/);await page.locator('#detail-close').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('PASS Liftlog: plan preview, focus return, archive/unarchive, history visibility, routine picker, persisted recovery, unchanged saved blocks, warm-up ramp, session swap and per-exercise rest');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
