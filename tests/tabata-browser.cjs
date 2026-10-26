const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const {confirmAction}=require('./shared/confirm-dialog.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'dist/tabata/index.html'),'utf8');
const csp=require('./shared/site-headers.cjs').csp('tabata');
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  let server,release=1;
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.addInitScript(()=>{
      window.wakeRequests=0;window.wakeReleases=0;window.wakeSentinels=[];
      Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async()=>{
        window.wakeRequests++;const sentinel=new EventTarget();sentinel.released=false;
        sentinel.release=async()=>{sentinel.released=true;window.wakeReleases++;sentinel.dispatchEvent(new Event('release'));};
        window.wakeSentinels.push(sentinel);return sentinel;
      }}});
      localStorage.setItem('liftlog.v1','synthetic-liftlog-data');localStorage.setItem('bike-cardio.state.v1','synthetic-bike-data');localStorage.setItem('bike-cardio.ui.theme','dracula');
    });
    await page.route('https://tabata.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.clock.install({time:new Date('2026-01-01T12:00:00Z')});
    await page.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
    await page.goto('https://tabata.test/');
    assert.equal(await page.locator('#setup h1,#setup .intro').count(),0,'Setup starts directly with timer controls');
    assert.doesNotMatch(await page.locator('#setup').textContent(),/Your next interval|Set your pace|Tabata/);
    assert.deepEqual(await page.locator('.nav-label').allTextContents(),['Timer','Settings'],'Only Timer and Settings appear in navigation');
    assert.equal(await page.locator('#history').count(),0,'History screen is removed');
    assert.equal(await page.locator('[data-source-only]').count(),0,'Built app embeds modules without source-only dependencies');
    assert.equal(await page.inputValue('#work'),'60');assert.equal(await page.inputValue('#rest'),'3');assert.equal(await page.inputValue('#rounds'),'8');
    assert.equal(await page.locator('html').getAttribute('data-theme'),null,'Does not inherit Bike appearance');
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1024,height:768}]){
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Fits '+viewport.width);
      assert.equal(await page.locator('#start').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'Start is visible at '+viewport.width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Increase Work · seconds',exact:true}).click();assert.equal(await page.inputValue('#work'),'65');
    assert.deepEqual(await page.locator('#workPresets button').allTextContents(),['60s','150s','180s']);
    assert.deepEqual(await page.locator('#restPresets button').allTextContents(),['3s','60s','120s']);
    await page.locator('#workPresets').getByRole('button',{name:'150s',exact:true}).click();assert.equal(await page.inputValue('#work'),'150');assert.equal(await page.inputValue('#rest'),'3');
    await page.locator('#restPresets').getByRole('button',{name:'60s',exact:true}).click();assert.equal(await page.inputValue('#rest'),'60');assert.equal(await page.inputValue('#work'),'150');assert.equal(await page.inputValue('#rounds'),'8');
    assert.equal(await page.locator('#workPresets button[aria-pressed=true]').textContent(),'150s');
    await page.fill('#work','0');assert.equal(await page.locator('#start').isDisabled(),true);await page.fill('#work','2');await page.fill('#rest','1');await page.fill('#rounds','2');await page.locator('#rounds').press('Tab');
    await page.screenshot({path:'/tmp/wellbeing-tabata-setup.png'});
    const navigate=async name=>{if(await page.getByRole('button',{name:'Menu',exact:true}).isVisible()){await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('dialog',{name:'Workout menu'}).getByRole('button',{name,exact:true}).click();}else await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();};
    await navigate('Settings');
    await page.fill('#workPreset1','75');await page.fill('#restPreset1','7');await page.getByRole('button',{name:'Save presets',exact:true}).click();
    await page.reload();await navigate('Settings');assert.equal(await page.inputValue('#workPreset1'),'75');assert.equal(await page.inputValue('#restPreset1'),'7');
    await navigate('Timer');assert.equal(await page.locator('#workPresets button').first().textContent(),'75s');assert.equal(await page.locator('#restPresets button').first().textContent(),'7s');
    await navigate('Settings');await page.click('#resetPresets');assert.equal(await page.inputValue('#workPreset1'),'60');assert.equal(await page.inputValue('#restPreset1'),'3');
    await page.fill('#workPreset2','155');await page.getByRole('button',{name:'Save presets',exact:true}).click();
    await page.selectOption('#themeChoice','nord');await page.fill('#prepare','0');await page.locator('#prepare').press('Tab');await page.uncheck('#sound');await navigate('Timer');
    await page.click('#start');await page.waitForFunction(()=>window.wakeRequests===1);
    assert.equal(await page.locator('#phaseName').textContent(),'Work');
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
      await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.locator('#pause').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'Pause remains visible');
      await page.screenshot({path:`/tmp/wellbeing-tabata-active-${viewport.width}.png`});
      assert.equal(await page.locator('#timerPanel').evaluate(node=>node.getBoundingClientRect().bottom<=document.querySelector('#run .workout-actions').getBoundingClientRect().top),true,'Timer readings clear the action bar at '+viewport.width+'×'+viewport.height);
      assert.equal(await page.locator('.wake-row').evaluate(node=>node.getBoundingClientRect().bottom<=document.querySelector('#run .workout-actions').getBoundingClientRect().top),true,'Stay-awake status clears the action bar at '+viewport.width+'×'+viewport.height);
    }
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/wellbeing-tabata-timer.png'});
    await page.clock.fastForward(1000);await page.click('#pause');const paused=await page.locator('#clock').textContent();
    await page.clock.fastForward(10000);assert.equal(await page.locator('#clock').textContent(),paused,'Pause freezes elapsed time');
    await page.click('#pause');await page.clock.fastForward(1100);assert.equal(await page.locator('#phaseName').textContent(),'Rest');
    await page.clock.fastForward(1000);assert.equal(await page.locator('#roundLabel').textContent(),'Round 2 of 2');
    await page.clock.fastForward(2000);assert.equal(await page.locator('#complete').isVisible(),true);
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tabata.state.v1')));
    assert.equal((await saved()).history.length,1);assert.equal((await saved()).history[0].elapsedMs,5000);assert.equal((await saved()).active,null);
    assert.equal(await page.evaluate(()=>window.wakeReleases),1,'Completion releases wake lock');
    await page.click('#editSetup');await page.fill('#work','20');await page.locator('#work').press('Tab');await page.click('#start');
    await page.evaluate(async()=>{await window.wakeSentinels.at(-1).release();});assert.equal(await page.locator('#retryWake').isVisible(),true);
    await page.click('#retryWake');assert.match(await page.locator('#wakeStatus').textContent(),/is on/);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.clock.fastForward(5000);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>document.getElementById('wakeStatus').textContent.includes('is on'));
    await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'nord');assert.equal(await page.locator('#pause').textContent(),'Resume');assert.equal(await page.locator('#recovered').isVisible(),true);
    await page.setViewportSize({width:320,height:568});
    assert.equal(await page.locator('.wake-row').evaluate(node=>node.getBoundingClientRect().bottom<=document.querySelector('#run .workout-actions').getBoundingClientRect().top),true,'Recovered timer and wake status fit on a small phone');
    await page.screenshot({path:'/tmp/wellbeing-tabata-recovered-320.png'});await page.setViewportSize({width:390,height:844});
    const recoveredTime=await page.locator('#clock').textContent();await page.clock.fastForward(5000);assert.equal(await page.locator('#clock').textContent(),recoveredTime);
    await confirmAction(page,()=>page.click('#end'),false);assert.equal(await page.locator('#run').isVisible(),true);
    await confirmAction(page,()=>page.click('#end'));assert.equal((await saved()).history[0].outcome,'ended');
    await navigate('Settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    const downloadEvent=page.waitForEvent('download');await page.click('#exportBackup');const download=await downloadEvent;
    const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.app,'tabata');assert.equal(backup.history.length,2);assert.equal(backup.secretAccessKey,undefined);assert.deepEqual(backup.settings.workPresets,[60,155,180],'Custom presets survive sessions and backup export');
    const restored={...backup,settings:{...backup.settings,rounds:3}};
    await confirmAction(page,()=>page.setInputFiles('#importBackup',{name:'tabata.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(restored))}));
    assert.equal((await saved()).settings.rounds,3);assert.equal(await page.evaluate(()=>localStorage.getItem('tabata.v1.remote-paused')!==null),true);
    assert.equal(await page.locator('#downloadRecovery').isVisible(),true);
    await page.evaluate(()=>{
      window.cloud={objects:{},calls:[]};
      window.fetch=async(url,options={})=>{
        const cloud=window.cloud;cloud.calls.push({url,method:options.method});
        if(options.method==='PUT'){cloud.objects[url]=options.body;return new Response('');}
        if(url.includes('list-type='))return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
        return cloud.objects[url]?new Response(cloud.objects[url],{headers:{etag:'"test"'}}):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
      };
    });
    await page.fill('#cloudEndpoint','https://storage.example.com');await page.fill('#cloudRegion','example');await page.fill('#cloudBucket','example-workouts');await page.fill('#cloudAccess','synthetic-access');await page.fill('#cloudSecret','synthetic-secret');await page.click('#saveCloud');
    await page.waitForFunction(()=>localStorage.getItem('tabata.v1.remote')!==null);
    await confirmAction(page,()=>page.click('#cloudKeepLocal'));
    await page.waitForFunction(()=>Object.keys(window.cloud.objects).length>0);
    assert.equal(await page.evaluate(()=>Object.keys(window.cloud.objects).every(url=>url.includes('tabata-backup.json.snapshots/'))),true,'Cloud snapshots use an independent object path');
    assert.doesNotMatch(JSON.stringify(await saved()),/synthetic-secret|secretAccessKey/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('liftlog.v1')),'synthetic-liftlog-data');assert.equal(await page.evaluate(()=>localStorage.getItem('bike-cardio.state.v1')),'synthetic-bike-data');
    assert.deepEqual(errors,[],'No errors under generated CSP');await context.close();
    // Record Web Audio scheduling, including a suspended context on the first tap.
    const sounds=await browser.newContext({serviceWorkers:'block'}),soundPage=await sounds.newPage();
    const soundErrors=[];soundPage.on('pageerror',error=>soundErrors.push(error.message));
    await sounds.addInitScript(()=>{
      window.tones=[];window.bells=[];
      window.AudioContext=class {
        constructor(){this.state='suspended';this.currentTime=0;this.destination={};}
        resume(){return new Promise(resolve=>{window.resumeAudio=()=>{this.state='running';resolve();};});}
        decodeAudioData(bytes){window.sampleBytes=bytes.byteLength;return Promise.resolve({duration:3});}
        createBufferSource(){const bell={};let timer;const source={connect(){},disconnect(){},start(at){bell.at=at;window.bells.push(bell);timer=setTimeout(()=>source.onended?.(),(at+3)*1000);},stop(){clearTimeout(timer);source.onended?.();}};return source;}
        createOscillator(){const tone={};return {frequency:{set value(value){tone.frequency=value;}},connect(){},disconnect(){},start(at){tone.at=at;window.tones.push(tone);},stop(at){tone.end=at;}};}
        createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
      };
      localStorage.setItem('tabata.state.v1',JSON.stringify({app:'tabata',version:1,updatedAt:0,settings:{work:4,rest:3,rounds:2,prepare:1,sound:true,keepAwake:false},history:[],active:null}));
    });
    await soundPage.route('https://sound.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await soundPage.clock.install({time:new Date('2026-01-01T12:00:00Z')});await soundPage.clock.pauseAt(new Date('2026-01-01T12:00:01Z'));
    await soundPage.goto('https://sound.test/');await soundPage.click('#start');assert.equal(await soundPage.evaluate(()=>window.tones.length),0);
    await soundPage.evaluate(()=>window.resumeAudio());assert.deepEqual(await soundPage.evaluate(()=>window.tones.map(t=>t.frequency)),[660],'Preparation cue waits for audio resume');
    await soundPage.clock.fastForward(1000);
    assert.equal(await soundPage.evaluate(()=>window.bells.length),1,'Work uses one recorded bell strike');
    assert.equal(await soundPage.evaluate(()=>window.bells.at(-1).at),0);
    assert.ok(await soundPage.evaluate(()=>window.sampleBytes)>10000,'A recorded audio sample is decoded');
    await soundPage.clock.fastForward(1000);assert.equal(await soundPage.evaluate(()=>window.tones.at(-1).frequency),660,'Countdown tick');
    const beforePause=await soundPage.evaluate(()=>({ticks:window.tones.length,bells:window.bells.length}));await soundPage.click('#pause');await soundPage.clock.fastForward(5000);assert.deepEqual(await soundPage.evaluate(()=>({ticks:window.tones.length,bells:window.bells.length})),beforePause,'No cues while paused');
    await soundPage.click('#pause');await soundPage.evaluate(()=>window.resumeAudio());await soundPage.clock.fastForward(3000);
    assert.equal(await soundPage.evaluate(()=>window.bells.length),4,'Resume rings once and rest rings twice');
    assert.deepEqual(await soundPage.evaluate(()=>window.bells.slice(-2).map(b=>b.at)),[0,.18],'Double bell uses a rapid 180 ms gap');
    await soundPage.clock.fastForward(3000);assert.equal(await soundPage.evaluate(()=>window.bells.length),5,'Work resumes with one recorded strike');
    await soundPage.clock.fastForward(4000);assert.equal(await soundPage.evaluate(()=>window.bells.length),8,'Completion rings the recorded bell three times');
    assert.deepEqual(await soundPage.evaluate(()=>window.bells.slice(-3).map(b=>b.at)),[0,.18,.36],'Triple bell completes its strikes within 360 ms');
    await soundPage.click('#again');await soundPage.evaluate(()=>window.resumeAudio());await confirmAction(soundPage,()=>soundPage.click('#end'));
    assert.equal(await soundPage.evaluate(()=>window.bells.length),11,'Stopping early also rings the recorded bell three times');
    await soundPage.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
    await soundPage.click('#testBell');await soundPage.evaluate(()=>window.resumeAudio());
    assert.equal(await soundPage.evaluate(()=>window.bells.length),12,'Test bell plays without starting a workout');
    assert.match(await soundPage.locator('#bellTestStatus').textContent(),/recorded boxing bell/);
    await soundPage.clock.fastForward(3000);assert.equal(await soundPage.locator('#testBell').isEnabled(),true);
    assert.deepEqual(soundErrors,[]);await sounds.close();
    // A denied lock or unavailable audio must leave a usable timer and clear feedback.
    const fallback=await browser.newContext({serviceWorkers:'block'}),fallbackPage=await fallback.newPage();
    await fallback.addInitScript(()=>{
      Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:async()=>{throw new Error('Denied');}}});
      window.AudioContext=class {constructor(){throw new Error('Audio unavailable');}};
    });
    await fallbackPage.route('https://fallback.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await fallbackPage.goto('https://fallback.test/');await fallbackPage.click('#start');
    await fallbackPage.waitForFunction(()=>document.getElementById('wakeStatus').textContent.includes('unavailable'));
    assert.equal(await fallbackPage.locator('#retryWake').isVisible(),true);
    assert.match(await fallbackPage.locator('#audioStatus').textContent(),/Sound unavailable/);
    await confirmAction(fallbackPage,()=>fallbackPage.click('#end'));
    await fallbackPage.evaluate(()=>Object.defineProperty(navigator,'wakeLock',{value:undefined,configurable:true}));
    await fallbackPage.click('#again');assert.match(await fallbackPage.locator('#wakeStatus').textContent(),/auto-lock/);
    assert.equal(await fallbackPage.locator('#retryWake').isHidden(),true);await fallback.close();
    // A pending request resolving after the timer ends must be released immediately.
    const pending=await browser.newContext({serviceWorkers:'block'}),pendingPage=await pending.newPage();
    await pending.addInitScript(()=>{
      window.pendingReleased=false;
      Object.defineProperty(navigator,'wakeLock',{value:{request:()=>new Promise(resolve=>{window.resolveWake=resolve;})}});
    });
    await pendingPage.route('https://pending.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await pendingPage.goto('https://pending.test/');await pendingPage.click('#start');await confirmAction(pendingPage,()=>pendingPage.click('#end'));
    await pendingPage.evaluate(()=>{const sentinel=new EventTarget();sentinel.release=async()=>{window.pendingReleased=true;};window.resolveWake(sentinel);});
    await pendingPage.waitForFunction(()=>window.pendingReleased);await pending.close();
    // Real service worker installation and offline navigation, with no cloud mock.
    server=http.createServer((req,res)=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      const sourceRequest=pathname.startsWith('/apps/tabata/')||pathname.startsWith('/packages/');
      const directory=sourceRequest?root:path.join(root,'dist');
      const filename=path.join(directory,pathname.endsWith('/')?pathname+'index.html':pathname);
      if(!filename.startsWith(directory+path.sep)){res.writeHead(404);res.end();return;}
      try{let body=fs.readFileSync(filename);
        if(!sourceRequest&&filename.endsWith('index.html'))body=Buffer.from(body.toString().replace(/(<meta name="app-version" content=")[^"]+/, '$1tabata-audit-'+release));
        if(!sourceRequest&&filename.endsWith('service-worker.js'))body=Buffer.from(body.toString().replace(/const CACHE = '[^']+';/,`const CACHE = 'tabata-shell-audit-${release}';`));
        res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.webmanifest')?'application/manifest+json':filename.endsWith('.png')?'image/png':filename.endsWith('.svg')?'image/svg+xml':'text/html',...sourceRequest?{}:{'Content-Security-Policy':csp}});res.end(body);}catch(error){res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    // Opening the source directly must initialize the same controls and shared styles.
    for(const url of [`http://127.0.0.1:${server.address().port}/apps/tabata/`,pathToFileURL(path.join(root,'apps/tabata/index.html')).href]){
      const source=await browser.newContext({viewport:{width:390,height:844}}),sourcePage=await source.newPage(),sourceErrors=[];
      sourcePage.on('pageerror',error=>sourceErrors.push(error.message));await sourcePage.goto(url);
      assert.equal(await sourcePage.inputValue('#work'),'60');assert.equal(await sourcePage.inputValue('#rest'),'3');assert.equal(await sourcePage.inputValue('#rounds'),'8');
      assert.deepEqual(await sourcePage.locator('.nav-label').allTextContents(),['Timer','Settings']);
      assert.equal(await sourcePage.locator('#workPresets button,#restPresets button').count(),6);
      assert.equal(await sourcePage.locator('#setup .numeric-stepper').count(),3);
      assert.match(await sourcePage.locator('body').evaluate(node=>getComputedStyle(node).fontFamily),/sans-serif/,'Source has the shared typeface');
      assert.notEqual(await sourcePage.locator('#totalTime').textContent(),'—');
      await sourcePage.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();await sourcePage.uncheck('#sound');
      await sourcePage.getByRole('navigation').getByRole('button',{name:'Timer',exact:true}).click();
      await sourcePage.screenshot({path:url.startsWith('file:')?'/tmp/wellbeing-tabata-source-file.png':'/tmp/wellbeing-tabata-source-http.png'});
      await sourcePage.click('#start');assert.equal(await sourcePage.locator('#run').isVisible(),true,'Direct source preview starts the timer');
      if(url.startsWith('http:'))assert.equal(await sourcePage.evaluate(async()=>navigator.serviceWorker?(await navigator.serviceWorker.getRegistrations()).length:0),0,'Source preview does not cache an incomplete offline shell');
      assert.deepEqual(sourceErrors,[],'Source preview has no initialization errors');await source.close();
    }
    const offline=await browser.newContext(),offlinePage=await offline.newPage();
    await offlinePage.goto(`http://127.0.0.1:${server.address().port}/tabata/`);
    const audioQuality=await offlinePage.evaluate(async()=>{
      const context=new OfflineAudioContext(1,44100*4,44100),bytes=Uint8Array.from(atob(TabataBellAudio),character=>character.charCodeAt(0));
      const buffer=await context.decodeAudioData(bytes.buffer);
      for(let i=0;i<3;i++){const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=.6;source.connect(gain);gain.connect(context.destination);source.start(i*.18);}
      const rendered=await context.startRendering(),samples=rendered.getChannelData(0);let peak=0,sum=0;
      for(const sample of samples){peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;}
      return {duration:buffer.duration,peak,rms:Math.sqrt(sum/samples.length)};
    });
    assert.ok(audioQuality.duration>2.9&&audioQuality.duration<3.2,'Real bell recording decodes');
    assert.ok(audioQuality.peak<1&&audioQuality.rms>.03,'Recorded triple bell is audible and does not clip');

    await offlinePage.evaluate(async()=>{await navigator.serviceWorker.ready;});await offlinePage.reload();
    await offline.setOffline(true);await offlinePage.reload();assert.equal(await offlinePage.locator('#start').isVisible(),true,'Offline shell starts');
    assert.ok(await offlinePage.evaluate(()=>TabataBellAudio.length)>10000,'Recording is bundled offline');
    await offlinePage.click('#start');assert.equal(await offlinePage.locator('#run').isVisible(),true,'Timer works offline');
    assert.equal(await offlinePage.evaluate(async()=>{const keys=await caches.keys();return keys.every(key=>key.startsWith('tabata-shell-'));}),true,'Independent offline cache');
    // An update waits through a saved session, then preserves data and replaces the offline shell.
    await offline.setOffline(false);release=2;
    await offlinePage.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
    await offlinePage.getByText('App updates',{exact:true}).click();await offlinePage.click('#checkAppUpdate');
    await offlinePage.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    assert.equal(await offlinePage.locator('#applyAppUpdate').isDisabled(),true,'Updates wait while a timer is active');
    assert.equal(await offlinePage.locator('meta[name="app-version"]').getAttribute('content'),'tabata-audit-1','Active timer retains its loaded version');
    await offlinePage.getByRole('navigation').getByRole('button',{name:'Timer',exact:true}).click();
    await confirmAction(offlinePage,()=>offlinePage.click('#end'));
    await offlinePage.getByRole('navigation').getByRole('button',{name:'Settings',exact:true}).click();
    await offlinePage.waitForFunction(()=>!document.getElementById('applyAppUpdate').disabled);
    const beforeUpdate=await offlinePage.evaluate(()=>localStorage.getItem('tabata.state.v1'));
    await offlinePage.click('#applyAppUpdate');await offlinePage.waitForFunction(()=>document.querySelector('meta[name="app-version"]').content==='tabata-audit-2');
    assert.equal(await offlinePage.evaluate(()=>localStorage.getItem('tabata.state.v1')),beforeUpdate,'Update preserves saved settings and history');
    await offline.setOffline(true);await offlinePage.reload();
    assert.equal(await offlinePage.locator('meta[name="app-version"]').getAttribute('content'),'tabata-audit-2','Offline launch uses the updated app');
    assert.equal(await offlinePage.locator('#setup h1,#setup .intro').count(),0);
    await offline.close();
    console.log('PASS Tabata browser: mobile touch layout, timing, wake locks, recovery, backups, data isolation, CSP, offline use, safe updates and direct source previews');
  }finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
