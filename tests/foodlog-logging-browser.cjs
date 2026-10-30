// Foodlog's add sheet under its CSP: + logs a food at its start amount and the sheet stays open,
// the list keeps its order, undo works inside the sheet, and the keyboard path runs search, Enter, Enter.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/foodlog/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('foodlog');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'apps/foodlog/food-core.js'),'utf8'),context);
const F=vm.runInContext('FoodCore',context);
// Two earlier breakfasts and one lunch from the example catalog.
function seed(){
  const s={settings:F.settings(),foods:[],versions:{},entries:[],days:{}},r=F.importCatalog(JSON.parse(fs.readFileSync(path.join(root,'examples/foodlog-catalog.json'),'utf8')),s);
  s.foods=r.foods;
  const food=id=>s.foods.find(f=>f.id===id);let n=0;
  const eat=(date,meal,id,amount,time,portion)=>F.log(s,food(id),{date,meal,amount,time,portion},'seed-'+(++n));
  for(const date of ['2026-01-17','2026-01-19']){eat(date,'Breakfast','example-cottage-cheese',200,'07:30');eat(date,'Breakfast','example-oat-drink',200,'07:31','1 serving');}
  eat('2026-01-19','Breakfast','example-crispbread',24,'07:32');eat('2026-01-19','Lunch','example-oat-drink',250,'12:05');
  return {app:'foodlog',version:3,updatedAt:5,...JSON.parse(JSON.stringify(s))};
}
async function open(browser,options){
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'Europe/Stockholm',...options});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'||/Content Security Policy/i.test(m.text()))errors.push(m.text());});
  await page.route('https://food.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
  await page.addInitScript(state=>{if(!localStorage.getItem('foodlog.state.v1'))localStorage.setItem('foodlog.state.v1',JSON.stringify(state));},seed());
  await page.clock.install({time:new Date('2026-01-20T08:00:00+01:00')});
  await page.goto('https://food.test/');
  return {ctx,page,errors};
}
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const {ctx,page,errors}=await open(browser,{isMobile:true,hasTouch:true});
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('foodlog.state.v1')));
    const on=async date=>(await saved()).entries.filter(e=>e.date===date);
    const names=()=>page.locator('#addResults .row-btn .name').evaluateAll(rows=>rows.map(r=>r.firstChild.textContent));
    const summary=()=>page.textContent('#addSoFarText');
    const dialog=page.locator('#addDialog');

    await page.getByRole('button',{name:'Add to Breakfast'}).click();
    const order=await names();
    assert.deepEqual(order.slice(0,3),['Example Bakery Wholegrain Crispbread','Example Mills Oat Drink Original','Example Dairy Cottage Cheese 1.5%'],'yesterday’s breakfast leads, latest first');
    assert.match(await page.locator('#addResults .pick-row').nth(1).textContent(),/1 serving · 200 ml · 96 kcal/);
    assert.notEqual(await page.evaluate(()=>document.activeElement.id),'addSearch','a touch keyboard does not cover the list on open');
    assert.equal(await summary(),'Breakfast · Today: nothing yet');
    console.log('PASS the sheet opens on this meal’s recent foods, each with the amount + would log');

    const cheese=page.getByRole('button',{name:/^Add Example Dairy Cottage Cheese 1\.5%, 200 g/});
    await cheese.click();
    assert.equal(await dialog.isVisible(),true,'the sheet stays open');
    assert.equal(await summary(),'Breakfast · Today: 1 item · 152 kcal');
    assert.deepEqual(await names(),order,'the list keeps its order after an add');
    assert.equal(await cheese.getAttribute('data-count'),'1');assert.match(await cheese.getAttribute('aria-label'),/, 1 already in Breakfast$/);
    assert.equal(await page.locator('#addDialog #toast').isVisible(),true,'the toast shows above the sheet');
    assert.match(await page.textContent('#toastText'),/^Added Example Dairy Cottage Cheese 1\.5% · 200 g\.$/);
    assert.deepEqual((await on('2026-01-20')).map(e=>[e.meal,e.amount,e.time]),[['Breakfast',200,'08:00']]);
    const oat=page.getByRole('button',{name:/^Add Example Mills Oat Drink Original/});
    await oat.click();assert.equal(await summary(),'Breakfast · Today: 2 items · 248 kcal');
    await page.click('#toastAction');
    assert.equal(await summary(),'Breakfast · Today: 1 item · 152 kcal');assert.equal(await oat.getAttribute('data-count'),null,'undo clears the mark');
    console.log('PASS + logs the shown amount in one tap, marks the food and keeps the list still; undo works in the sheet');

    await page.selectOption('#addMeal','Lunch');
    assert.equal(await summary(),'Lunch · Today: nothing yet');
    assert.match(await page.locator('#addResults .pick-row').filter({hasText:'Oat Drink'}).textContent(),/250 ml · 120 kcal/,'the amount follows the meal');
    await page.selectOption('#addMeal','Breakfast');
    console.log('PASS each meal starts a food at the amount last eaten in that meal');

    await page.locator('#addResults .row-btn').first().click();
    assert.equal(await page.inputValue('#amount'),'24');assert.equal(await page.textContent('#saveEntry'),'Add to Breakfast');
    assert.equal(await page.textContent('#entryMoreText'),'Time, meal & note: 08:00 · Breakfast');assert.equal(await page.isVisible('#entryTime'),false,'time, meal and note start folded');
    await page.fill('#amount','36');await page.click('#saveEntry');
    assert.equal(await page.isVisible('#pickPane'),true,'adding returns to the list');
    assert.equal(await summary(),'Breakfast · Today: 2 items · 285 kcal');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'addSoFarText');
    console.log('PASS a food’s name opens its amount, and Add returns to the list with the meal so far');

    await page.click('#addSoFarText');const items=page.locator('#addSoFarList .row-btn');
    assert.equal(await items.count(),2);await items.filter({hasText:'Cottage Cheese'}).click();
    assert.equal(await page.isVisible('#amountBack'),true);assert.equal(await page.textContent('#saveEntry'),'Save');
    await page.click('#removeEntry');assert.equal(await page.isVisible('#pickPane'),true);
    assert.equal(await summary(),'Breakfast · Today: 1 item · 133 kcal');
    await page.click('#toastAction');assert.equal(await summary(),'Breakfast · Today: 2 items · 285 kcal');
    console.log('PASS items logged in the meal edit and remove from the sheet, with undo');

    await page.locator('#pickPane [data-close]').click();await dialog.waitFor({state:'hidden'});
    assert.equal(await page.locator('section.meal[aria-label="Breakfast"] .row-btn').count(),2);
    // The dialog hides at once, but its close event, which moves the toast back, runs in a later task.
    await page.waitForFunction(()=>document.getElementById('toast').parentElement===document.body,null,{timeout:2000});
    console.log('PASS Done closes the sheet on the updated day');

    await page.click('#prevDay');await page.getByRole('button',{name:'Add to Breakfast'}).click();
    assert.match(await summary(),/^Breakfast · Yesterday: 3 items/);
    await page.getByRole('button',{name:/^Add Example Pantry Peanut Butter Crunchy, 100 g/}).click();
    const late=(await on('2026-01-19')).at(-1);assert.equal(late.amount,100);assert.equal('time' in late,false,'a later log of an earlier day gets no clock time');
    await page.setViewportSize({width:320,height:480});
    assert.equal(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth),true,'the sheet fits 320 px');
    await dialog.evaluate(d=>{d.scrollTop=d.scrollHeight;});
    const [sheetTop,searchTop]=await Promise.all([dialog.evaluate(d=>d.getBoundingClientRect().top),page.locator('#addSearch').evaluate(i=>i.getBoundingClientRect().top)]);
    assert.ok(await dialog.evaluate(d=>d.scrollTop>0),'the list scrolls at this height');
    assert.ok(searchTop>sheetTop&&searchTop<sheetTop+120,'the meal, search and summary stay at the top while the list scrolls');
    await page.locator('#pickPane [data-close]').click();
    console.log('PASS an earlier day logs without a clock time; the sheet fits 320 px and keeps its search in view');
    assert.deepEqual(errors,[]);await ctx.close();

    const desk=await open(browser,{});
    await desk.page.click('#addFood');
    assert.equal(await desk.page.evaluate(()=>document.activeElement.id),'addSearch','a mouse or trackpad starts in the search');
    await desk.page.keyboard.type('peanut');await desk.page.keyboard.press('Enter');
    assert.equal(await desk.page.evaluate(()=>document.activeElement.id),'amount');
    await desk.page.keyboard.type('30');await desk.page.keyboard.press('Enter');
    assert.equal(await desk.page.isVisible('#pickPane'),true);
    assert.equal(await desk.page.evaluate(()=>document.activeElement.id),'addSearch','the search takes the next food');
    assert.equal(await desk.page.inputValue('#addSearch'),'');
    const entry=(await desk.page.evaluate(()=>JSON.parse(localStorage.getItem('foodlog.state.v1')))).entries.filter(e=>e.date==='2026-01-20');
    assert.deepEqual(entry.map(e=>[e.meal,e.amount]),[['Breakfast',30]]);
    await desk.page.keyboard.type('oat');await desk.page.locator('#addResults .quick-add').first().click();
    await desk.page.click('#addSearch');
    assert.deepEqual(await desk.page.locator('#addSearch').evaluate(i=>[i.selectionStart,i.selectionEnd]),[0,3],'a click into the search selects the last query');
    await desk.page.keyboard.type('cottage');assert.equal(await desk.page.inputValue('#addSearch'),'cottage');
    console.log('PASS the keyboard logs a food with search, Enter, amount, Enter; the next search replaces the last');
    assert.deepEqual(desk.errors,[]);await desk.ctx.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
