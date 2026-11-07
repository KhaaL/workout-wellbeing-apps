// Check-in at phone width under its production CSP: tap counts for common check-ins, the merge
// window, symptom severity steps, undo, notes, history, tracked items, timing settings,
// deleting all check-ins with a recovery copy, backup restore and 320 px layouts.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {confirmAction}=require('./shared/confirm-dialog.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/checkin/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('checkin');
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,serviceWorkers:'block',timezoneId:'Europe/Stockholm'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'||/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await page.route('https://checkin.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.clock.install({time:new Date('2026-01-20T09:00:00+01:00')});
    await page.goto('https://checkin.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('checkin.state.v1')));
    const nav=view=>page.locator('.nav-btn[data-view="'+view+'"]').click();
    const fits=async where=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,where+' fits the screen width');
    const mood=n=>page.locator('#moodBox .mood').nth(n-1);
    const symptom=name=>page.locator('#symptomChips .symptom',{hasText:name});
    const row=name=>page.locator('#symptomRows .ongoing',{has:page.locator('strong',{hasText:name})});
    const level=(name,label)=>row(name).getByRole('button',{name:name+' '+label,exact:true});
    const entries=()=>page.locator('#dayEntries li');
    // Taps counted from an app already open on Today.
    let taps=0;const tap=async locator=>{taps++;await locator.click();};

    assert.equal(await page.textContent('#todayTitle'),'Today');
    assert.match(await page.textContent('#dayEmpty'),/No check-ins yet today/);
    assert.equal(await page.locator('#moodBox .mood').count(),5);
    assert.deepEqual(await page.locator('#symptomChips .symptom').allTextContents(),['Headache','Fatigue','Anxiety','Low mood','Nausea','+ Other']);
    assert.equal(await page.locator('#symptomRows li').count(),0,'nothing is recorded or ongoing on a fresh start');
    console.log('PASS Today opens with a 5-point mood row and the default symptoms');

    await tap(mood(3));
    assert.equal(taps,1,'mood only takes 1 tap');
    let state=await saved();assert.equal(state.entries.length,1);assert.deepEqual(state.entries[0].values,{mood:3});
    assert.equal(await mood(3).getAttribute('aria-pressed'),'true');
    assert.match(await page.textContent('#windowState'),/Updating the 09:00 check-in until 09:30/);
    assert.match(await entries().first().textContent(),/09:00Mood 3 Okay/);
    console.log('PASS mood takes 1 tap and saves at once');

    taps=0;await page.clock.fastForward('05:00');
    await tap(symptom('Headache'));
    state=await saved();assert.equal(state.entries.length,1,'a tap inside the window edits the same check-in');
    assert.deepEqual(state.entries[0].values,{mood:3,headache:1});
    assert.equal(await symptom('Headache').count(),0,'a recorded symptom leaves the chips');
    assert.equal(await level('Headache','mild').getAttribute('aria-pressed'),'true');assert.equal(await row('Headache').locator('.hint').textContent(),'New in this check-in');
    assert.equal(await row('Headache').getByRole('button',{name:'Headache gone'}).count(),0,'a new symptom has no Gone level');
    await tap(symptom('Fatigue'));await tap(level('Fatigue','severe'));
    assert.equal(taps,3);assert.equal((await saved()).entries[0].values.fatigue,3,'severe takes 2 taps');
    assert.match(await entries().first().textContent(),/Mood 3 Okay, Fatigue severe, Headache mild/);
    console.log('PASS a chip records mild and opens a row of levels; severe takes 2 taps');

    for(const label of ['mild','moderate','severe','severe','mild','mild']){
      await level('Fatigue',label).click();
      assert.equal(await row('Fatigue').count(),1,'the row stays after '+label);
    }
    assert.equal((await saved()).entries[0].values.fatigue,1,'trying levels keeps the last one chosen; tapping the chosen one changes nothing');
    await row('Fatigue').getByRole('button',{name:'Remove Fatigue from this check-in'}).click();
    assert.equal('fatigue' in (await saved()).entries[0].values,false,'× removes it');
    assert.equal(await symptom('Fatigue').count(),1,'and the chip returns');
    await page.click('#toastAction');assert.equal((await saved()).entries[0].values.fatigue,1,'Undo brings it back');
    await row('Fatigue').getByRole('button',{name:'Remove Fatigue from this check-in'}).click();
    console.log('PASS trying levels never removes a symptom; only × does, with Undo');

    await tap(mood(4));assert.equal((await saved()).entries[0].values.mood,4,'another mood replaces the first');
    await page.click('#toastAction');assert.equal((await saved()).entries[0].values.mood,3,'Undo restores the previous mood');
    assert.match(await page.textContent('#toastText'),/Undone/);
    await tap(mood(3));assert.equal('mood' in (await saved()).entries[0].values,false,'tapping the chosen mood clears it');
    await page.click('#toastAction');
    console.log('PASS Undo reverses a tap, and tapping the chosen mood clears it');

    await page.click('#noteBox summary');await page.fill('#note','Slept 5 hours');await page.locator('#note').blur();
    assert.equal((await saved()).entries[0].note,'Slept 5 hours');
    assert.match(await entries().first().locator('.note').textContent(),/Slept 5 hours/);
    console.log('PASS a note joins the open check-in');

    await page.clock.fastForward('30:00');
    assert.match(await page.textContent('#windowState'),/next tap starts a new check-in/,'Today refreshes when the window closes');
    assert.equal(await mood(3).getAttribute('aria-pressed'),'false');assert.equal(await page.inputValue('#note'),'');
    assert.equal(await row('Headache').getByRole('button',{name:'Headache gone'}).count(),1,'the 09:00 headache is now ongoing, with Gone');
    taps=0;await tap(mood(2));await tap(symptom('Anxiety'));await tap(level('Anxiety','moderate'));
    assert.equal(taps,3);state=await saved();assert.equal(state.entries.length,2);
    assert.deepEqual(state.entries[1].values,{mood:2,anxiety:2});
    assert.deepEqual(await entries().locator('time').allTextContents(),['09:35','09:00'],'latest first');
    console.log('PASS after the window a tap starts a new check-in; mood and a moderate symptom take 3 taps');

    await nav('history');
    assert.match(await page.textContent('#dayList h2'),/Today · 2 check-ins/);
    assert.equal(await page.locator('#dayList .entries li').count(),2);
    console.log('PASS History lists the day with both check-ins');

    await nav('settings');
    await page.fill('#newItemName','Dizziness');await page.getByRole('button',{name:'Add symptom'}).click();
    assert.match(await page.textContent('#itemsStatus'),/Dizziness added to Today/);assert.equal(await page.inputValue('#newItemName'),'');
    await page.fill('#newItemName','headache');await page.getByRole('button',{name:'Add symptom'}).click();
    assert.match(await page.textContent('#itemsStatus'),/already tracked/);
    await page.getByRole('button',{name:'Archive Nausea'}).click();
    assert.equal(await page.isVisible('#archivedBox'),true);
    await page.getByLabel('Name of Headache').fill('Migraine');await page.getByLabel('Name of Headache').press('Enter');await page.locator('#itemsStatus').filter({hasText:'Renamed to Migraine'}).waitFor();
    await page.locator('.item-row',{has:page.getByLabel('Name of Low mood')}).getByRole('checkbox').uncheck();
    await nav('today');
    assert.deepEqual(await page.locator('#symptomChips .symptom').allTextContents(),['Fatigue','Dizziness','+ Other']);
    assert.deepEqual(await page.locator('#symptomRows strong').allTextContents(),['Migraine','Anxiety'],'the ongoing headache under its new name, and Anxiety from the open check-in');
    assert.match(await entries().last().textContent(),/Migraine mild/,'history follows the rename');
    console.log('PASS Settings add, rename, hide and archive symptoms; Today and history follow');

    await nav('settings');
    await page.fill('#mergeMinutes','10');await page.locator('#mergeMinutes').blur();
    await page.fill('#dayStart','03:00');await page.locator('#dayStart').blur();
    state=await saved();assert.equal(state.settings.mergeMinutes,10);assert.equal(state.settings.dayStart,'03:00');
    console.log('PASS timing settings save on change');

    await page.click('text=Backups & cloud storage');
    const backupEvent=page.waitForEvent('download');await page.click('#exportBackup');const backupFile=await backupEvent;
    const backupPath=await backupFile.path(),backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
    assert.equal(backup.app,'checkin');assert.equal(backup.entries.length,2);

    await page.click('#dangerBox summary');
    await confirmAction(page,()=>page.click('#deleteAll'));
    await page.waitForFunction(()=>/Check-ins deleted/.test(document.getElementById('toastText').textContent));
    state=await saved();assert.equal(state.entries.length,0);assert.equal(state.items.some(i=>i.name==='Dizziness'),true,'tracked items are kept');
    const recovery=await page.evaluate(()=>JSON.parse(localStorage.getItem('checkin.v1.before-remote-restore')));
    assert.equal(recovery.entries.length,2,'a recovery copy holds the deleted check-ins');
    console.log('PASS Delete all check-ins confirms, keeps items and saves a recovery copy');

    await confirmAction(page,()=>page.setInputFiles('#importBackup',backupPath));
    await page.waitForFunction(()=>/Backup restored/.test(document.getElementById('toast').textContent));
    await page.reload();
    assert.equal((await saved()).entries.length,2);assert.equal(await entries().count(),2,'check-ins survive a reload');
    console.log('PASS a backup file restores and survives a reload');

    // A symptom that lasts days: added on Today, then one tap per day in the Ongoing row.
    await page.clock.fastForward('15:00');
    taps=0;await tap(page.locator('.add-symptom'));await page.fill('#quickName','Runny nose');taps++;await page.press('#quickName','Enter');
    assert.equal(taps,2,'a new symptom takes + Other and Enter');
    state=await saved();let runny=state.items.find(i=>i.name==='Runny nose');
    assert.equal(runny.pinned,false,'added from Today, so it shows only while recorded or ongoing');
    assert.equal(state.entries.at(-1).values[runny.id],1);assert.equal(await level('Runny nose','mild').getAttribute('aria-pressed'),'true');
    await page.click('#toastAction');state=await saved();
    assert.equal(state.items.some(i=>i.name==='Runny nose'),false,'Undo removes the new item too');assert.equal(state.entries.length,2);
    await tap(page.locator('.add-symptom'));await page.fill('#quickName','Runny nose');await page.press('#quickName','Enter');
    runny=(await saved()).items.find(i=>i.name==='Runny nose');
    for(const label of ['moderate','severe','mild'])await level('Runny nose',label).click();
    assert.equal(await row('Runny nose').count(),1,'a symptom added from Today stays while trying every level');
    await page.clock.fastForward('24:00:00');
    assert.deepEqual(await page.locator('#symptomRows strong').allTextContents(),['Migraine','Anxiety','Runny nose']);
    assert.match(await row('Runny nose').locator('.hint').textContent(),/^last mild yesterday$/);
    assert.equal(await row('Runny nose').locator('[data-last="true"]').textContent(),'Mild','the last level is outlined');
    assert.equal(await symptom('Runny nose').count(),0,'an ongoing symptom leaves the chips');
    taps=0;await tap(row('Runny nose').getByRole('button',{name:'Runny nose moderate'}));
    assert.equal(taps,1,'updating an ongoing symptom takes 1 tap');
    state=await saved();assert.equal(state.entries.at(-1).values[runny.id],2);assert.equal(state.entries.at(-1).day,'2026-01-21');
    assert.equal(await row('Runny nose').locator('[aria-pressed="true"]').textContent(),'Moderate');
    await page.clock.fastForward('24:00:00');
    assert.match(await row('Runny nose').locator('.hint').textContent(),/^Since .*20.* · last moderate yesterday$/,'the run started on 20 Jan');
    await tap(row('Runny nose').getByRole('button',{name:/Runny nose gone/}));
    assert.equal((await saved()).entries.at(-1).values[runny.id],0);
    assert.match(await entries().first().textContent(),/Runny nose gone/);
    await page.clock.fastForward('24:00:00');
    assert.equal(await row('Runny nose').count(),0,'gone ends it');assert.equal(await symptom('Runny nose').count(),0,'and it leaves Today');
    console.log('PASS a lasting symptom: added from Today in 2 taps, then 1 tap a day in Ongoing until marked gone');

    await page.setViewportSize({width:320,height:640});
    for(const view of ['today','history','settings']){await nav(view);await fits(view);}
    await nav('today');await page.locator('.add-symptom').click();await fits('quick add form');
    console.log('PASS every screen fits 320 px');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
