// Machines carry one adjustment note, names and bike identifiers stay unique, and the note shows above Start when the machine is in use.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {confirmAction}=require('./confirm-dialog.cjs');
const root=path.join(__dirname,'..','..');
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8').replace('appUpdates.refresh();updateShell();','appUpdates.refresh();updateShell();window.testAPI={storage,handle,render,get state(){return storage.state},get session(){return session}};');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://machine.test/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://machine.test/');
  const setups=page.locator('#saved-setups details'),button=name=>setups.getByRole('button',{name,exact:true});
  const status=()=>page.locator('#saved-setups .save-status').textContent();
  await page.locator('#saved-setups summary').click();
  assert.equal(await page.locator('#machineNote').isVisible(),false,'no card without a machine');

  // Save a machine with a note.
  await page.fill('#bikeId','Garage bike');await page.fill('#saved-setup-name','Garage bike');
  await page.fill('#saved-setup-note','Seat 7\nHandlebar 4, saddle forward 2');
  assert.equal(await page.locator('#saved-setups details label:has(#saved-setup-note) span.small').last().textContent(),'36 / 500');
  await button('Save as machine').click();
  let machines=await page.evaluate(()=>window.testAPI.state.machines);
  assert.deepEqual(machines.map(m=>[m.name,m.bikeId,m.note]),[['Garage bike','Garage bike','Seat 7\nHandlebar 4, saddle forward 2']]);
  assert.equal(await page.locator('#machineNote').isVisible(),true,'the card shows for the machine in use');
  assert.equal(await page.textContent('#machineNoteTitle'),'Garage bike');assert.match(await page.textContent('#machineNoteText'),/Seat 7\nHandlebar 4/);

  // A name or identifier already taken is refused, whatever the case.
  await page.selectOption('#saved-setup-select','');await page.fill('#saved-setup-name','garage BIKE');await page.fill('#bikeId','Other');
  await button('Save as machine').click();assert.match(await status(),/name exists/);
  await page.fill('#saved-setup-name','Basement bike');await page.fill('#bikeId','GARAGE bike');
  await button('Save as machine').click();assert.match(await status(),/Another machine already uses that bike identifier/);
  assert.equal(await page.evaluate(()=>window.testAPI.state.machines.length),1,'nothing was added');

  // A second machine without a note shows no card.
  await page.fill('#saved-setup-note','');await page.fill('#saved-setup-name','Basement bike');await page.fill('#bikeId','Basement');
  await button('Save as machine').click();assert.equal(await page.evaluate(()=>window.testAPI.state.machines.length),2);
  assert.equal(await page.evaluate(()=>'note' in window.testAPI.state.machines[1]),false,'an empty note is not stored');
  assert.equal(await page.locator('#machineNote').isVisible(),false,'no note, no card');

  // The card follows the Bike identifier box, and Use fills it from the machine.
  await page.fill('#bikeId','garage bike');assert.equal(await page.locator('#machineNote').isVisible(),true,'typing the identifier shows the note');
  await page.fill('#bikeId','unknown');assert.equal(await page.locator('#machineNote').isVisible(),false);
  await page.selectOption('#saved-setup-select','machines:'+machines[0].id);
  assert.equal(await page.inputValue('#saved-setup-note'),machines[0].note,'selecting a machine shows its note for editing');
  await button('Use').click();assert.equal(await page.inputValue('#bikeId'),'Garage bike');assert.equal(await page.locator('#machineNote').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no side scroll');

  // Editing the note updates the card and survives a reload; selecting a preset hides the field.
  await page.fill('#saved-setup-note','Seat 8');await confirmAction(page,()=>button('Update selected').click());
  assert.equal(await page.textContent('#machineNoteText'),'Seat 8');
  await page.reload();await page.fill('#bikeId','Garage bike');assert.equal(await page.textContent('#machineNoteText'),'Seat 8','the note is kept across a reload');
  await page.locator('#saved-setups summary').click();await page.fill('#saved-setup-name','Steady');await button('Save as preset').click();
  assert.equal(await page.locator('#saved-setup-note').isVisible(),false,'a preset has no note field');

  // Backups accept a note and refuse a bad one.
  const check=(mutate)=>page.evaluate(m=>{const b=JSON.parse(JSON.stringify(window.testAPI.storage.backup()));new Function('b',m)(b);try{const s=window.testAPI.storage.prepare(b);return {ok:true,note:s.machines[0].note};}catch(e){return {ok:false,message:e.message};}},mutate);
  assert.equal((await check("b.machines[0].note='  Seat 9  '")).note,'Seat 9','trimmed');
  assert.match((await check("b.machines[0].note='x'.repeat(501)")).message,/machine note/);
  assert.match((await check("b.machines[0].note=5")).message,/machine note/);
  assert.equal((await check("delete b.machines[0].note")).ok,true,'a machine saved before notes existed still loads');

  assert.deepEqual(errors,[]);
  console.log('bike-machine: ok');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
