// Browser checks for exercise instructions: the forms, the detail sheet and the workout pop-out.
const assert = require('node:assert/strict');
const {appWithTestAPI,launchBrowser}=require('./harness.cjs');
const html=appWithTestAPI(`{navigate,render,startRoutine,startTimer,exerciseById,get timer(){return timer},get state(){return state},get ui(){return ui}}`);
const steps='# Setup\nSeat height 4.\n\n1. Brace\n2. Press\n   - exhale at the top\n\n[a link](https://example.com)';
(async()=>{
 const browser=await launchBrowser();const errors=[];
 try {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',route=>route.request().url().startsWith('https://liftlog.test/')?route.fulfill({contentType:'text/html',body:html}):route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://liftlog.test/');
  await page.evaluate(()=>window.testAPI.navigate('exercises'));
  await page.locator('[data-action="ex-form-toggle"]').first().click();
  const form=page.locator('form[data-form="ex-new"]');
  await form.locator('input[name="exname"]').fill('Seated Press');
  await form.locator('input[name="exnotes"]').fill('Seat 4, pin 7');
  const box=form.locator('#ex-new-instructions');
  await box.fill(steps);
  await form.getByRole('button',{name:'Preview',exact:true}).click();
  const preview=form.locator('#ex-new-instructions-preview');
  assert.equal(await preview.isVisible(),true);assert.equal(await box.isVisible(),false);
  assert.match(await preview.innerHTML(),/<h3>Setup<\/h3><p>Seat height 4\.<\/p><ol><li>Brace<\/li><li>Press<ul><li>exhale at the top<\/li><\/ul><\/li><\/ol>/);
  assert.equal(await preview.locator('a').count(),0,'links show as typed');
  await form.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await box.inputValue(),steps,'switching back keeps the typed text');
  await form.getByRole('button',{name:'Add exercise',exact:true}).click();
  const saved=await page.evaluate(()=>window.testAPI.state.exercises.find(e=>e.name==='Seated Press'));
  assert.equal(saved.instructions,steps);assert.equal(saved.notes,'Seat 4, pin 7','notes stay a separate field');
  console.log('PASS the add form previews instructions and saves them beside notes');

  await page.getByRole('button',{name:'Seated Press',exact:true}).first().click();
  const sheet=page.getByRole('dialog',{name:'Seated Press'});
  assert.match(await sheet.locator('[aria-labelledby="detail-instructions"]').innerText(),/Instructions\s+Setup\s+Seat height 4\.\s+Brace\s+Press\s+exhale at the top/i);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail-dlg').open);
  console.log('PASS the exercise sheet shows the formatted instructions');

  await page.evaluate(id=>{const t=window.testAPI;
   t.state.routines.push({id:'ins-rt',name:'Press day',items:[{id:'ins-1',exerciseId:id,sets:2,repsMin:8,repsMax:10},{id:'ins-2',exerciseId:t.state.exercises.find(e=>!e.instructions&&e.id!==id).id,sets:1,repsMin:5,repsMax:5}]});
   t.navigate('today');t.startRoutine('ins-rt');t.startTimer();},saved.id);
  const button=page.getByRole('button',{name:'Instructions for Seated Press',exact:true});
  await button.waitFor();
  const before=await page.evaluate(()=>window.testAPI.timer.endsAt);
  await button.click();
  const pop=page.getByRole('dialog',{name:'Seated Press'});
  await pop.waitFor();
  assert.match(await pop.innerText(),/Instructions[\s\S]*Setup[\s\S]*Brace[\s\S]*\[a link\]\(https:\/\/example\.com\)/);
  assert.equal(await pop.locator('a').count(),0);
  assert.deepEqual(await pop.locator('.md ol, .md ul').evaluateAll(lists=>lists.map(l=>getComputedStyle(l).listStyleType)),['decimal','circle'],
    'numbered steps and nested bullets keep their markers');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the pop-out fits the phone width');
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.testAPI.timer.running),true,'the rest timer keeps running behind the pop-out');
  assert.equal(await page.evaluate(()=>window.testAPI.timer.endsAt),before,'the timer is left untouched');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail-dlg').open);
  // closing renders the page again, so focus lands on the button a frame later
  await page.waitForFunction(()=>document.activeElement&&document.activeElement.getAttribute('aria-label')==='Instructions for Seated Press',null,{timeout:2000})
    .catch(()=>assert.fail('focus returns to the button'));
  await button.click();await pop.getByRole('button',{name:'Back to workout',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#detail-dlg').open);
  console.log('PASS the workout button opens the instructions; Escape and Back to workout close it and return focus');

  await page.evaluate(()=>{const w=window.testAPI.state.activeWorkout;w.currentExerciseIndex=1;window.testAPI.render();});
  assert.equal(await page.getByRole('button',{name:/^Instructions for /}).count(),0,'an exercise without instructions has no button');
  console.log('PASS only exercises with instructions show the button');

  await page.evaluate(()=>{window.testAPI.state.activeWorkout=null;window.testAPI.navigate('exercises');});
  await page.getByRole('button',{name:'Seated Press',exact:true}).first().click();
  await page.getByRole('dialog',{name:'Seated Press'}).getByRole('button',{name:/Edit/}).first().click();
  const edit=page.locator('#ex-edit-instructions');
  assert.equal(await edit.inputValue(),steps,'the editor loads the saved instructions');
  await edit.fill('Keep it **slow**.');
  await page.locator('form[data-form="ex-save"]').getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(id=>window.testAPI.exerciseById(id).instructions,saved.id),'Keep it **slow**.');
  console.log('PASS the edit form loads and saves instructions');
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS no browser errors in instruction flows');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
