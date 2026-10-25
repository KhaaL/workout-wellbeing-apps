// One cloud connection across the site, in a real browser on one origin: save it in Tabata, see it in
// Foodlog, Bike and Liftlog, back up to separate paths, follow a change made in another open app,
// switch an app off its own connection, and forget the shared connection everywhere.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const site=require('./site-server.cjs');
const {confirmAction}=require('./confirm-dialog.cjs');
const SHARED='wellbeing.connection.v1';
(async()=>{
  const server=await site.start(),origin=server.origin;
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),errors=[];
    // A synthetic S3-compatible bucket with browser CORS: create-only uploads, verifying reads and listings.
    const objects=new Map(),puts=[];
    await context.route('https://storage.test/**',async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, PUT, DELETE','Access-Control-Allow-Headers':'authorization, content-type, x-amz-content-sha256, x-amz-date, if-match, if-none-match','Access-Control-Expose-Headers':'ETag'};
      if(method==='OPTIONS')return route.fulfill({status:200,headers:cors,body:''});
      const [bucket,...rest]=decodeURIComponent(url.pathname).split('/').slice(1),key=rest.join('/'),id=bucket+'/'+key;
      if(url.searchParams.get('list-type')==='2'){
        const prefix=bucket+'/'+url.searchParams.get('prefix'),rows=[...objects.keys()].filter(k=>k.startsWith(prefix)).map(k=>`<Contents><Key>${k.slice(bucket.length+1)}</Key><LastModified>2026-01-01T00:00:00Z</LastModified><Size>10</Size></Contents>`).join('');
        return route.fulfill({status:200,headers:cors,body:`<ListBucketResult><IsTruncated>false</IsTruncated>${rows}</ListBucketResult>`});
      }
      if(method==='GET')return objects.has(id)?route.fulfill({status:200,headers:{...cors,ETag:'"1"'},body:objects.get(id)}):route.fulfill({status:404,headers:cors,body:'<Error><Code>NoSuchKey</Code></Error>'});
      if(method==='PUT'){if(objects.has(id))return route.fulfill({status:412,headers:cors,body:'<Error><Code>PreconditionFailed</Code></Error>'});objects.set(id,request.postData());puts.push(id);return route.fulfill({status:200,headers:{...cors,ETag:'"1"'},body:''});}
      return route.fulfill({status:405,headers:cors,body:''});
    });
    const open=async app=>{
      const page=await context.newPage();page.on('pageerror',error=>errors.push(app+': '+error.message));
      page.on('console',message=>{if(/Content Security Policy|Refused to/i.test(message.text()))errors.push(app+': '+message.text());});
      await page.goto(origin+'/'+app+'/');await page.locator('.nav-btn[data-view="settings"]').first().click();return page;
    };
    const scope=page=>page.locator('#connectionScope p').textContent();
    const shared=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SHARED);

    const tabata=await open('tabata');await tabata.click('text=Backups & cloud storage');
    assert.match(await scope(tabata),/^No connection yet\. The connection you save here is shared by every app on this site/);
    for(const [id,value] of [['#cloudEndpoint','https://storage.test'],['#cloudRegion','test'],['#cloudBucket','apps'],['#cloudAccess','fake'],['#cloudSecret','synthetic']])await tabata.fill(id,value);
    await tabata.click('#saveCloud');await tabata.waitForFunction(key=>!!localStorage.getItem(key),SHARED);
    assert.deepEqual(await shared(tabata),{endpoint:'https://storage.test',region:'test',bucket:'apps',accessKeyId:'fake',secretAccessKey:'synthetic',pathStyle:true,syncMode:'immutable'});
    await tabata.waitForFunction(()=>/^Shared connection: apps on storage\.test\./.test(document.querySelector('#connectionScope p').textContent));
    assert.match(await scope(tabata),/This app backs up to tabata-backup\.json\.$/);
    console.log('PASS a connection saved in Tabata becomes the shared connection');

    const foodlog=await open('foodlog');await foodlog.click('text=Backups & cloud storage');
    assert.equal(await scope(foodlog),'Shared connection: apps on storage.test. Every app on this site uses it, so saving it here changes it for all of them. This app backs up to foodlog-backup.json.');
    assert.equal(await foodlog.inputValue('#cloudEndpoint'),'https://storage.test');assert.equal(await foodlog.inputValue('#cloudObject'),'foodlog-backup.json');
    assert.equal(await foodlog.isVisible('#cloudBackup'),true,'Foodlog can back up without entering anything');
    await foodlog.click('#cloudBackup');
    await tabata.click('#cloudBackup');
    const deadline=Date.now()+10000;while(Date.now()<deadline&&!(puts.some(k=>k.startsWith('apps/foodlog-backup.json.snapshots/'))&&puts.some(k=>k.startsWith('apps/tabata-backup.json.snapshots/'))))await new Promise(r=>setTimeout(r,100));
    assert.ok(puts.some(k=>k.startsWith('apps/foodlog-backup.json.snapshots/')),'Foodlog backs up to its own path: '+puts.join(', '));
    assert.ok(puts.some(k=>k.startsWith('apps/tabata-backup.json.snapshots/')),'Tabata backs up to its own path');
    console.log('PASS Foodlog uses the shared connection, and each app backs up to its own path');

    await tabata.fill('#cloudBucket','apps-two');await tabata.fill('#cloudSecret','');await tabata.click('#saveCloud');
    await foodlog.waitForFunction(()=>document.getElementById('cloudBucket').value==='apps-two'&&/^Shared connection: apps-two on/.test(document.querySelector('#connectionScope p').textContent),null,{timeout:10000});
    assert.equal((await shared(foodlog)).secretAccessKey,'synthetic','a blank secret keeps the saved one');
    console.log('PASS an open app follows a connection change made in another app');

    const bike=await open('bike-cardio');
    await bike.waitForFunction(()=>/^Shared connection: apps-two on storage\.test\..*This app backs up to bike-cardio-backup\.json\.$/.test(document.querySelector('#connectionScope p')?.textContent||''));
    const liftlog=await open('liftlog');
    await liftlog.waitForFunction(()=>/^Shared connection: apps-two on storage\.test\..*This app backs up to liftlog-backup\.json\.$/.test(document.getElementById('connection-scope')?.textContent||''));
    console.log('PASS Bike and Liftlog show the shared connection and their own paths');

    await foodlog.evaluate(()=>localStorage.setItem('foodlog.v1.remote',JSON.stringify({endpoint:'https://storage.test',region:'test',bucket:'food-only',accessKeyId:'other',secretAccessKey:'other',pathStyle:true,syncMode:'immutable',objectKey:'foodlog-backup.json'})));
    await foodlog.reload();await foodlog.locator('.nav-btn[data-view="settings"]').first().click();await foodlog.click('text=Backups & cloud storage');
    assert.match(await scope(foodlog),/still uses its own connection.*food-only on storage\.test\. The other apps use apps-two on storage\.test\./);
    await confirmAction(foodlog,()=>foodlog.getByRole('button',{name:'Use the shared connection…'}).click());
    await foodlog.waitForFunction(()=>/^Shared connection: apps-two/.test(document.querySelector('#connectionScope p').textContent));
    assert.equal(await foodlog.inputValue('#cloudBucket'),'apps-two');
    console.log('PASS an app with its own connection switches to the shared one');

    await foodlog.click('#cloudForget');
    assert.equal(await foodlog.textContent('#dlg-title'),'Forget the shared connection?');
    await foodlog.locator('#dlg-actions button').last().click();await foodlog.locator('#dlg').waitFor({state:'hidden'});
    assert.equal(await foodlog.evaluate(key=>localStorage.getItem(key),SHARED),null);
    await tabata.waitForFunction(()=>document.getElementById('cloudActions').hidden&&/^No connection yet/.test(document.querySelector('#connectionScope p').textContent),null,{timeout:10000});
    assert.equal(JSON.parse(await tabata.evaluate(()=>localStorage.getItem('tabata.v1.remote'))).objectKey,'tabata-backup.json','other apps keep their backup path');
    console.log('PASS forgetting the shared connection ends cloud backups in every app');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
