const {navigate: navigateUI}=require('./ui-navigation.cjs');
/* Real service-worker install/update cycle and two-tab workout deferral. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),releases=new Map([['bike-cardio',1],['liftlog',1]]);
const server=http.createServer((req,res)=>{
  const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean),app=parts.shift();
  if(!releases.has(app)){res.writeHead(404).end();return;}
  let file=parts.join('/')||'index.html';const full=path.join(root,'dist',app,file);
  if(!full.startsWith(path.join(root,'dist',app)+path.sep)){res.writeHead(400).end();return;}
  try{
    let body=fs.readFileSync(full);const version=releases.get(app),sw=app==='liftlog'?'sw.js':'service-worker.js';
    if(file==='index.html')body=Buffer.from(body.toString().replace(/(<meta name="app-version" content=")[^"]+/, '$1test-release-'+version));
    if(file===sw)body=Buffer.from(body.toString().replace(/const CACHE = '[^']+';/,`const CACHE = '${app}-shell-update-test-${version}';`));
    const type=file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':'application/manifest+json';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(body);
  }catch(error){res.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    for(const app of ['bike-cardio','liftlog']){
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const url=address+'/'+app+'/';await page.goto(url);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const openUpdates=async p=>{
        if(app==='bike-cardio'){
          await navigateUI(p,'settings');const panel=p.locator('details').filter({has:p.locator('summary',{hasText:'Install & offline use'})}).last();if(!await panel.evaluate(node=>node.open))await panel.locator('summary').first().click();
        }else{
          await p.locator('.nav-btn[data-view="settings"]').click();const panel=p.locator('details[data-settings-section="app-updates"]');if(!await panel.evaluate(node=>node.open))await panel.locator('summary').first().click();
        }
      };
      await openUpdates(page);assert.match(await page.locator('#checkAppUpdate').locator('..').locator('..').textContent(),/test-release-1/);
      releases.set(app,2);await page.bringToFront();
      // Simulate returning after the automatic-check throttle, without waiting
      // a minute or changing the workout's clock in the other app tab.
      await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+61000;document.dispatchEvent(new Event('visibilitychange'));Date.now=now;});
      await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
      await page.waitForFunction(()=>!document.getElementById('applyAppUpdate').disabled);
      assert.match(await page.locator('#applyAppUpdate').locator('..').locator('..').textContent(),/Update ready/);
      const second=await context.newPage();second.on('pageerror',error=>errors.push(error.message));await second.goto(url);
      if(app==='bike-cardio'){await navigateUI(second,'settings');await second.uncheck('#voice');await second.uncheck('#beeps');await navigateUI(second,'setup');await second.click('#start');await second.waitForFunction(()=>!!JSON.parse(localStorage.getItem('bike-cardio.state.v1')).active);}
      else{await second.locator('[data-action="start-empty"]').click();await second.waitForFunction(()=>!!JSON.parse(localStorage.getItem('liftlog.v1')).activeWorkout);}
      // An update must remain waiting while another tab has a workout.
      const oldVersion=await page.locator('meta[name="app-version"]').getAttribute('content');await page.click('#applyAppUpdate');
      await page.waitForFunction(()=>/Update deferred|Save failed/.test(document.getElementById('checkAppUpdate').parentElement.parentElement.textContent));
      assert.equal(await page.locator('meta[name="app-version"]').getAttribute('content'),oldVersion);
      assert.equal(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),true);
      await second.close();await page.reload();
      const stateKey=app==='bike-cardio'?'bike-cardio.state.v1':'liftlog.v1';
      assert.ok(await page.evaluate(({stateKey,app})=>{const state=JSON.parse(localStorage.getItem(stateKey));return app==='bike-cardio'?state.active:state.activeWorkout;},{stateKey,app}));
      if(app==='bike-cardio'){
        await openUpdates(page);assert.equal(await page.locator('#applyAppUpdate').isDisabled(),true);
        await navigateUI(page,'setup');await page.click('#endSaved');await page.click('#again');
      }else{
        // End the recoverable workout through its normal confirmation.
        const overview=page.locator('dialog[open]');if(await overview.count()){const close=overview.locator('[data-action="overview-close"]');if(await close.count())await close.click();}
        await page.locator('[data-action="finish-workout"]').first().click();await page.getByRole('button',{name:'Discard',exact:true}).click();
      }
      await openUpdates(page);await page.waitForFunction(()=>!document.getElementById('applyAppUpdate').disabled);
      await page.waitForFunction(({stateKey,app})=>{const s=JSON.parse(localStorage.getItem(stateKey));return !(app==='bike-cardio'?s.active:s.activeWorkout);},{stateKey,app});
      const stateBefore=await page.evaluate(key=>localStorage.getItem(key),stateKey);
      await page.click('#applyAppUpdate');await page.waitForFunction(()=>document.querySelector('meta[name="app-version"]').content==='test-release-2');
      const after=await page.evaluate(key=>localStorage.getItem(key),stateKey);assert.ok(after===stateBefore,'Update changed saved data: '+Object.keys(JSON.parse(after)).filter(key=>JSON.stringify(JSON.parse(after)[key])!==JSON.stringify(JSON.parse(stateBefore)[key])).join(', '));
      await context.setOffline(true);await page.reload();assert.equal(await page.locator('meta[name="app-version"]').getAttribute('content'),'test-release-2');
      assert.deepEqual(errors,[]);await context.close();console.log('PASS '+app+': explicit service-worker update, two-tab deferral, saved-workout protection, unchanged data and offline version.');
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
