// Foodlog at phone width under its production CSP: catalog import and merge, logging by meal,
// quick-created foods, totals with unknowns, editing and undo, day export, history, settings and backups.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {confirmAction}=require('./shared/confirm-dialog.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/foodlog/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('foodlog');
const catalog=path.join(root,'examples/foodlog-catalog.json');
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,serviceWorkers:'block',timezoneId:'Europe/Stockholm'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'||/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await page.route('https://food.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.clock.install({time:new Date('2026-01-20T08:30:00+01:00')});
    await page.goto('https://food.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('foodlog.state.v1')));
    const nav=view=>page.locator('.nav-btn[data-view="'+view+'"]').click();
    const fits=async where=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,where+' fits the screen width');
    const rows=()=>page.locator('#meals .row-btn');
    const dialog=page.locator('#addDialog');

    assert.equal(await page.textContent('#dayTitle'),'Today');
    assert.match(await page.textContent('#dayTotals'),/No daily targets yet/);
    await page.click('#addFood');assert.match(await page.textContent('#addResults'),/No foods yet/);await page.keyboard.press('Escape');
    console.log('PASS an empty log explains how to start');

    await nav('foods');assert.equal(await page.locator('#catalogBox').evaluate(d=>d.open),true,'the import box opens while the catalog is empty');
    // The import summary and the targets question follow each other in the shared dialog.
    await page.setInputFiles('#importCatalog',catalog);await page.getByRole('button',{name:'Import',exact:true}).click();
    await page.getByRole('button',{name:'Use targets',exact:true}).waitFor();
    assert.match(await page.textContent('#dlg-body'),/Set protein at least 100 g, fibre at least 30 g, saturated fat at most 25 g, salt at most 6 g\..*sugar limit is not applied/);
    await page.locator('#dlg-actions button').last().click();await page.locator('#dlg').waitFor({state:'hidden'});
    assert.match(await page.textContent('#catalogInfo'),/revision 3, dated 2026-01-15.*5 foods from the file, 0 added here/);
    assert.equal(await page.locator('#foodList .row-btn').count(),5);
    assert.deepEqual((await saved()).settings.targets.map(t=>t.key),['protein_g','fibre_g','saturated_fat_g','salt_g']);
    console.log('PASS the catalog file imports after a summary, and its targets apply without the sugar limit');

    await page.getByRole('button',{name:/Wholegrain Crispbread/}).click();
    const sheet=page.locator('#foodSheet');
    assert.match(await sheet.textContent(),/From the catalog file: Weigh one piece once and fill in/);
    assert.match(await sheet.locator('dl.details').textContent(),/derived › frequency_classeveryday/);
    await page.click('#editFood');await page.click('#addPortion');
    const portion=page.locator('#portionRows .portion-row').last();await portion.locator('input').first().fill('1 piece');await portion.locator('input').last().fill('12');
    await page.getByRole('button',{name:'Save food'}).click();
    assert.match(await sheet.textContent(),/Portions: 1 piece \(12 g\)/);
    await page.click('#logFood');await page.locator('#amountPane').waitFor();
    assert.equal(await page.inputValue('#amount'),'12');assert.equal(await page.locator('#portionChips button[aria-pressed="true"]').textContent(),'1 piece · 12 g');
    await page.click('#saveEntry');await dialog.waitFor({state:'hidden'});
    assert.match(await rows().first().textContent(),/Example Bakery Wholegrain Crispbread.*1 piece · 12 g · 08:30/);
    console.log('PASS a weighed piece becomes a portion and logs from the food sheet');

    await page.getByRole('button',{name:'Add to Snack'}).click();await page.fill('#addSearch','Jordnötssmör hemma');
    assert.match(await page.textContent('#addResults'),/No food matches/);await page.click('#addNewFood');
    assert.equal(await page.inputValue('#foodName'),'Jordnötssmör hemma');assert.equal(await page.isChecked('#foodEstimate'),true,'typical values default to estimates');
    await page.fill('#nut-energy_kcal','600');await page.fill('#nut-protein_g','25');await page.fill('#nut-salt_g','0.5');
    await page.getByRole('button',{name:'Save food'}).click();await page.locator('#amountPane').waitFor();
    await page.fill('#amount','15');assert.match(await page.textContent('#amountPreview'),/90 kcal · 3.8 g protein.*fibre unknown/);
    await page.click('#saveEntry');await dialog.waitFor({state:'hidden'});
    await page.click('#addFood');await page.fill('#addSearch','jordnotssmor');
    assert.equal(await page.locator('#addResults .row-btn').count(),1,'search ignores accents');await page.locator('#pickPane [data-close]').click();
    const fibre=page.locator('.target').filter({hasText:'Fibre'});
    assert.match(await fibre.textContent(),/1.4 \/ 30 g.*unknown for 1 item, so the true total is higher/);
    assert.match(await page.textContent('#dayTotals'),/134 kcal2 items · 67% of energy from estimates/);
    console.log('PASS a missing food is created from the add dialog, logged, found again and counted as unknown fibre');

    await nav('foods');await page.click('#newFood');await page.fill('#foodName','<img src=x onerror="window.pwned=1">');await page.fill('#nut-energy_kcal','1');
    await page.getByRole('button',{name:'Save food'}).click();
    assert.equal(await page.locator('#foodList img').count(),0);assert.match(await page.textContent('#foodList'),/<img src=x onerror="window.pwned=1">/);
    assert.equal(await page.evaluate(()=>window.pwned),undefined);
    console.log('PASS food names render as text');

    await nav('today');await rows().first().click();
    assert.equal(await page.isVisible('#removeEntry'),true);assert.equal(await page.isVisible('#amountBack'),false);
    await page.fill('#amount','24');await page.click('#saveEntry');await dialog.waitFor({state:'hidden'});
    assert.match(await rows().first().textContent(),/24 g · 08:30/);
    await rows().first().click();await page.click('#removeEntry');
    assert.equal(await rows().count(),1);assert.match(await page.textContent('#toast'),/Removed Example Bakery Wholegrain Crispbread/);
    await page.click('#toastAction');assert.equal(await rows().count(),2,'undo restores the entry');
    assert.equal(Object.keys((await saved()).versions).length,2);
    console.log('PASS entries edit in place, and remove offers undo');

    await page.click('#dayNotesBox summary');await page.fill('#dayNotes','Long walk');await page.fill('#dayActivity','Walk\nStretching');await page.locator('#dayActivity').blur();
    assert.deepEqual((await saved()).days['2026-01-20'],{notes:'Long walk',activity:'Walk\nStretching'});
    const exportEvent=page.waitForEvent('download');await page.click('#exportDay');const exported=await exportEvent;
    assert.equal(exported.suggestedFilename(),'food_log_2026-01-20.json');
    const day=JSON.parse(fs.readFileSync(await exported.path(),'utf8'));
    assert.deepEqual(day.activity,['Walk','Stretching']);assert.deepEqual(day.meals.map(m=>m.meal),['Breakfast','Snack']);
    assert.equal(day.meals[0].items[0].amount_g,24);assert.equal(day.meals[1].items[0].estimate,true);assert.equal(day.targets.salt_g_max,6);
    console.log('PASS day notes save and the day exports in the food log shape');

    await page.click('#prevDay');assert.equal(await page.textContent('#dayTitle'),'Yesterday');assert.equal(await rows().count(),0);assert.equal(await page.isDisabled('#nextDay'),false);
    await page.click('#nextDay');assert.equal(await page.textContent('#dayTitle'),'Today');assert.equal(await page.isDisabled('#nextDay'),true);
    await nav('history');assert.equal(await page.locator('#dayList .row-btn').count(),1);
    assert.match(await page.textContent('#dayList'),/Today · .*2 items.*Protein/);
    await page.locator('#dayList .row-btn').click();assert.equal(await page.isVisible('#today'),true);
    console.log('PASS day navigation and history');

    await nav('foods');await page.getByRole('button',{name:/Cottage Cheese/}).click();await page.click('#archiveFood');await page.locator('#foodSheet [data-close]').click();
    await nav('today');await page.click('#addFood');await page.fill('#addSearch','cottage');
    assert.equal(await page.locator('#addResults .row-btn').count(),0,'archived foods leave the add list');await page.locator('#pickPane [data-close]').click();
    console.log('PASS archived foods are hidden when adding');

    await nav('settings');
    await page.locator('#targetRows .target-row').first().locator('input').fill('120');await page.getByRole('button',{name:'Save targets'}).click();
    assert.equal(await page.textContent('#targetsStatus'),'Targets saved.');
    await page.fill('#mealNames','Breakfast\nPost-workout\nLunch\nDinner\nSnack');await page.getByRole('button',{name:'Save meals'}).click();
    await nav('today');assert.match(await page.locator('.target').first().textContent(),/\/ 120 g/);
    assert.deepEqual(await page.locator('#meals h2').allTextContents(),['Breakfast','Post-workout','Lunch','Dinner','Snack']);
    console.log('PASS targets and meals change in Settings');

    await nav('settings');await page.click('text=Backups & cloud storage');
    const backupEvent=page.waitForEvent('download');await page.click('#exportBackup');const backupFile=await backupEvent;
    const backup=JSON.parse(fs.readFileSync(await backupFile.path(),'utf8'));
    assert.equal(backup.app,'foodlog');assert.equal(backup.entries.length,2);assert.equal(backup.foods.length,7);
    const backupPath=await backupFile.path();
    await confirmAction(page,()=>page.setInputFiles('#importBackup',backupPath));
    await page.waitForFunction(()=>/Backup restored/.test(document.getElementById('toast').textContent));
    await page.reload();
    assert.equal((await saved()).entries.length,2);assert.equal(await rows().count(),2,'the log survives a reload');
    console.log('PASS full backups download and restore; data survives a reload');

    await page.setViewportSize({width:320,height:640});
    for(const view of ['today','foods','history','settings']){await nav(view);await fits(view);}
    await nav('today');await page.click('#addFood');await page.locator('#addResults .row-btn').first().click();await fits('Amount dialog');await page.locator('#amountPane [data-close]').click();
    await nav('foods');await page.click('#newFood');await fits('Food form');
    console.log('PASS every screen and dialog fits 320 px');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
