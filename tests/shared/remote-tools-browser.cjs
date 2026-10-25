const {confirmAction}=require('./confirm-dialog.cjs');
const {navigate: navigateUI}=require('./ui-navigation.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,createHmac}=require('node:crypto');
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const generatedCors=execFileSync('python3',['-c',`
import importlib.util, json, xml.etree.ElementTree as ET
spec = importlib.util.spec_from_file_location('cors', 'scripts/s3-cors.py')
cors = importlib.util.module_from_spec(spec); spec.loader.exec_module(cors)
origins = ['https://bike-cardio.test', 'https://liftlog.test']
_, raw = cors.update('CORS: none', origins)
root = ET.fromstring(raw); ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
print(json.dumps({r.findtext(ns + 'AllowedOrigin'): {name: [n.text for n in r.findall(ns + name)] for name in ['AllowedMethod', 'AllowedHeader', 'ExposeHeader']} for r in root}))
`],{cwd:root,encoding:'utf8'});
const corsRules=JSON.parse(generatedCors);
const cfg={endpoint:'https://storage.test',region:'test',syncMode:'conditional',bucket:'test',pathStyle:true,objectKey:'backups/work & ü.json',accessKeyId:'fake',secretAccessKey:'synthetic-secret'};
const ride={id:'r',startedAt:1720000000000,endedAt:1720001800000,config:{mode:'zone2',bike:'levels'},activeMs:1800000,mainMs:1500000,outcome:'complete',effortsCompleted:0,metrics:{notes:'before'}};
const lifting={version:14,settings:{lastModifiedAt:100},exercises:[{id:'e',name:'Squat',unit:'kg'}],routines:[],workouts:[{id:'w',startedAt:1,finishedAt:2,notes:'before',exercises:[{exerciseId:'e',name:'Squat',unit:'kg',sets:[{id:'s',reps:5,weight:20,completed:true}]}]}],activeWorkout:null};
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function verifySignature(url,headers,body,region=cfg.region){
  const auth=headers.authorization,match=auth.match(/Credential=([^,]+), SignedHeaders=([^,]+), Signature=(\w+)/);assert.ok(match);
  const names=match[2].split(';'),hash=value=>createHash('sha256').update(value).digest('hex');
  const canonicalHeaders=names.map(name=>name+':'+(name==='host'?url.host:headers[name])+'\n').join('');
  const canonical=[headers[':method']||'GET',url.pathname,url.search.slice(1),canonicalHeaders,match[2],hash(body||'')].join('\n');
  const scope=match[1].split('/').slice(1).join('/'),stamp=headers['x-amz-date'].slice(0,8);
  let key=Buffer.from('AWS4'+cfg.secretAccessKey);
  for(const part of [stamp,region,'s3','aws4_request'])key=createHmac('sha256',key).update(part).digest();
  assert.equal(createHmac('sha256',key).update(['AWS4-HMAC-SHA256',headers['x-amz-date'],scope,hash(canonical)].join('\n')).digest('hex'),match[3]);
}
(async()=>{
  const browser=await chromium.launch({headless:true,...process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}});
  try{
    for(const app of ['bike-cardio','liftlog']){
      const origin='https://'+app+'.test',namespace=app+'.v1',stateKey=app==='liftlog'?'liftlog.v1':'bike-cardio.state.v1';
      const state=app==='liftlog'?structuredClone(lifting):{app:'bike-cardio',version:1,updatedAt:100,settings:{mode:'zone2'},history:[structuredClone(ride)],active:null};
      const snapshot=structuredClone(state);if(app==='liftlog')snapshot.workouts[0].notes='snapshot-one';else snapshot.history[0].metrics.notes='snapshot-one';
      const snapshotKey=cfg.objectKey+'.snapshots/2026-10-01-<img src=x onerror=alert(1)> & ü.json';
      const anotherKey=cfg.objectKey+'.snapshots/2026-10-02.json',token='next+/ =雪';
      const fillerKeys=Array.from({length:20},(_,i)=>cfg.objectKey+'.snapshots/2026-10-'+String(i+3).padStart(2,'0')+'.json');
      const objects=new Map([[cfg.objectKey,{raw:JSON.stringify(state),etag:'"live"'}],[snapshotKey,{raw:JSON.stringify(snapshot),etag:'"snapshot"'}],[anotherKey,{raw:JSON.stringify(snapshot),etag:'"another"'}]]);
      for(const key of fillerKeys)objects.set(key,{raw:JSON.stringify(snapshot),etag:'\"filler\"'});
      const calls=[],errors=[];let revision=0,ignoreWriteConditions=false,listingOverride=null;
      const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      const html=fs.readFileSync(path.join(root,'dist',app,'index.html'),'utf8'),csp=require('./site-headers.cjs').csp(app);
      await context.route(origin+'/**',route=>route.fulfill({contentType:'text/html',body:html,headers:{'Content-Security-Policy':csp}}));
      await context.route('https://storage.test/**',async route=>{
        const req=route.request(),url=new URL(req.url()),method=req.method(),headers=await req.allHeaders();
        const rule=corsRules[origin],cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':rule.AllowedMethod.join(', '),'Access-Control-Allow-Headers':rule.AllowedHeader.join(', '),'Access-Control-Expose-Headers':rule.ExposeHeader.join(', ')};
        if(method==='OPTIONS'){await route.fulfill({status:200,headers:cors,body:''});return;}
        verifySignature(url,{...headers,':method':method},req.postData()||'','test');
        const key=decodeURIComponent(url.pathname).split('/').slice(2).join('/');calls.push({method,key,url:req.url()});
        const respond=(status,body='',extra={})=>route.fulfill({status,headers:{...cors,...extra},body});
        if(url.searchParams.get('list-type')==='2'){
          assert.equal(url.searchParams.get('prefix'),cfg.objectKey+'.snapshots/');assert.ok(['20','1000'].includes(url.searchParams.get('max-keys')));
          if(listingOverride)return respond(listingOverride.status,listingOverride.body);
          const next=url.searchParams.get('continuation-token');if(next)assert.equal(next,token);
          const rows=next?[{key:anotherKey,at:'2026-12-01T10:00:00Z'}]:[{key:snapshotKey,at:'2026-11-01T10:00:00Z'},...fillerKeys.map((key,i)=>({key,at:'2026-10-'+String(i+3).padStart(2,'0')+'T10:00:00Z'}))];
          const contents=rows.slice(0,Number(url.searchParams.get('max-keys'))).map(item=>`<Contents><Key>${xml(item.key)}</Key><LastModified>${item.at}</LastModified><Size>1024</Size></Contents>`).join('');
          return respond(200,`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${!next}</IsTruncated>${contents}${next?'':'<NextContinuationToken>'+xml(token)+'</NextContinuationToken>'}</ListBucketResult>`);
        }
        const old=objects.get(key);
        if(method==='GET')return old?respond(200,old.raw,{ETag:old.etag}):respond(404,'<Error><Code>NoSuchKey</Code></Error>');
        if(method==='DELETE'){objects.delete(key);return respond(200);}
        if(!ignoreWriteConditions&&(headers['if-none-match']==='*'&&old||headers['if-match']&&headers['if-match']!==old?.etag))return respond(412,'<Error><Code>PreconditionFailed</Code></Error>');
        objects.set(key,{raw:req.postData(),etag:'"'+(++revision)+'"'});return respond(200);
      });
      await page.addInitScript(({state,stateKey,namespace,cfg})=>{if(!localStorage.getItem(stateKey)){localStorage.setItem(stateKey,JSON.stringify(state));localStorage.setItem(namespace+'.remote',JSON.stringify(cfg));localStorage.setItem(namespace+'.remote-paused','{}');}},{state,stateKey,namespace,cfg});
      const openTools=async()=>{
        if(app==='bike-cardio'){
          await navigateUI(page,'settings');const backups=page.locator('details').filter({has:page.locator('summary',{hasText:'Backups & cloud storage'})}).first();
          if(!await backups.evaluate(node=>node.open))await backups.locator('summary').first().click();
          if(!await page.locator('#storageTools').evaluate(node=>node.open))await page.locator('#storageTools > summary').click();
        }else{
          await page.locator('.nav-btn[data-view="settings"]').click();
          // Cloud backup holds Connection (read test) and Troubleshooting (provider check) as nested sections.
          for(const id of ['storage','cloud-connection','cloud-troubleshooting']){const section=page.locator('details[data-settings-section="'+id+'"]');if(!await section.evaluate(node=>node.open))await section.locator('summary').first().click();}
        }
      };
      const acceptRestore=async accept=>{
        if(app==='bike-cardio'){await confirmAction(page,()=>page.click('#snapshotRestore0'),accept);}
        else{await page.click('#snapshotRestore0');await page.getByRole('button',{name:accept?'Restore locally':'Cancel',exact:true}).click();}
      };
      await page.goto(origin+'/');await openTools();
      await page.click('#providerCheck');await page.waitForFunction(()=>document.getElementById('providerResults')?.textContent.includes('Current-version update: passed')&&!document.getElementById('providerCheck').disabled);
      assert.equal([...objects.keys()].filter(key=>key.includes('.checks/')).length,0);assert.equal(objects.get(cfg.objectKey).raw,JSON.stringify(state));
      const diagnosticDownload=page.waitForEvent('download');await page.click('#downloadDiagnostics');const diagnostics=JSON.parse(fs.readFileSync(await (await diagnosticDownload).path(),'utf8'));
      assert.equal(diagnostics.providerCheck.compatible,true);assert.doesNotMatch(JSON.stringify(diagnostics),/synthetic-secret|fake|Authorization|accessKeyId|secretAccessKey|snapshot-one/);
      await page.click('#browseSnapshots');await page.waitForFunction(()=>document.getElementById('snapshotPreview0')&&!document.getElementById('browseSnapshots').disabled);
      assert.match(await page.locator('#snapshotList > div').first().textContent(),/2026-10-02.json/,'newest metadata from the final provider page appears first');
      assert.equal(await page.locator('#snapshotList > div').count(),20);
      assert.equal(await page.locator('#snapshotList img').count(),0);assert.match(await page.locator('#snapshotList').textContent(),/<img/);
      await page.click('#snapshotPreview0');await page.waitForFunction(()=>/1 (rides|workouts)/.test(document.getElementById('snapshotList').textContent));
      const snapshotDownload=page.waitForEvent('download');await page.click('#snapshotDownload0');const downloaded=fs.readFileSync(await (await snapshotDownload).path(),'utf8');assert.equal(downloaded,JSON.stringify(snapshot));
      await page.click('#nextSnapshots');await page.waitForFunction(()=>document.getElementById('snapshotList').textContent.includes('2026-10-03.json')&&!document.getElementById('browseSnapshots').disabled);
      assert.equal(await page.locator('#nextSnapshots').count(),0);
      assert.equal(await page.locator('#snapshotList > div').count(),2);
      assert.match(await page.locator('#snapshotList > div').first().textContent(),/2026-10-04.json/);
      const beforePaging=calls.length;await page.click('#previousSnapshots');
      await page.waitForFunction(()=>document.getElementById('snapshotList').firstElementChild.textContent.includes('2026-10-02.json')&&!document.getElementById('browseSnapshots').disabled);
      assert.equal(calls.length,beforePaging,'local page changes do not repeat the listing');
      const beforeLoop=calls.filter(call=>new URL(call.url).searchParams.has('list-type')).length;
      listingOverride={status:200,body:'<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>repeated</NextContinuationToken></ListBucketResult>'};
      const repeatedResponse=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).searchParams.get('continuation-token')==='repeated');
      await page.click('#browseSnapshots');
      await repeatedResponse;
      await page.waitForFunction(()=>!document.getElementById('browseSnapshots').disabled&&/repeated its pagination token/.test(document.body.textContent));
      assert.equal(calls.filter(call=>new URL(call.url).searchParams.has('list-type')).length-beforeLoop,2,'repeated tokens stop the listing without publishing a partial order');
      listingOverride=null;
      await page.click('#browseSnapshots');await page.waitForFunction(()=>document.getElementById('snapshotList').textContent.includes('<img')&&!document.getElementById('browseSnapshots').disabled);
      const before=await page.evaluate(stateKey=>localStorage.getItem(stateKey),stateKey);
      await acceptRestore(false);await page.waitForFunction(()=>!document.getElementById('browseSnapshots').disabled);assert.equal(await page.evaluate(stateKey=>localStorage.getItem(stateKey),stateKey),before);
      await acceptRestore(true);await page.waitForFunction(({stateKey,app})=>{const s=JSON.parse(localStorage.getItem(stateKey));return (app==='liftlog'?s.workouts[0].notes:s.history[0].metrics.notes)==='snapshot-one';},{stateKey,app});
      assert.equal(await page.evaluate(namespace=>localStorage.getItem(namespace+'.remote-paused')!==null,namespace),true);
      const recovery=JSON.parse(await page.evaluate(namespace=>localStorage.getItem(namespace+'.before-remote-restore'),namespace));assert.equal(app==='liftlog'?recovery.workouts[0].notes:recovery.history[0].metrics.notes,'before');
      assert.ok(calls.filter(call=>call.method==='PUT'||call.method==='DELETE').every(call=>call.key.includes('.checks/')));
      await openTools();await page.setViewportSize({width:320,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'/tmp/'+app+'-remote-tools.png',fullPage:true});assert.deepEqual(errors,[]);
      // Exercise generic automatic backup mode through each app's real form.
      ignoreWriteConditions=true;calls.length=0;
      if(app==='bike-cardio'){await page.fill('#cloudRegion','test');await page.selectOption('#cloudMode','auto');await page.click('#saveCloud');}
      else{await openTools();await page.fill('[data-bind="remote"][data-field="region"]','test');await page.selectOption('[data-bind="remote"][data-field="syncMode"]','immutable');await page.locator('form[data-form="remote-config"] button[type="submit"]').click();}
      // The backup mode belongs to the connection, which every app on the site shares.
      await page.waitForFunction(({mode})=>JSON.parse(localStorage.getItem('wellbeing.connection.v1')).syncMode===mode,{mode:app==='bike-cardio'?'auto':'immutable'});
      await openTools();
      const testConnection=async()=>{const before=calls.length;await page.locator(app==='bike-cardio'?'#cloudTest':'[data-action="remote-test"]').click();await page.waitForFunction(app=>!document.querySelector(app==='bike-cardio'?'#cloudTest':'[data-action="remote-test"]').disabled,app);assert.equal(calls.length,before+1);assert.equal(calls.at(-1).method,'GET');assert.ok(new URL(calls.at(-1).url).searchParams.has('list-type'));};
      await testConnection();assert.match(await page.locator(app==='bike-cardio'?'#toast':'#toast-region').textContent(),/Backup listing readable — write permission unverified/);
      if(app==='liftlog'){assert.equal(await page.locator('[data-settings-section="storage"]').getByRole('button',{name:'Resume backups…',exact:true}).count(),1);assert.equal(await page.locator('#storage-summary').getByRole('button',{name:'Resume backups…',exact:true}).count(),1);assert.equal(await page.locator('[data-action="remote-resume"]').count(),0,'separate backups show one resume button');assert.doesNotMatch(await page.locator('[data-settings-section="storage"]').textContent(),/Sync now reconciles/);}
      listingOverride={status:200,body:'<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'};
      await testConnection();assert.match(await page.locator(app==='bike-cardio'?'#toast':'#toast-region').textContent(),/no separate backups yet/);
      listingOverride={status:200,body:'<not-a-list />'};
      await testConnection();assert.match(await page.locator(app==='bike-cardio'?'#toast':'#toast-region').textContent(),/Snapshot listing is invalid/);
      listingOverride={status:403,body:'<Error><Code>AccessDenied</Code><Message>Forbidden: Invalid signature</Message></Error>'};
      await testConnection();assert.match(await page.locator(app==='bike-cardio'?'#toast':'#toast-region').textContent(),/credentials or request signature/);
      listingOverride=null;
      await page.click('#providerCheck');await page.waitForFunction(()=>document.getElementById('providerResults')?.textContent.includes('Stale-version protection: failed')&&!document.getElementById('providerCheck').disabled);
      const report=await page.evaluate(namespace=>JSON.parse(localStorage.getItem(namespace+'.provider-check')).report,namespace);assert.equal(report.mode,'immutable');assert.equal(report.compatible,true);
      const rootBefore=objects.get(cfg.objectKey).raw;
      if(app==='bike-cardio'){await confirmAction(page,()=>page.click('#cloudKeepLocal'));}
      else{await page.locator('[data-action="remote-publish-local"]').click();await page.getByRole('button',{name:'Resume backups',exact:true}).click();}
      await page.waitForFunction(namespace=>localStorage.getItem(namespace+'.remote-paused')===null,namespace);
      assert.ok(calls.some(call=>call.method==='PUT'&&call.key.startsWith(cfg.objectKey+'.snapshots/')));assert.equal(objects.get(cfg.objectKey).raw,rootBefore);
      assert.ok(calls.filter(call=>call.method==='PUT').every(call=>call.key.includes('.checks/')||call.key.includes('.snapshots/')));assert.deepEqual(errors,[]);
      await context.close();console.log('PASS '+app+': real CORS, SigV4 query signing, disposable probes, diagnostics redaction, snapshot pagination/preview/download/restore, cancellation and mobile layout.');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
