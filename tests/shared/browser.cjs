const {confirmAction}=require('./confirm-dialog.cjs');
const {navigate: navigateUI}=require('./ui-navigation.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8');
const csp=fs.readFileSync(path.join(root,'dist/bike-cardio/_headers'),'utf8').match(/Content-Security-Policy: (.*)/)[1];
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'block',timezoneId:'Europe/Stockholm'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('https://bike.test/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
    await page.addInitScript(()=>{let granted=false;window.persistenceCalls=0;Object.defineProperty(navigator,'storage',{configurable:true,value:{persisted:async()=>granted,persist:async()=>{window.persistenceCalls++;granted=true;return true;},estimate:async()=>({usage:1024,quota:1048576})}});if(!localStorage.getItem('bike-cardio.state.v1')&&!localStorage.getItem('bike-cardio.history.v1'))localStorage.setItem('bike-cardio.history.v1',JSON.stringify([{id:'legacy',startedAt:1720000000123,endedAt:1720001980123,config:{mode:'zone2',bike:'touchscreen'},activeMs:1980000,mainMs:1500000,outcome:'complete',effortsCompleted:0,metrics:{averageHR:'128',averageWatts:'140',notes:'original'}}]));});
    await page.goto('https://bike.test/');
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')));
    assert.equal((await saved()).history.length,1);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.history.v1'))[0].id),'legacy');
    await navigateUI(page,'history');await page.click('.history-item');await page.fill('#mainAverageHR','115.5');await page.fill('#fixedHRWatts','145');
    assert.equal((await saved()).history[0].metrics.mainAverageHR,'115.5');assert.equal((await saved()).history[0].metrics.averageHR,'128');
    await page.click('#editSession');await page.fill('#editBikeId','cancelled');await page.click('#cancelEdit');assert.equal((await saved()).history[0].config.bikeId,'');
    await page.click('#editSession');await page.fill('#editBikeId','window');await page.locator('#editForm button[type=submit]').click();assert.equal((await saved()).history[0].config.bikeId,'window');
    assert.equal((await saved()).history[0].startedAt,1720000000123);
    await page.click('#summaryHistory');assert.match(await page.locator('#historyList').textContent(),/140 W main-block average at 115.5 bpm/);assert.equal(await page.locator('#progressChart circle').count(),1);assert.match(await page.locator('#chartTable').textContent(),/105–122 \/ 115/);
    await page.click('#historyBack');await page.click('#again');
    await navigateUI(page,'settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    const downloadWait=page.waitForEvent('download');await page.click('#exportBackup');const download=await downloadWait;
    const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.history[0].metrics.mainAverageHR,'115.5');assert.equal(backup.app,'bike-cardio');assert.match(await page.locator('#backupAge').textContent(),/downloaded file/);assert.match(await page.locator('#storageDiagnostics').textContent(),/Ride data:/);
    await page.locator('summary').filter({hasText:'Device storage'}).click();await page.click('#requestPersistence');await page.waitForFunction(()=>document.getElementById('storageDiagnostics').textContent.includes('Persistent storage granted'));assert.equal(await page.evaluate(()=>window.persistenceCalls),1);
    const restored=structuredClone(backup);restored.history[0].metrics.notes='restored';await confirmAction(page,()=>page.setInputFiles('#importBackup',{name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(restored))}));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history[0].metrics.notes==='restored');
    assert.equal(await page.locator('#downloadRecovery').isVisible(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote-paused')!==null),true);
    await page.reload();assert.equal((await saved()).history[0].metrics.notes,'restored');
    await navigateUI(page,'settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    await page.evaluate(()=>{
      window.fakeCloud={cloud:null,calls:[],etag:'"1"'};
      window.fetch=async(url,options={})=>{const s=window.fakeCloud;s.calls.push({url,method:options.method,headers:options.headers});
        if(options.method==='GET')return s.cloud?new Response(JSON.stringify(s.cloud),{headers:{etag:s.etag}}):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
        if(url.includes('.snapshots/'))return new Response('');
        if(!(options.headers['if-none-match']==='*'||options.headers['if-match']===s.etag))return new Response('',{status:412});
        s.cloud=JSON.parse(options.body);s.etag='"2"';return new Response('');};
    });
    await page.fill('#cloudEndpoint','https://storage.test');await page.fill('#cloudRegion','test');await page.fill('#cloudBucket','test');await page.fill('#cloudAccess','fake');await page.fill('#cloudSecret','synthetic');await page.selectOption('#cloudMode','conditional');await page.click('#saveCloud');
    await page.waitForFunction(()=>localStorage.getItem('bike-cardio.v1.remote')!==null);
    // Configuration export excludes the secret by default and loading never applies it.
    const configDownloadWait=page.waitForEvent('download');await page.click('#exportCloudConfig');await page.click('#exportConfigSafe');
    const configDownload=await configDownloadWait,connection=JSON.parse(fs.readFileSync(await configDownload.path(),'utf8'));
    assert.equal(connection.kind,'remote-config');assert.equal(connection.secretAccessKey,undefined);
    const secretDownloadWait=page.waitForEvent('download');await page.click('#exportCloudConfig');await confirmAction(page,()=>page.click('#exportConfigSecret'));const secretDownload=await secretDownloadWait;assert.equal(JSON.parse(fs.readFileSync(await secretDownload.path(),'utf8')).secretAccessKey,'synthetic');
    const savedConnection=await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote'));
    await page.setInputFiles('#importCloudConfig',{name:'connection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...connection,bucket:'another-bucket'}))});
    await page.waitForFunction(()=>document.getElementById('cloudBucket').value==='another-bucket');
    assert.equal(await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote')),savedConnection);
    assert.match(await page.locator('#cloudConfigStatus').textContent(),/review/);
    await page.click('#cloudTest');await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('write permission unverified'));
    assert.equal(await page.evaluate(()=>window.fakeCloud.calls.some(c=>c.method==='PUT')),false);
    assert.match(await page.locator('#cloudDetails').textContent(),/Bucket: test/);
    // Import deliberately keeps sync paused. Explicit publication resumes it.
    await confirmAction(page,()=>page.click('#cloudKeepLocal'));await page.waitForFunction(()=>window.fakeCloud.cloud!==null);
    assert.equal(await page.evaluate(()=>window.fakeCloud.cloud.history[0].metrics.notes),'restored');
    assert.equal(await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote-paused')),null);
    const json=JSON.stringify(await saved());assert.doesNotMatch(json,/synthetic|secretAccessKey/);
    await confirmAction(page,()=>page.click('#cloudForget'),false);assert.notEqual(await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote')),null);
    await confirmAction(page,()=>page.click('#cloudForget'));
    await page.waitForFunction(()=>localStorage.getItem('bike-cardio.v1.remote')===null&&document.getElementById('cloudConfigStatus').textContent==='Connection forgotten.');
    assert.equal(await page.evaluate(()=>localStorage.getItem('bike-cardio.v1.remote')),null);
    await navigateUI(page,'settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    await page.evaluate(()=>localStorage.setItem('bike-cardio.v1.last-file-backup',String(Date.now()-15*86400000)));
    for(const mode of ['zone2','sprint']){
      await navigateUI(page,'settings');await page.uncheck('#voice');await page.uncheck('#beeps');await navigateUI(page,'setup');await page.check(`input[name=mode][value=${mode}]`);await page.click('#start');
      const length=await page.evaluate(mode=>WorkoutCore.build({mode}).length,mode);
      for(let i=0;i<length;i++){
        assert.equal(await page.locator('#skip').isEnabled(),true);
        if(await page.locator('#phaseTitle').textContent()==='Zone 2')assert.notEqual(await page.locator('#lowHR').evaluate(e=>getComputedStyle(e).backgroundColor),await page.locator('#highHR').evaluate(e=>getComputedStyle(e).backgroundColor));
        await page.click('#skip');await page.click('#confirmSkip');
      }
      if(mode==='zone2')assert.match(await page.locator('#toast').textContent(),/backup needs refreshing/);
      assert.equal((await saved()).history[0].phases.length,length);assert.equal((await saved()).active,null);await page.click('#again');
    }
    // Recovery restore and separate unreadable data remain accessible.
    await navigateUI(page,'settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    assert.equal(await page.locator('#restoreRecovery').isVisible(),true);
    await confirmAction(page,()=>page.click('#restoreRecovery'));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===1);
    await page.evaluate(()=>localStorage.setItem('bike-cardio.v1.unreadable','{broken'));
    await page.reload();await navigateUI(page,'settings');await page.locator('summary').filter({hasText:'Backups & cloud storage'}).click();
    assert.equal(await page.locator('#downloadUnreadable').isVisible(),true);assert.equal(await page.locator('#downloadRecovery').isVisible(),true);
    // History merge reports duplicates/conflicts and clearing preserves settings and recovery.
    await navigateUI(page,'history');
    const merge=structuredClone(backup);merge.kind='history';merge.history=[backup.history[0],{...backup.history[0],id:'imported'},{...backup.history[0],metrics:{...backup.history[0].metrics,notes:'conflicting'}}];
    await confirmAction(page,()=>page.setInputFiles('#importHistory',{name:'history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(merge))}));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===2);
    assert.match(await page.locator('#historyImportStatus').textContent(),/1 added/);assert.match(await page.locator('#historyImportStatus').textContent(),/1 conflicts/);
    const settingsBeforeClear=(await saved()).settings;
    await confirmAction(page,()=>page.click('#clearHistory'),false);assert.equal((await saved()).history.length,2);
    await confirmAction(page,()=>page.click('#clearHistory'));await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===0);
    assert.deepEqual((await saved()).settings,settingsBeforeClear);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('bike-cardio.v1.before-remote-restore')).history.length),2);
    await page.click('#historyBack');
    // Targets drive the next ride while the imported old ride keeps its defaults.
    await page.check('input[name=mode][value=zone2]');await page.locator('#rideAdjustments > summary').click();
    await page.fill('#zoneMin','120');await page.fill('#zoneMax','140');await page.fill('#targetMin','125');await page.fill('#targetMax','135');await page.fill('#adjustBelow','123');await page.fill('#comparisonHR','130');await page.fill('#warmupMinutes','7');await page.fill('#mainMinutes','40');await page.locator('#mainMinutes').press('Tab');
    assert.equal(await page.locator('#start').isEnabled(),true);assert.match(await page.locator('#plan').textContent(),/40 min/);assert.equal((await saved()).settings.targets.comparisonHR,115);
    await page.fill('#comparisonHR','150');await page.locator('#comparisonHR').press('Tab');assert.equal(await page.locator('#start').isDisabled(),true);
    await page.fill('#comparisonHR','130');await page.locator('#comparisonHR').press('Tab');await page.click('#start');
    assert.equal(await page.locator('#targetHR').textContent(),'Under ~130');await page.click('#skip');await page.click('#confirmSkip');assert.equal(await page.locator('#targetHR').textContent(),'125–135');assert.match(await page.locator('#lowHR').textContent(),/Below 123/);
    await page.click('#skip');await page.click('#confirmSkip');assert.equal(await page.locator('#targetHR').textContent(),'Below 120');await page.click('#skip');await page.click('#confirmSkip');
    await page.fill('#fixedHRWatts','180');assert.equal((await saved()).history[0].config.targets.comparisonHR,130);assert.match(await page.locator('#comparisonLabel').textContent(),/130/);
    await page.click('#summaryHistory');await confirmAction(page,()=>page.setInputFiles('#importHistory',{name:'older-rides.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,kind:'history'}))}));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bike-cardio.state.v1')).history.length===2);
    assert.equal((await saved()).history.find(r=>r.id==='legacy').config.targets.comparisonHR,115);assert.equal(await page.locator('#progressChart circle').count(),2);assert.equal(await page.locator('#progressChart line[stroke-width="2"]').count(),0);
    await page.selectOption('#historyMode','sprint');assert.match(await page.locator('#historyCount').textContent(),/0 of 2/);await page.click('#resetHistoryFilters');assert.match(await page.locator('#historyCount').textContent(),/2 of 2/);
    await page.fill('#historyFrom','2099-01-01');await page.locator('#historyFrom').press('Tab');assert.equal(await page.locator('.history-item').count(),0);await page.click('#resetHistoryFilters');
    await page.setViewportSize({width:320,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/tmp/bike-cardio-shared-storage.png',fullPage:true});assert.deepEqual(errors,[]);
    console.log('PASS Bike browser: production CSP, migration, configuration transfer, read-only connection test, persistence, backup reminders, recovery, history merge/clear, cloud publication, phase skipping and mobile layout.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
