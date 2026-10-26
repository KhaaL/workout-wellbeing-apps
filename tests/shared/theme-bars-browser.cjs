const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const themes=['system','light','dark','contrast','lamplight','forest','blossom','ink','iron','dracula','gruvbox','nord','solarized','monokai'],adaptive=['system','contrast','lamplight','forest','blossom','ink','iron'];
(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
 try{
  for(const app of ['liftlog','bike-cardio']){
   const html=fs.readFileSync(path.join(root,'dist',app,'index.html'),'utf8');
   const bootOnly=html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g,(script,attributes)=>attributes.includes('id="theme-bootstrap"')?script:'');
   const csp=require('./site-headers.cjs').csp(app);
   let cold=true;const errors=[];
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://theme.test/**',route=>route.fulfill({contentType:'text/html',body:cold?bootOnly:html,headers:{'Content-Security-Policy':csp}}));
   await page.goto('https://theme.test/');
   const check=async(theme,os,phase)=>{
    const actual=await page.evaluate(()=>{
     const root=document.documentElement,css=getComputedStyle(root),body=getComputedStyle(document.body);
     return {theme:root.dataset.theme||'system',scheme:css.colorScheme,bodyScheme:body.colorScheme,
      canvas:css.backgroundColor,page:body.backgroundColor,surface:css.getPropertyValue('--surface').trim(),
      hint:document.querySelector('meta[name="theme-color"]').content,fullHeight:document.body.getBoundingClientRect().height>=innerHeight};
    });
    const scheme=adaptive.includes(theme)?os:theme==='light'?'light':'dark';
    assert.equal(actual.theme,theme);assert.equal(actual.scheme,scheme,app+' '+phase+' root scheme');assert.equal(actual.bodyScheme,scheme);
    assert.equal(actual.canvas,actual.page,app+' '+phase+' canvas and page match');assert.equal(actual.hint,actual.surface);
    assert.equal(actual.fullHeight,true,app+' paints the full viewport');
    if(scheme==='dark')assert.notEqual(actual.canvas,'rgb(255, 255, 255)',app+' dark launch has no white canvas');
   };
   for(const os of ['light','dark']){
    await page.emulateMedia({colorScheme:os});
    for(const theme of themes){
     await page.evaluate(({app,theme})=>localStorage.setItem(app==='liftlog'?'liftlog.v1':'bike-cardio.ui.theme',app==='liftlog'?JSON.stringify({version:14,settings:{theme},exercises:[],routines:[],workouts:[],activeWorkout:null}):theme),{app,theme});
     cold=true;await page.reload();await check(theme,os,'before app startup');
    }
   }
   cold=false;await page.reload();await page.locator('.nav-btn[data-view="settings"]').click();
   for(const theme of [...themes.slice(1),'system']){
    await page.selectOption('#themeChoice',theme);
    await check(theme,'dark','theme change');
   }
   await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>getComputedStyle(document.documentElement).colorScheme==='light');await check('system','light','OS change');
   // An adaptive theme swaps to its own light palette when the device changes.
   const pick=theme=>page.selectOption('#themeChoice',theme);
   const bg=()=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
   await pick('forest');await check('forest','light','adaptive theme');assert.equal(await bg(),'#f2f4ef');
   await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>getComputedStyle(document.documentElement).colorScheme==='dark');
   await check('forest','dark','adaptive OS change');assert.equal(await bg(),'#121a16');
   assert.deepEqual(errors,[]);await context.close();console.log('PASS '+app+': saved theme before startup, matching canvas/body/browser hints, full viewport and theme/OS changes');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
