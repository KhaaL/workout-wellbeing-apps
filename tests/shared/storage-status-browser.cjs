const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {appWithTestAPI}=require('../../apps/liftlog/tests/harness.cjs');
const {navigate}=require('./ui-navigation.cjs');
const root=path.resolve(__dirname,'../..');
const config={endpoint:'https://storage.test',region:'test',bucket:'test',objectKey:'backup.json',accessKeyId:'fake',secretAccessKey:'synthetic',pathStyle:true,syncMode:'immutable'};
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    for(const app of ['liftlog','bike-cardio']){
      const lift=app==='liftlog';
      const api=lift?'{remote:remoteEngine,local:localStore,refresh:renderStorageStatus,change(){state.settings.defaultRest++;save({immediate:true,remote:false});}}':'{remote:storage.remote,local:storage.local,refresh:renderStorageStatus,change(){storage.state.settings.voice=!storage.state.settings.voice;storage.local.save({immediate:true,remote:false});}}';
      const html=lift?appWithTestAPI(api):fs.readFileSync(path.join(root,'dist',app,'index.html'),'utf8').replace('  appUpdates.refresh();updateShell();','  window.testAPI='+api+';\n  appUpdates.refresh();updateShell();');
      const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],objects=new Map();let calls=0,denied=false;
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('https://app.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
      await page.route('https://storage.test/**',async route=>{
        const request=route.request(),url=request.url();
        const headers={'access-control-allow-origin':'https://app.test','access-control-expose-headers':'etag',etag:'\"1\"'};
        if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:{...headers,'access-control-allow-methods':'GET, PUT, DELETE','access-control-allow-headers':request.headers()['access-control-request-headers']||'*'}});
        calls++;
        if(denied)return route.fulfill({status:403,headers,contentType:'application/xml',body:'<Error><Code>InvalidAccessKeyId</Code><Message>synthetic</Message></Error>'});
        if(request.method()==='PUT'){objects.set(url,request.postData());return route.fulfill({status:200,headers});}
        if(objects.has(url))return route.fulfill({status:200,headers,contentType:'application/json',body:objects.get(url)});
        return route.fulfill({status:404,headers,contentType:'application/xml',body:'<Error><Code>NoSuchKey</Code></Error>'});
      });
      await page.goto('https://app.test/'+app);await navigate(page,'settings');
      const status=page.locator('#storage-summary'),options=page.locator(lift?'[data-settings-section="storage"]':'#storage-options');
      const expectState=async state=>{try{await page.waitForFunction(state=>document.querySelector('#storage-summary').dataset.state===state,state,{timeout:10000});}catch(error){throw Error(app+' expected '+state+'; '+await status.textContent()+'; '+JSON.stringify(errors));}};
      await expectState('local');assert.equal(await options.evaluate(node=>node.open),false);
      // Before setup the banner offers setup only; a second button to the same section is noise.
      assert.doesNotMatch(await status.textContent(),/No verified cloud backup yet/);assert.equal(await status.locator('[data-storage-action="details"]').count(),0);
      await status.getByRole('button',{name:'Set up cloud backup',exact:true}).click();
      const endpoint=page.locator(lift?'[data-field="endpoint"]':'#cloudEndpoint');await endpoint.fill('https://draft.test');
      await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
      assert.equal(await endpoint.inputValue(),'https://draft.test');assert.equal(await endpoint.evaluate(node=>node===document.activeElement),true,'status updates preserve config input focus');
      await page.evaluate(cfg=>{testAPI.remote.saveRemoteConfig(cfg);testAPI.refresh();},config);await expectState('pending');
      await status.getByRole('button',{name:'Back up now',exact:true}).click();await expectState('backed-up');
      assert.match(await status.textContent(),/Last verified cloud backup:/);assert(calls>=2,'backup is uploaded and read back');
      if(lift){
        // Liftlog: the banner is the only status; Cloud backup keeps 4 buttons in view and repeats the banner title.
        await options.evaluate(node=>{node.open=true;});
        assert.equal(await page.locator('#remote-status').count(),0);
        assert.equal(await options.locator('> summary small').textContent(),'Backed up');
        assert.equal(await options.locator('> .setting-block').first().locator('button:visible').count(),4);
        assert.equal(await options.getByRole('button',{name:'Restore legacy backup locally…',exact:true}).count(),1);
        assert.equal(await page.locator('[data-settings-section="cloud-troubleshooting"]').evaluate(node=>node.open),false);
        assert.deepEqual(await page.locator('[data-field="syncMode"] option').evaluateAll(nodes=>nodes.map(node=>node.value)),['immutable','conditional']);
        assert.doesNotMatch(await page.locator('section[aria-label="Data"]').textContent(),/MinIO|\bR2\b|amazonaws/);
        assert.equal(await page.locator('[data-settings-section="handoff"]').evaluate(node=>node.open),false,'handoff stays collapsed without a workout');
        assert.equal(await status.getByRole('button',{name:'Cloud backup settings',exact:true}).count(),1);
      }
      await page.evaluate(()=>{testAPI.remote.pauseRemoteSync('review',{code:'import'});testAPI.refresh();});await expectState('paused');
      assert.match(await status.textContent(),/Cloud backups paused.*Paused when you chose a backup file to restore\..*Paused \d/);
      const before=calls;await status.getByRole('button',{name:'Back up & resume…',exact:true}).click();
      await page.getByRole('button',{name:'Back up & resume',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
      assert.equal(calls,before,'cancelling the resume confirmation does not upload or replace data');assert.equal(await page.evaluate(()=>testAPI.remote.remoteSyncPaused()),true);
      assert.equal(await page.evaluate(()=>testAPI.remote.remotePauseInfo().code),'import','the confirmation keeps the cause shown before it opened');
      await page.evaluate(key=>{localStorage.removeItem(key);window.dispatchEvent(new Event('storage'));},lift?'liftlog.v1.remote-paused':'bike-cardio.v1.remote-paused');
      await context.setOffline(true);await expectState('offline');
      await context.setOffline(false);await expectState('backed-up');
      denied=true;await page.evaluate(()=>{testAPI.change();testAPI.refresh();});await expectState('pending');
      await status.getByRole('button',{name:'Back up now',exact:true}).click();await expectState('attention');
      await status.getByRole('button',{name:'Review connection',exact:true}).click();assert.equal(await endpoint.isVisible(),true);
      await page.evaluate(()=>{
        window.originalSetItem=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='liftlog.v1'||key==='bike-cardio.state.v1')throw new DOMException('Full','QuotaExceededError');return window.originalSetItem.call(this,key,value);};
        testAPI.change();testAPI.refresh();
      });await expectState('attention');assert.match(await status.textContent(),/only be in memory/);
      assert.equal(await status.getByRole('button',{name:'Download backup',exact:true}).isVisible(),true);
      for(const width of [320,390,1440]){
        await page.setViewportSize({width,height:844});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,app+' storage fits '+width);
        assert.equal(await status.locator('button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=48)),true);
      }
      await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;testAPI.local.flush();testAPI.remote.pauseRemoteSync('review');testAPI.refresh();});
      await page.evaluate(()=>{const options=document.querySelector('#storage-options,[data-settings-section="storage"]');options.open=false;window.scrollTo(0,0);});
      await status.screenshot({path:'/tmp/wellbeing-'+app+'-storage.png',animations:'disabled'});
      assert.deepEqual(errors,[]);await context.close();
      console.log('PASS '+app+': storage summary, verified backup, pause/review, offline, errors, local failure, draft preservation and responsive layout');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
