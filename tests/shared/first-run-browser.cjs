// First run with a saved cloud connection, in every app: a device with only its starting data never
// uploads it. With separate backup files it offers the cloud backups that already exist; with
// conditional sync it takes the cloud copy, and a device with data pauses for a choice.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=require('./site-server.cjs');
const {confirmAction}=require('./confirm-dialog.cjs');
const SHARED='wellbeing.connection.v1',APPS=['liftlog','bike-cardio','tabata','foodlog'];
const connection=syncMode=>({endpoint:'https://storage.test',region:'test',bucket:'apps',accessKeyId:'fake',secretAccessKey:'synthetic',pathStyle:true,syncMode});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const server=await site.start(),origin=server.origin;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  // One synthetic bucket shared by every device: create-only uploads, listings and versioned reads.
  const objects=new Map();
  async function device(syncMode){
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),puts=[],errors=[];
    await context.addInitScript(([key,value])=>{if(!localStorage.getItem(key))localStorage.setItem(key,value);},[SHARED,JSON.stringify(connection(syncMode))]);
    await context.route('https://storage.test/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, DELETE','Access-Control-Allow-Headers':'authorization, content-type, x-amz-content-sha256, x-amz-date, if-match, if-none-match','Access-Control-Expose-Headers':'ETag'};
      if(method==='OPTIONS')return route.fulfill({status:200,headers:cors,body:''});
      const [bucket,...rest]=decodeURIComponent(url.pathname).split('/').slice(1),id=bucket+'/'+rest.join('/');
      if(url.searchParams.get('list-type')==='2'){
        const prefix=bucket+'/'+url.searchParams.get('prefix'),rows=[...objects.keys()].filter(k=>k.startsWith(prefix)).map(k=>`<Contents><Key>${k.slice(bucket.length+1)}</Key><LastModified>2026-01-01T00:00:00Z</LastModified><Size>10</Size></Contents>`).join('');
        return route.fulfill({status:200,headers:cors,body:`<ListBucketResult><IsTruncated>false</IsTruncated>${rows}</ListBucketResult>`});
      }
      if(method==='GET')return objects.has(id)?route.fulfill({status:200,headers:{...cors,ETag:'"1"'},body:objects.get(id)}):route.fulfill({status:404,headers:cors,body:'<Error><Code>NoSuchKey</Code></Error>'});
      if(method==='PUT'){if(objects.has(id)&&request.headers()['if-none-match']==='*')return route.fulfill({status:412,headers:cors,body:'<Error><Code>PreconditionFailed</Code></Error>'});objects.set(id,request.postData());puts.push(id);return route.fulfill({status:200,headers:{...cors,ETag:'"1"'},body:''});}
      return route.fulfill({status:405,headers:cors,body:''});
    });
    const open=async app=>{const page=await context.newPage();page.on('pageerror',error=>errors.push(app+': '+error.message));await page.goto(origin+'/'+app+'/');return page;};
    return {context,puts,errors,open};
  }
  const dialogTitle=page=>page.locator('#dlg[open] #dlg-title');
  try{
    /* Separate backup files, empty cloud: nothing is uploaded and nothing is asked. */
    const empty=await device('immutable');
    for(const app of APPS){const page=await empty.open(app);await wait(4500);assert.equal(await page.locator('#dlg[open]').count(),0,app+' asks nothing when the cloud is empty');}
    assert.deepEqual(empty.puts,[],'no app uploads its starting data: '+empty.puts.join(', '));
    console.log('PASS separate files, empty cloud: no app uploads its starting data or asks anything');

    /* Another device backs up each app explicitly with Back up now. */
    for(const app of APPS){
      const page=await empty.open(app);await page.locator('.nav-btn[data-view="settings"]').first().click();
      await page.click('text=Backups & cloud storage');await page.click('#cloudBackup');
      await page.waitForFunction(()=>/Backed up|saved/i.test(document.body.textContent));
    }
    for(const app of APPS)assert.ok(empty.puts.some(k=>k.startsWith('apps/'+app+'-backup.json.snapshots/')),app+' has a cloud backup: '+empty.puts.join(', '));
    await empty.context.close();

    /* Separate backup files, cloud has backups: a fresh device is asked and uploads nothing until it chooses. */
    const fresh=await device('immutable');
    const pages={};
    for(const app of APPS){
      pages[app]=await fresh.open(app);
      await dialogTitle(pages[app]).waitFor({timeout:10000});
      assert.equal(await dialogTitle(pages[app]).textContent(),'Cloud backups found');
      assert.match(await pages[app].locator('#dlg-body').textContent(),/The cloud holds 1 backup file for this app\. .*This device has only its starting data\./);
      assert.deepEqual(await pages[app].locator('#dlg-actions button').allTextContents(),['Start fresh on this device','Browse backups','Restore latest…']);
    }
    assert.deepEqual(fresh.puts,[],'a fresh device uploads nothing while it is asked');
    console.log('PASS separate files, cloud has backups: every app offers them and uploads nothing');

    // Start fresh: remembered, so a reload asks again never; still nothing uploaded.
    await pages.tabata.getByRole('button',{name:'Start fresh on this device'}).click();await pages.tabata.locator('#dlg').waitFor({state:'hidden'});
    await pages.tabata.reload();await wait(3000);assert.equal(await pages.tabata.locator('#dlg[open]').count(),0,'start fresh is remembered');
    assert.deepEqual(fresh.puts,[]);
    console.log('PASS Start fresh on this device is remembered and uploads nothing');

    // Browse: Settings opens on the backup list.
    await pages['bike-cardio'].getByRole('button',{name:'Browse backups'}).click();
    await pages['bike-cardio'].locator('#snapshotList button').first().waitFor();
    assert.ok(await pages['bike-cardio'].locator('#snapshotList').isVisible(),'Browse backups shows the list');
    console.log('PASS Browse backups opens the cloud backup list');

    // Restore latest: the usual confirmation, then the restored data backs up and backups resume.
    await confirmAction(pages.liftlog,()=>pages.liftlog.getByRole('button',{name:'Restore latest…'}).click());
    await pages.liftlog.waitForFunction(()=>!!localStorage.getItem('liftlog.v1.before-remote-restore'));
    const deadline=Date.now()+10000;while(Date.now()<deadline&&!fresh.puts.some(k=>k.startsWith('apps/liftlog-backup.json.snapshots/')))await wait(100);
    assert.ok(fresh.puts.some(k=>k.startsWith('apps/liftlog-backup.json.snapshots/')),'after a restore, backups resume');
    console.log('PASS Restore latest restores, keeps a recovery copy and resumes backups');

    // Dismissing leaves the device untouched and asks again on the next load.
    await pages.foodlog.keyboard.press('Escape');await pages.foodlog.locator('#dlg').waitFor({state:'hidden'});
    await pages.foodlog.reload();await dialogTitle(pages.foodlog).waitFor({timeout:10000});
    assert.ok(!fresh.puts.some(k=>k.startsWith('apps/foodlog')),'Foodlog uploaded nothing');
    console.log('PASS dismissing asks again on the next load');
    assert.deepEqual(fresh.errors,[]);
    await fresh.context.close();

    /* Conditional sync: a fresh device takes the cloud copy; a device with data pauses for a choice. */
    const cloud=JSON.parse([...objects.entries()].find(([k])=>k.startsWith('apps/liftlog-backup.json.snapshots/'))[1]);
    cloud.settings.lastModifiedAt=Date.now()-60000;cloud.routines[0].name='From the cloud';
    objects.set('apps/liftlog-backup.json',JSON.stringify(cloud));
    const synced=await device('conditional');
    const liftlog=await synced.open('liftlog');
    await liftlog.waitForFunction(()=>!!localStorage.getItem('liftlog.v1.before-remote-restore'),null,{timeout:10000});
    assert.equal(await liftlog.evaluate(()=>JSON.parse(localStorage.getItem('liftlog.v1')).routines[0].name),'From the cloud','a fresh device takes the cloud copy');
    assert.deepEqual(synced.puts,[],'taking the cloud copy uploads nothing');
    console.log('PASS conditional sync: a fresh device takes the cloud copy and keeps its starting data as a recovery copy');

    // The same device, edited before connecting, holds data of its own: sync pauses for a choice.
    await liftlog.evaluate(()=>{const s=JSON.parse(localStorage.getItem('liftlog.v1'));s.routines[0].name='Edited here';s.settings.lastModifiedAt=Date.now();localStorage.setItem('liftlog.v1',JSON.stringify(s));
      const r=JSON.parse(localStorage.getItem('liftlog.v1.remote'));delete r.lastUploadedModifiedAt;delete r.lastBackupMode;localStorage.setItem('liftlog.v1.remote',JSON.stringify(r));});
    await liftlog.reload();
    await liftlog.waitForFunction(()=>!!localStorage.getItem('liftlog.v1.remote-paused'),null,{timeout:10000});
    assert.equal(await liftlog.evaluate(()=>JSON.parse(localStorage.getItem('liftlog.v1.remote-paused')).code),'conflict');
    assert.equal(await liftlog.evaluate(()=>JSON.parse(localStorage.getItem('liftlog.v1')).routines[0].name),'Edited here','local data is kept');
    assert.deepEqual(synced.puts,[],'neither copy is replaced');
    console.log('PASS conditional sync: a device with its own data pauses for a choice and replaces nothing');
    assert.deepEqual(synced.errors,[]);
  }finally{await browser.close();await server.close?.();}
})().catch(error=>{console.error(error);process.exit(1);});
