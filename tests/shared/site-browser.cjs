// The whole site from one local origin, served the way the static host does: root _headers rules,
// _redirects and 404.html. Checks the home page, separate service-worker scopes and offline caches,
// per-app manifests and offline launches. Service workers need a secure context, which localhost is.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=require('./site-server.cjs');
const apps=['liftlog','bike-cardio','tabata','foodlog'];
(async()=>{
  const server=await site.start(),origin=server.origin;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(/Content Security Policy|Refused to/i.test(message.text()))errors.push(message.text());});

    await page.goto(origin+'/');
    assert.equal(await page.title(),'Wellbeing apps');
    assert.deepEqual(await page.locator('.app').evaluateAll(links=>links.map(a=>new URL(a.href).pathname)),apps.map(app=>'/'+app+'/'));
    assert.equal(await page.locator('.app img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),true,'app icons load under the home policy');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'the home page fits 390 px');
    assert.equal(await page.locator('link[rel="manifest"]').count(),0,'the home page offers no install of its own');
    console.log('PASS the home page lists every app with its icon and installs nothing itself');

    for(const app of apps){
      const response=await page.goto(origin+'/'+app);
      assert.equal(new URL(response.url()).pathname,'/'+app+'/','the bare folder redirects to the trailing slash');
      const registration=await page.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;return reg.scope;});
      assert.equal(registration,origin+'/'+app+'/',app+' worker scope');
      const manifest=await page.evaluate(async()=>{const link=document.querySelector('link[rel="manifest"]');const json=await (await fetch(link.href)).json();
        const start=new URL(json.start_url,link.href).href;return {start,scope:new URL(json.scope,link.href).href,id:new URL(json.id,start).href};});
      assert.deepEqual(manifest,{start:origin+'/'+app+'/',scope:origin+'/'+app+'/',id:origin+'/'+app+'/'},app+' manifest');
      await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    }
    console.log('PASS each app lives in its own folder with its own worker scope and manifest identity');

    await page.goto(origin+'/');
    const state=await page.evaluate(async()=>({controlled:!!navigator.serviceWorker.controller,
      scopes:(await navigator.serviceWorker.getRegistrations()).map(reg=>new URL(reg.scope).pathname).sort(),
      caches:(await caches.keys()).map(key=>key.replace(/-shell-.*/,'')).sort(),keys:Object.keys(localStorage)}));
    assert.equal(state.controlled,false,'no app worker controls the home page');
    assert.deepEqual(state.scopes,['/bike-cardio/','/foodlog/','/liftlog/','/tabata/']);
    assert.deepEqual(state.caches,['bike-cardio','foodlog','liftlog','tabata'],'one offline cache per app');
    assert.deepEqual(state.keys.filter(key=>!apps.some(app=>key.startsWith(app==='bike-cardio'?'bike-cardio.':app+'.'))),[],'every saved key carries its app prefix');
    console.log('PASS four workers, four caches and app-prefixed storage share one origin');

    await context.setOffline(true);
    for(const app of apps){
      await page.goto(origin+'/'+app+'/');
      assert.match(await page.title(),{liftlog:/Liftlog/,'bike-cardio':/Bike|cardio|Zone/i,tabata:/Tabata/,foodlog:/Foodlog/}[app],app+' opens offline');
    }
    await context.setOffline(false);
    console.log('PASS every app opens offline from its own cache');

    const missing=await page.goto(origin+'/nowhere');
    assert.equal(missing.status(),404);assert.deepEqual(await page.locator('a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname)),['/',...apps.map(app=>'/'+app+'/')]);
    console.log('PASS unknown paths show the site 404 page with links home and to each app');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
