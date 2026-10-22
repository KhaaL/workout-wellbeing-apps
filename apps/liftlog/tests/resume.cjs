// Browser checks for resuming separate cloud backups; only synthetic state/fake S3.
const assert = require('node:assert/strict');
const {appWithTestAPI,launchBrowser}=require('./harness.cjs');
const html=appWithTestAPI(`{navigate,remoteSyncPaused,get state(){return state}}`);
const fixture=(revision,notes)=>({version:14,settings:{lastModifiedAt:revision},exercises:[{id:'e',name:'Squat',unit:'kg'}],routines:[],workouts:[{id:'w',startedAt:1,finishedAt:2,notes,exercises:[{exerciseId:'e',name:'Squat',unit:'kg',sets:[{id:'s',reps:5,weight:20,completed:true}]}]}],activeWorkout:null});
const cfg={endpoint:'https://storage.test',region:'test',syncMode:'immutable',bucket:'test',pathStyle:true,objectKey:'backup.json',accessKeyId:'fake',secretAccessKey:'fake'};
const prefix=cfg.objectKey+'.snapshots/';
(async()=>{
 const browser=await launchBrowser();const errors=[];
 try {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  await context.route('**/*',route=>route.request().url().startsWith('https://liftlog.test/')?route.fulfill({contentType:'text/html',body:html}):route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({state,cfg})=>{if(!localStorage.getItem('liftlog.v1')){
   localStorage.setItem('liftlog.v1',JSON.stringify(state));localStorage.setItem('liftlog.v1.remote',JSON.stringify(cfg));
   localStorage.setItem('liftlog.v1.remote-paused',JSON.stringify({reason:'x',code:'import',at:Date.now()}));
  }},{state:fixture(300,'local'),cfg});
  await page.goto('https://liftlog.test/');
  // Two backup files: the newer one holds another device's data.
  await page.evaluate(({prefix,older,newest})=>{
   const files=new Map([[prefix+'2026-10-01-a.json',older],[prefix+'2026-10-05-b.json',newest]]),dates={[prefix+'2026-10-01-a.json']:'2026-10-01T10:00:00Z',[prefix+'2026-10-05-b.json']:'2026-10-05T10:00:00Z'};
   window.fakeS3={files,calls:[]};
   window.fetch=async(url,o)=>{
    const u=new URL(url),key=decodeURIComponent(u.pathname).split('/').slice(2).join('/');window.fakeS3.calls.push({method:o.method,key});
    if(u.searchParams.get('list-type')==='2'){
     const rows=[...files.keys()].filter(k=>k.startsWith(prefix)).sort().map(k=>`<Contents><Key>${k}</Key><LastModified>${dates[k]||new Date().toISOString()}</LastModified><Size>1024</Size></Contents>`).join('');
     return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${rows}</ListBucketResult>`,{headers:{'content-type':'application/xml'}});
    }
    if(o.method==='PUT'){files.set(key,o.body);return new Response('',{headers:{etag:'"put"'}});}
    if(files.has(key)){const body=files.get(key);return new Response(typeof body==='string'?body:JSON.stringify(body),{headers:{etag:'"'+key.length+'"'}});}
    return new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
   };
  },{prefix,older:fixture(100,'older'),newest:fixture(200,'newest')});
  await page.evaluate(()=>window.testAPI.navigate('settings'));
  const status=page.locator('#storage-summary');
  assert.match(await status.textContent(),/Cloud backups paused.*Nothing uploads until you resume backups/);
  // Cancelling the choice changes nothing.
  await status.getByRole('button',{name:'Resume backups…',exact:true}).click();
  await page.getByRole('button',{name:'Restore latest cloud backup…',exact:true}).waitFor();
  assert.equal(await page.locator('dialog[open] button').count(),3);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  assert.equal(await page.evaluate(()=>window.fakeS3.calls.length),0);assert.equal(await page.evaluate(()=>window.testAPI.remoteSyncPaused()),true);
  console.log('PASS resume offers the latest cloud backup; cancelling leaves backups paused');
  // Restoring the latest backup replaces local data with the newest file, keeps a recovery copy and resumes.
  await status.getByRole('button',{name:'Resume backups…',exact:true}).click();
  await page.getByRole('button',{name:'Restore latest cloud backup…',exact:true}).click();
  await page.getByRole('button',{name:'Restore & resume',exact:true}).waitFor();
  assert.match(await page.locator('dialog[open]').textContent(),/Restore latest cloud backup\?.*holds 1 workout\. /s);
  await page.getByRole('button',{name:'Restore & resume',exact:true}).click();
  await page.waitForFunction(()=>window.testAPI.state.workouts[0].notes==='newest'&&!window.testAPI.remoteSyncPaused());
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('liftlog.v1.before-remote-restore'))).workouts[0].notes,'local');
  await page.waitForFunction(prefix=>window.fakeS3.calls.some(call=>call.method==='PUT'&&call.key.startsWith(prefix)&&!/2026-10-0[15]/.test(call.key)),prefix,{timeout:15000});
  console.log('PASS restoring the latest cloud backup replaces local data, keeps a recovery copy and resumes backups');
  // Separate backups show no legacy single-file restore.
  await page.evaluate(()=>{document.querySelector('[data-settings-section="storage"]').open=true;});
  assert.doesNotMatch(await page.locator('section[aria-label="Data"]').textContent(),/legacy/i);
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS no legacy restore entries and no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
