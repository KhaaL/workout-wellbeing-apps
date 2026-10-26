// Foodlog phase 2 at phone width under its CSP: free sugar marks, vitamins and minerals, copying a meal,
// favourites, vitamin editing, micronutrient targets and 7-day trends. The log is seeded through FoodCore.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/foodlog/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('foodlog');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'apps/foodlog/food-core.js'),'utf8'),context);
const F=vm.runInContext('FoodCore',context);
// A week of synthetic logging from the example catalog, plus honey with typical values.
function seed(){
  const s={settings:F.settings(),foods:[],versions:{},entries:[],days:{}},r=F.importCatalog(JSON.parse(fs.readFileSync(path.join(root,'examples/foodlog-catalog.json'),'utf8')),s);
  s.foods=r.foods;s.settings.targets=r.targets;s.settings.catalog={...r.catalog,importedAt:Date.UTC(2026,0,15)};
  s.foods.push(F.food({id:'honey',name:'Honey',brand:'',kind:'generic',basis:'g',nutrients:{energy_kcal:304,protein_g:0.3,carbohydrate_g:82,sugars_g:82,fibre_g:0,fat_g:0,saturated_fat_g:0,salt_g:0},source:'typical',estimate:true}));
  const food=id=>s.foods.find(f=>f.id===id);let n=0;
  const eat=(date,meal,id,amount,time)=>F.log(s,food(id),{date,meal,amount,time},'seed-'+(++n));
  for(const date of ['2026-01-12','2026-01-17','2026-01-19']){eat(date,'Breakfast','example-cottage-cheese',200,'07:30');eat(date,'Lunch','example-crispbread',60,'12:00');eat(date,'Lunch','example-peanut-butter',20,'12:00');}
  eat('2026-01-19','Lunch','example-oat-drink',250,'12:05');
  eat('2026-01-20','Breakfast','example-cottage-cheese',150,'07:30');eat('2026-01-20','Breakfast','honey',10,'07:30');eat('2026-01-20','Breakfast','example-oat-drink',200,'07:35');
  return {app:'foodlog',version:3,updatedAt:5,...JSON.parse(JSON.stringify(s))};
}
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',timezoneId:'Europe/Stockholm'});
    const page=await ctx.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'||/Content Security Policy/i.test(m.text()))errors.push(m.text());});
    await page.route('https://food.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.addInitScript(state=>{if(!localStorage.getItem('foodlog.state.v1'))localStorage.setItem('foodlog.state.v1',JSON.stringify(state));},seed());
    await page.clock.install({time:new Date('2026-01-20T13:00:00+01:00')});
    await page.goto('https://food.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('foodlog.state.v1')));
    const nav=view=>page.locator('.nav-btn[data-view="'+view+'"]').click();
    const fits=async where=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,where+' fits the screen width');
    const freeRow=page.locator('.target').filter({hasText:'Free sugars'});

    assert.match(await freeRow.textContent(),/Free sugars · at most0 \/ 50 g50 g left · unknown for 3 items/);
    await page.getByRole('button',{name:'Mark which sugars are free (3 foods)…'}).first().click();
    const sugars=page.locator('#sugarDialog');await sugars.waitFor();
    assert.deepEqual(await sugars.locator('.sugar-row > span:first-child').evaluateAll(rows=>rows.map(r=>r.firstChild.textContent)),['Example Dairy Cottage Cheese 1.5%','Honey','Example Mills Oat Drink Original']);
    await page.getByRole('button',{name:'Free: Honey',exact:true}).click();await page.getByRole('button',{name:'Not free: Example Mills Oat Drink Original'}).click();await page.getByRole('button',{name:'Not free: Example Dairy Cottage Cheese 1.5%'}).click();
    assert.equal(await page.getByRole('button',{name:'Free: Honey',exact:true}).getAttribute('aria-pressed'),'true');
    await sugars.locator('[data-close]').click();
    assert.match(await freeRow.textContent(),/8\.2 \/ 50 g41\.8 g left$/);
    assert.equal((await saved()).foods.find(f=>f.id==='honey').freeSugars,'yes');
    console.log('PASS foods with sugars are marked free or not, and the free sugars limit follows');

    await page.locator('details summary',{hasText:'Vitamins & minerals'}).click();
    assert.match(await page.locator('#dayTotals').textContent(),/Vitamin D2\.2 µg · listed for 1 of 3 items.*Calcium240 mg · listed for 1 of 3 items/);
    console.log('PASS vitamins and minerals show their totals and how many items list them');

    await page.getByRole('button',{name:'Copy a meal into Lunch'}).click();const copy=page.locator('#copyDialog');await copy.waitFor();
    assert.equal(await page.textContent('#copyTitle'),'Copy into Lunch');
    assert.match(await copy.locator('.row-btn').first().textContent(),/^Yesterday · LunchExample Bakery Wholegrain Crispbread, Example Pantry Peanut Butter Crunchy, Example Mills Oat Drink Original/);
    await fits('Copy dialog');
    await copy.locator('.row-btn').first().click();await copy.waitFor({state:'hidden'});
    const lunch=page.locator('section.meal[aria-label="Lunch"] .row-btn');
    assert.equal(await lunch.count(),3);assert.match(await lunch.first().textContent(),/60 g · 12:00/);
    await page.click('#toastAction');assert.equal(await lunch.count(),0,'undo removes the copied items');
    console.log('PASS a recent meal copies into another meal with its amounts and times, and undo removes it');

    await nav('foods');await page.getByRole('button',{name:/Peanut Butter Crunchy/}).click();
    await page.click('#favouriteFood');assert.equal(await page.getByRole('button',{name:'Remove from favourites'}).getAttribute('aria-pressed'),'true');
    await page.locator('#foodSheet [data-close]').click();
    assert.match(await page.locator('#foodList').textContent(),/Example Pantry Peanut Butter Crunchy★/);
    await page.check('#showFavourites');assert.equal(await page.locator('#foodList .row-btn').count(),1);await page.uncheck('#showFavourites');
    await nav('today');await page.getByRole('button',{name:'Add to Dinner'}).click();
    assert.match(await page.locator('#addResults .row-btn').first().textContent(),/Peanut Butter Crunchy★/,'a favourite leads when the meal has no recent foods');
    await page.locator('#pickPane [data-close]').click();
    console.log('PASS favourites are marked, filtered and ranked first when adding');

    await nav('foods');await page.getByRole('button',{name:/Wholegrain Crispbread/}).click();await page.click('#editFood');
    await page.selectOption('#foodFreeSugars','no');await page.click('#addMicro');
    const micro=page.locator('#microRows .portion-row').last();await micro.locator('select').selectOption('iron_mg');await micro.locator('input').fill('3.5');
    assert.equal(await micro.locator('.micro-unit').textContent(),'Per 100 g');await fits('Food form with a vitamin row');
    await page.getByRole('button',{name:'Save food'}).click();
    const sheet=await page.locator('#foodSheet').textContent();
    assert.match(sheet,/sugars are not free sugars/);assert.match(sheet,/Iron3\.5 mg/);
    await page.locator('#foodSheet [data-close]').click();
    console.log('PASS the food form sets the free sugars mark and vitamins or minerals');

    await nav('settings');await page.click('#addTarget');
    const row=page.locator('#targetRows .target-row').last();await row.locator('select').first().selectOption('vitamin_d_ug');await row.locator('input').fill('10');
    await page.getByRole('button',{name:'Save targets'}).click();assert.equal(await page.textContent('#targetsStatus'),'Targets saved.');
    await nav('today');assert.match(await page.locator('.target').filter({hasText:'Vitamin D'}).textContent(),/Vitamin D · at least2\.2 \/ 10 µg7\.8 µg to go · unknown for 2 items/);
    console.log('PASS a vitamin target joins the day’s targets');

    await nav('history');const trends=page.locator('#trends');
    assert.equal(await trends.isVisible(),true);
    assert.match(await page.textContent('#trendsSummary'),/^3 days with food logged, .* Averages count only those days; the week before had 1 day\.$/);
    const lines=await trends.locator('li').allTextContents();
    assert.equal(lines[0].startsWith('Energy · '),true);
    assert.ok(lines.some(line=>/^Protein · .* a dayat least 100 g: on target \d of 3 days · week before 40\.4 g/.test(line)),lines.join('\n'));
    assert.ok(lines.some(line=>/^Vitamin D · .*unknown for some items on 3 days/.test(line)));
    await page.setViewportSize({width:320,height:640});await fits('History with trends');
    console.log('PASS 7-day trends average logged days, count days on target and show the week before');
    assert.deepEqual(errors,[]);await ctx.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
