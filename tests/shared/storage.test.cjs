const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8');
function setup(map=new Map(),confirm=async()=>true){
  let next=0;const timers=new Map(),messages=[],statuses=[];
  const ctx={console,URL,TextEncoder,TextDecoder,AbortController,Headers,Response,ReadableStream,Blob,crypto:webcrypto,
    navigator:{onLine:true},location:{protocol:'https:',hostname:'bike.test'},confirmBike:confirm,
    localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},
    setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id)};
  ctx.window=ctx;vm.createContext(ctx);
  for(const id of ['heart-rate-core','workout-core'])vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1],ctx);
  vm.runInContext(`globalThis.bike=BikeStorage.create({core:WorkoutCore,heart:HeartRateCore,onLocalStatus:s=>statuses.push(s),onRemoteStatus:(s,t)=>messages.push(t),toast:t=>messages.push(t),confirm:(...args)=>confirmBike(...args),onRestore:()=>{}});`,Object.assign(ctx,{messages,statuses}));
  return {ctx,bike:ctx.bike,map,timers,messages,statuses};
}
function legacyRecord(){return {id:'old',startedAt:1720000000123,endedAt:1720001980123,config:{mode:'zone2',bike:'touchscreen',context:'fresh'},activeMs:1980000,mainMs:1500000,outcome:'complete',effortsCompleted:0,metrics:{averageHR:'128',mainAverageHR:'115.5',averageWatts:'140',notes:'original'}};}
const cfg={endpoint:'https://storage.test',region:'test',syncMode:'conditional',bucket:'test',pathStyle:true,accessKeyId:'fake',secretAccessKey:'synthetic'};
test('automatic and omitted backup modes use separate files independently of provider region',()=>{
  const d=setup();
  for(const region of ['region-one','region-two']){
    assert.equal(d.bike.remote.syncMode({...cfg,region,syncMode:'auto'}),'immutable');
    assert.equal(d.bike.remote.syncMode({...cfg,region,syncMode:undefined}),'immutable');
    assert.equal(d.bike.remote.syncMode({...cfg,region,syncMode:'conditional'}),'conditional');
  }
});

test('Bike migrates legacy keys without deleting originals or inventing a revision',()=>{
  const map=new Map([['bike-cardio.history.v1',JSON.stringify([legacyRecord()])]]),before=map.get('bike-cardio.history.v1'),d=setup(map);
  assert.equal(d.bike.state.history[0].startedAt,1720000000123);assert.equal(d.bike.state.updatedAt,0);
  assert.equal(d.bike.local.existing,true);d.bike.local.save({touch:false,remote:false,immediate:true});
  assert.equal(map.get('bike-cardio.history.v1'),before);assert.equal(JSON.parse(map.get('bike-cardio.state.v1')).history[0].metrics.mainAverageHR,'115.5');
});
test('invalid legacy data blocks migration and retains its exact bytes',()=>{
  const map=new Map([['bike-cardio.history.v1','{broken']]),d=setup(map);
  assert.equal(d.bike.local.blocked,true);assert.equal(d.bike.local.save({immediate:true}),false);
  assert.equal(map.get('bike-cardio.history.v1'),'{broken');assert.equal(map.has('bike-cardio.state.v1'),false);
});
test('corrupted new storage is rescued; failed rescue prevents overwriting it',()=>{
  const d=setup(new Map([['bike-cardio.state.v1','{broken']]));
  assert.equal(d.map.get('bike-cardio.v1.unreadable'),'{broken');assert.equal(d.bike.recovery(),'{broken');
  const map=new Map([['bike-cardio.state.v1','{broken'],['bike-cardio.v1.unreadable','previous']]),blocked=setup(map);
  assert.equal(blocked.bike.local.blocked,true);blocked.bike.local.save({immediate:true});assert.equal(map.get('bike-cardio.state.v1'),'{broken');
});
test('full restore validates before replacement and preserves a recovery copy',async()=>{
  const d=setup(new Map([['bike-cardio.history.v1',JSON.stringify([legacyRecord()])]]));d.bike.local.save({touch:false,remote:false,immediate:true});
  const candidate=d.bike.backup();candidate.history[0].metrics.mainAverageHR='116';
  assert.equal(await d.bike.restore(candidate),true);assert.equal(d.bike.state.history[0].metrics.mainAverageHR,'116');
  assert.equal(JSON.parse(d.map.get('bike-cardio.v1.before-remote-restore')).history[0].metrics.mainAverageHR,'115.5');
  assert.equal(d.bike.remote.remoteSyncPaused(),true);
  const before=JSON.stringify(d.bike.state);await assert.rejects(d.bike.restore({app:'liftlog',version:14}),/Bike Cardio/);assert.equal(JSON.stringify(d.bike.state),before);
});
test('quota failure keeps the durable record and live state on restore',async()=>{
  const d=setup();d.bike.local.save({touch:false,remote:false,immediate:true});
  const before=d.map.get('bike-cardio.state.v1'),candidate=d.bike.backup();candidate.history=[legacyRecord()];
  d.ctx.localStorage.setItem=(k,v)=>{if(k==='bike-cardio.state.v1')throw Error('full');d.map.set(k,String(v));};
  await assert.rejects(d.bike.restore(candidate),/Previous data retained/);assert.equal(d.map.get('bike-cardio.state.v1'),before);assert.equal(d.bike.state.history.length,0);
});
test('active sessions prevent replacing the log',async()=>{
  const d=setup();const active=vm.runInContext("WorkoutCore.create({},Date.now(),'active')",d.ctx);
  d.bike.write('bike-cardio.active.v1',active);await assert.rejects(d.bike.restore(d.bike.backup()),/Finish or end/);
});
test('an interrupted finish retains the logged ride and clears its duplicate active entry',()=>{
  const d=setup(),candidate=d.bike.backup();candidate.history=[legacyRecord()];candidate.active={id:'old',status:'finished'};
  const restored=d.bike.prepare(candidate);assert.equal(restored.history.length,1);assert.equal(restored.active,null);
});
test('an explicit edit that cannot be saved leaves the prior live history intact',()=>{
  const d=setup(new Map([['bike-cardio.history.v1',JSON.stringify([legacyRecord()])]]));
  const candidate=JSON.parse(JSON.stringify(d.bike.state.history));candidate[0].metrics.notes='unsaved draft';
  d.ctx.localStorage.setItem=()=>{throw Error('full');};
  assert.equal(d.bike.write('bike-cardio.history.v1',candidate,{atomic:true}),false);
  assert.equal(d.bike.state.history[0].metrics.notes,'original');
});
test('local writes are batched and explicit flush persists the newest revision',()=>{
  const d=setup();d.bike.local.save();d.bike.state.history.push(legacyRecord());d.bike.local.save();
  assert.equal(d.map.has('bike-cardio.state.v1'),false);assert.equal(d.timers.size,1);assert.equal(d.bike.local.flush(),true);
  assert.equal(JSON.parse(d.map.get('bike-cardio.state.v1')).history.length,1);assert.equal(d.timers.size,0);
});
test('Bike backup excludes credentials, signed requests are conditional, app sync metadata is isolated',async()=>{
  const map=new Map([['liftlog.v1.remote-work','untouched'],['liftlog.v1.remote-paused','{}']]),d=setup(map),calls=[];let cloud=null;
  d.ctx.fetch=async(url,options)=>{calls.push({url,options});if(options.method==='GET')return cloud?new Response(JSON.stringify(cloud),{headers:{etag:'"1"'}}):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
    assert.equal(options.headers['if-none-match'],'*');assert.match(options.headers.Authorization,/AWS4-HMAC-SHA256/);cloud=JSON.parse(options.body);return new Response('');};
  d.bike.remote.saveRemoteConfig({...cfg});d.bike.write('bike-cardio.history.v1',[legacyRecord()]);await d.bike.remote.remoteBackup();
  assert.equal(cloud.app,'bike-cardio');assert.match(calls.find(c=>c.options.method==='PUT').url,/bike-cardio-backup.json$/);
  assert.doesNotMatch(JSON.stringify(d.bike.backup()),/synthetic|secretAccessKey|accessKeyId/);
  assert.equal(map.get('liftlog.v1.remote-work'),'untouched');assert.equal(map.get('liftlog.v1.remote-paused'),'{}');
  assert.equal(d.bike.remote.readRemoteWork().pending,false);
});
test('Bike schema rejects duplicate sessions, impossible durations and invalid metrics',()=>{
  const d=setup();for(const mutate of [s=>{s.history=[legacyRecord(),legacyRecord()];},s=>{s.history[0].mainMs=s.history[0].activeMs+1;},s=>{s.history[0].metrics.mainAverageHR='301';},s=>{s.history[0].effortsCompleted=9;}]){
    const candidate=d.bike.backup();candidate.history=[legacyRecord()];mutate(candidate);assert.throws(()=>d.bike.prepare(candidate));
  }
});
test('independent local and cloud edits require an explicit choice after a shared baseline',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg,lastUploadedModifiedAt:100});
  d.bike.state.updatedAt=300;d.bike.state.history=[legacyRecord()];
  const cloud=d.bike.backup();cloud.updatedAt=200;cloud.history[0].metrics.notes='remote edit';
  const calls=[];d.ctx.fetch=async(url,options)=>{calls.push(options.method);return new Response(JSON.stringify(cloud),{headers:{etag:'"1"'}});};
  await d.bike.remote.remoteBackup();assert.deepEqual(calls,['GET']);assert.equal(d.bike.state.history[0].metrics.notes,'original');
  assert.match(d.messages.at(-1),/Both copies changed/);
});
test('a stale browser tab cannot silently overwrite another tab’s saved history',()=>{
  const map=new Map(),a=setup(map);a.bike.local.save({touch:false,remote:false,immediate:true});const b=setup(map);
  a.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  const other=legacyRecord();other.id='other';assert.equal(b.bike.write('bike-cardio.history.v1',[other]),false);
  assert.equal(JSON.parse(map.get('bike-cardio.state.v1')).history[0].id,'old');assert.match(b.bike.local.warning,/Another tab/);
  assert.equal(b.bike.backup().history[0].id,'other');
});

test('connection files default to excluding secrets and import only into a validated draft',()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg,objectKey:'rides.json'});
  const before=d.map.get('bike-cardio.v1.remote'),safe=d.bike.configPayload();
  assert.equal(safe.kind,'remote-config');assert.equal(safe.secretAccessKey,undefined);
  const draft=d.bike.configDraft(safe);assert.equal(draft.secretAccessKey,'');assert.equal(draft.objectKey,'rides.json');
  assert.equal(d.bike.configPayload(true).secretAccessKey,'synthetic');assert.equal(d.map.get('bike-cardio.v1.remote'),before);
  for(const bad of [{...safe,app:'liftlog'},{...safe,pathStyle:'false'},{...safe,endpoint:'https://storage.test/bucket'},{...safe,objectKey:'../backup'}])assert.throws(()=>d.bike.configDraft(bad));
});
test('file-backup bookkeeping does not change ride revisions, pending sync or workout backups',()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  const before=JSON.stringify(d.bike.state),revision=d.bike.state.updatedAt;
  assert.equal(d.bike.backupInfo().stale,true);assert.equal(d.bike.recordFileBackup(),true);
  assert.equal(d.bike.state.updatedAt,revision);assert.equal(d.bike.backupInfo().where,'a downloaded file');
  assert.doesNotMatch(JSON.stringify(d.bike.backup()),/last-file-backup/);
  assert.equal(JSON.stringify(d.bike.state),before);
});
test('reordered backup object keys do not cause false cloud conflicts or uploads',async()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  d.bike.remote.saveRemoteConfig({...cfg,lastUploadedModifiedAt:d.bike.state.updatedAt});
  const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
  const cloud=reverse(d.bike.backup());cloud.updatedAt++;cloud.history[0].config=Object.fromEntries(Object.entries(cloud.history[0].config).reverse());
  const methods=[];d.ctx.fetch=async(url,options)=>{methods.push(options.method);return new Response(JSON.stringify(cloud),{headers:{etag:'"1"'}});};
  await d.bike.remote.remoteBackup();assert.deepEqual(methods,['GET']);assert.match(d.messages.at(-1),/Up to date/);
});
test('history merge reports duplicates, invalid records and conflicts while retaining settings and active ride',async()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  const active=vm.runInContext("WorkoutCore.create({},Date.now(),'active')",d.ctx);d.bike.write('bike-cardio.active.v1',active);
  const before=JSON.stringify(d.bike.state.settings),old=legacyRecord(),added={...old,id:'new'},conflict={...old,metrics:{...old.metrics,notes:'different'}},activeConflict={...old,id:'active'};
  const result=await d.bike.mergeHistory({app:'bike-cardio',version:1,kind:'history',history:[old,conflict,added,added,{id:'bad'},activeConflict]});
  assert.equal(result.added,1);assert.equal(result.already,2);assert.equal(result.invalid,1);assert.equal(result.conflicts,2);
  assert.equal(d.bike.state.history.length,2);assert.equal(d.bike.state.history.find(r=>r.id==='old').metrics.notes,'original');
  assert.equal(JSON.stringify(d.bike.state.settings),before);assert.equal(d.bike.state.active.id,'active');
  assert.equal(d.bike.remote.remoteSyncPaused(),true);assert.equal(JSON.parse(d.map.get('bike-cardio.v1.before-remote-restore')).history.length,1);
});
test('cancelled, raced and quota-failed history imports cannot replace durable history',async()=>{
  const payload={app:'bike-cardio',version:1,kind:'history',history:[legacyRecord()]};
  const cancelled=setup(new Map(),async()=>false);assert.equal(await cancelled.bike.mergeHistory(payload),null);assert.equal(cancelled.bike.state.history.length,0);
  const raced=setup();raced.ctx.confirmBike=async()=>{raced.bike.write('bike-cardio.settings.v1',{...raced.bike.state.settings,bikeId:'new edit'});return true;};
  await assert.rejects(raced.bike.mergeHistory(payload),/changed during review/);assert.equal(raced.bike.state.history.length,0);
  const full=setup();full.bike.local.save({touch:false,remote:false,immediate:true});const before=full.map.get('bike-cardio.state.v1');
  full.ctx.localStorage.setItem=(k,v)=>{if(k==='bike-cardio.state.v1')throw Error('quota');full.map.set(k,String(v));};
  await assert.rejects(full.bike.mergeHistory(payload),/could not be saved/);assert.equal(full.map.get('bike-cardio.state.v1'),before);assert.equal(full.bike.state.history.length,0);
});
test('both recovery sources remain accessible and changed copies cannot be discarded',async()=>{
  const d=setup();d.map.set('bike-cardio.v1.unreadable','{broken');d.map.set('bike-cardio.v1.before-remote-restore',JSON.stringify(d.bike.backup()));
  const copies=d.bike.recoveryCopies();assert.equal(copies.length,2);assert.equal(copies[0].restorable,false);assert.equal(copies[1].restorable,true);
  d.ctx.confirmBike=async()=>{d.map.set('bike-cardio.v1.before-remote-restore','changed');return true;};
  await assert.rejects(d.bike.discardRecovery('before-remote-restore'),/changed during review/);assert.equal(d.map.get('bike-cardio.v1.before-remote-restore'),'changed');
  d.ctx.confirmBike=async()=>true;await d.bike.discardRecovery('unreadable');assert.equal(d.map.has('bike-cardio.v1.unreadable'),false);
});
test('clearing history retains settings and credentials, preserves recovery and pauses sync',async()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);d.bike.remote.saveRemoteConfig({...cfg});
  const config=d.map.get('bike-cardio.v1.remote'),settings=JSON.stringify(d.bike.state.settings);
  assert.equal(await d.bike.clearHistory(),true);assert.equal(d.bike.state.history.length,0);
  assert.equal(JSON.stringify(d.bike.state.settings),settings);assert.equal(d.map.get('bike-cardio.v1.remote'),config);
  assert.equal(JSON.parse(d.map.get('bike-cardio.v1.before-remote-restore')).history[0].id,'old');assert.equal(d.bike.remote.remoteSyncPaused(),true);
  const active=vm.runInContext("WorkoutCore.create({},Date.now(),'active')",d.ctx);d.bike.write('bike-cardio.active.v1',active);await assert.rejects(d.bike.clearHistory(),/Finish or end/);
});

function probeStore(d,{ignoreConditions=false,denyDelete=false,ignoreDelete=false,ignoreUpdate=false,hideETag=false}={}){
  const objects=new Map(),calls=[];let revision=0;
  d.ctx.fetch=async(url,options)=>{
    const key=decodeURIComponent(new URL(url).pathname).split('/').slice(2).join('/'),old=objects.get(key);
    calls.push({key,method:options.method,headers:options.headers,url});
    if(options.method==='GET')return old?new Response(old.raw,{headers:hideETag?{}:{etag:old.etag}}):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
    if(options.method==='DELETE'){
      if(denyDelete)return new Response('<Error><Code>AccessDenied</Code></Error>',{status:403});
      if(!ignoreDelete)objects.delete(key);return new Response('',{status:200});
    }
    if(!ignoreConditions&&(options.headers['if-none-match']==='*'&&old||options.headers['if-match']&&options.headers['if-match']!==old?.etag))return new Response('<Error><Code>PreconditionFailed</Code></Error>',{status:412});
    if(!(ignoreUpdate&&old))objects.set(key,{raw:options.body,etag:'"'+(++revision)+'"'});
    return new Response('');
  };
  return {objects,calls};
}
test('provider checks verify conditional create/update and clean up only a disposable probe',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg,objectKey:'real-backup.json'});
  const store=probeStore(d),before=JSON.stringify(d.bike.state),report=await d.bike.remote.remoteCheckProvider();
  assert.equal(report.compatible,true);assert.equal(report.cleanup,'passed');assert.equal(report.matchedWrite,'passed');
  assert.equal(store.objects.size,0);assert.ok(store.calls.every(call=>call.key.startsWith('real-backup.json.checks/')));
  assert.equal(JSON.stringify(d.bike.state),before);assert.equal(d.bike.remote.remoteSyncPaused(),false);
  const writes=store.calls.filter(call=>call.method==='PUT');assert.equal(writes.length,4);assert.equal(writes[0].headers['if-none-match'],'*');
});
test('a provider ignoring write conditions is detected and remains blocked after reload',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg});probeStore(d,{ignoreConditions:true});
  const report=await d.bike.remote.remoteCheckProvider();assert.equal(report.ifNoneMatch,'failed');assert.equal(report.ifMatch,'failed');assert.equal(report.compatible,false);
  assert.equal(d.bike.remote.remoteSyncPaused(),true);
  await assert.rejects(d.bike.remote.s3Request(cfg,'PUT','{}',{headers:{'if-none-match':'*'}},{generation:d.bike.remote.generation,allowPaused:true,candidate:true}),/failed overwrite/);
  const re=setup(d.map);assert.equal(re.bike.remote.remoteTools().report.ifMatch,'failed');
  assert.equal(re.bike.remote.remoteSyncPaused(),true);
  probeStore(re);const fixed=await re.bike.remote.remoteCheckProvider();assert.equal(fixed.compatible,true);assert.equal(re.bike.remote.remoteSyncPaused(),true);
});
test('missing ETag and pretend updates cannot produce a passing provider report',async()=>{
  for(const options of [{hideETag:true},{ignoreUpdate:true}]){
    const d=setup();d.bike.remote.saveRemoteConfig({...cfg});probeStore(d,options);
    const report=await d.bike.remote.remoteCheckProvider();assert.equal(report.compatible,false);assert.equal(d.bike.remote.remoteSyncPaused(),true);
    if(options.hideETag)assert.equal(report.etag,'failed');else assert.equal(report.matchedWrite,'failed');
  }
});
test('cleanup denied or ignored reports leftover keys instead of claiming deletion',async()=>{
  for(const options of [{denyDelete:true},{ignoreDelete:true}]){
    const d=setup();d.bike.remote.saveRemoteConfig({...cfg});const store=probeStore(d,options);
    const report=await d.bike.remote.remoteCheckProvider();assert.equal(report.compatible,true);assert.equal(report.cleanup,'failed');assert.equal(report.remainingProbeKeys.length,1);
    assert.equal(store.objects.has(report.remainingProbeKeys[0]),true);assert.match(report.cleanupMessage,/DELETE/);
  }
});
test('network, bucket and credential diagnostics are useful without leaking server messages or credentials',async()=>{
  for(const [category,response]of [
    ['bucket',()=>new Response('<Error><Code>NoSuchBucket</Code><Message>synthetic fake Authorization PRIVATE</Message></Error>',{status:404})],
    ['credentials',()=>new Response('<Error><Code>AccessDenied</Code><Message>No such key: rejected-key synthetic fake</Message></Error>',{status:403})],
    ['credentials',()=>new Response('<Error><Code>AccessDenied</Code><Message>Forbidden: Invalid signature</Message><Resource>synthetic fake Authorization PRIVATE</Resource></Error>',{status:403})],
    ['permissions',()=>new Response('<Error><Code>AccessDenied</Code><Message>Forbidden: Access denied. synthetic fake Authorization PRIVATE</Message></Error>',{status:403})],
    ['network-or-cors',()=>{throw new TypeError('synthetic fake Authorization PRIVATE');}],
  ]){
    const d=setup();d.bike.remote.saveRemoteConfig({...cfg,endpoint:'https://storage.example.org'});d.ctx.fetch=response;
    await d.bike.remote.remoteTestConnection();const result=d.bike.remote.diagnosticsPayload();assert.equal(result.lastError.category,category);
    assert.doesNotMatch(JSON.stringify(result),/synthetic|fake|Authorization|PRIVATE|rejected-key|secretAccessKey|accessKeyId/);
    if(category==='network-or-cors')assert.match(result.lastError.message,/network access/);
  }
});
test('changing configuration mid-check aborts old probe work and cannot attach results to the new destination',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg});let release,started;
  const entered=new Promise(resolve=>{started=resolve;});d.ctx.fetch=async()=>{started();await new Promise(resolve=>{release=resolve;});return new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});};
  const pending=d.bike.remote.remoteCheckProvider();await entered;d.bike.remote.saveRemoteConfig({...cfg,bucket:'other'});release();
  await assert.rejects(pending,/changed/);assert.equal(d.bike.remote.remoteTools().report,null);assert.equal(d.bike.remote.loadRemoteConfig().bucket,'other');
});

test('snapshot restore preserves local recovery and pauses sync without changing the cloud backup',async()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);d.bike.remote.saveRemoteConfig({...cfg,objectKey:'backup.json'});
  const snapshot=d.bike.backup();snapshot.history[0].metrics.notes='older cloud';snapshot.updatedAt=1;
  const calls=[];d.ctx.fetch=async(url,options)=>{calls.push({url,method:options.method});return new Response(JSON.stringify(snapshot),{headers:{etag:'"snapshot"'}});};
  assert.equal(await d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/older.json'),true);
  assert.equal(d.bike.state.history[0].metrics.notes,'older cloud');assert.equal(d.bike.remote.remoteSyncPaused(),true);
  assert.equal(JSON.parse(d.map.get('bike-cardio.v1.before-remote-restore')).history[0].metrics.notes,'original');
  assert.ok(calls.every(call=>call.method==='GET'&&call.url.endsWith('/backup.json.snapshots/older.json')));
});
test('snapshot cancellation, changing remote contents and local edits during review retain prior data',async()=>{
  for(const mode of ['cancel','remote-change','local-edit','quota']){
    const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);d.bike.remote.saveRemoteConfig({...cfg,objectKey:'backup.json'});
    const snapshot=d.bike.backup();snapshot.history[0].metrics.notes='snapshot';let reads=0;
    d.ctx.fetch=async()=>{reads++;return new Response(JSON.stringify(snapshot),{headers:{etag:mode==='remote-change'&&reads>1?'"changed"':'"same"'}});};
    d.ctx.confirmBike=async()=>{if(mode==='local-edit')d.bike.write('bike-cardio.settings.v1',{...d.bike.state.settings,bikeId:'new'});return mode!=='cancel';};
    if(mode==='quota')d.ctx.localStorage.setItem=(key,value)=>{if(key==='bike-cardio.state.v1')throw Error('quota');d.map.set(key,String(value));};
    if(mode==='cancel')assert.equal(await d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/older.json'),false);
    else await assert.rejects(d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/older.json'),/changed|could not be saved/);
    assert.equal(d.bike.state.history[0].metrics.notes,'original');assert.equal(d.bike.remote.remoteSyncPaused(),true);
  }
});
test('snapshots outside this backup prefix or containing invalid backups never replace local rides',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg,objectKey:'backup.json'});let calls=0;
  d.ctx.fetch=async()=>{calls++;return new Response(JSON.stringify({app:'liftlog',version:14}),{headers:{etag:'"same"'}});};
  await assert.rejects(d.bike.remote.remoteRestoreSnapshot('other.json.snapshots/file.json'),/outside/);assert.equal(calls,0);
  await assert.rejects(d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/../file.json'),/Invalid object path/);assert.equal(calls,0);
  await assert.rejects(d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/file.json'),/Invalid backup/);assert.equal(d.bike.state.history.length,0);
  const active=vm.runInContext("WorkoutCore.create({},Date.now(),'active')",d.ctx);d.bike.write('bike-cardio.active.v1',active);
  const before=calls;await assert.rejects(d.bike.remote.remoteRestoreSnapshot('backup.json.snapshots/file.json'),/Finish or end/);assert.equal(calls,before);
});

test('an inconclusive recheck cannot erase a previously proven overwrite-protection failure',async()=>{
  const d=setup();d.bike.remote.saveRemoteConfig({...cfg});probeStore(d,{ignoreConditions:true});await d.bike.remote.remoteCheckProvider();
  d.ctx.fetch=async()=>{throw new TypeError('offline');};const report=await d.bike.remote.remoteCheckProvider();
  assert.equal(report.ifMatch,'unknown');assert.equal(report.overwriteProtection,'failed');assert.match(report.protectionMessage,/not been reverified/);
  await assert.rejects(d.bike.remote.s3Request(cfg,'PUT','{}',{headers:{'if-none-match':'*'}},{generation:d.bike.remote.generation,allowPaused:true,candidate:true}),/failed overwrite/);
});

test('a failed provider check in another tab supersedes this tab’s earlier passing result',async()=>{
  const a=setup();a.bike.remote.saveRemoteConfig({...cfg});probeStore(a);await a.bike.remote.remoteCheckProvider();
  const b=setup(a.map);probeStore(b,{ignoreConditions:true});await b.bike.remote.remoteCheckProvider();
  assert.equal(a.bike.remote.remoteTools().report.ifMatch,'failed');
  await assert.rejects(a.bike.remote.s3Request(cfg,'PUT','{}',{headers:{'if-none-match':'*'}},{generation:a.bike.remote.generation,candidate:true,allowPaused:true}),/failed overwrite/);
});

test('Automatic separate-file mode retains both devices’ independent backups despite ignored write conditions',async()=>{
  const first=setup(),second=setup(),store=probeStore(first,{ignoreConditions:true});second.ctx.fetch=first.ctx.fetch;
  const automatic={...cfg,syncMode:'auto'};
  first.bike.write('bike-cardio.history.v1',[legacyRecord()]);second.bike.write('bike-cardio.history.v1',[{...legacyRecord(),id:'second',metrics:{notes:'second device'}}]);
  first.bike.remote.saveRemoteConfig(automatic);second.bike.remote.saveRemoteConfig(automatic);
  const original=JSON.stringify(first.bike.backup());store.objects.set('bike-cardio-backup.json',{raw:original,etag:'"legacy"'});
  await Promise.all([first.bike.remote.remoteBackup(),second.bike.remote.remoteBackup()]);
  const backups=[...store.objects].filter(([key])=>key.includes('.snapshots/'));
  assert.equal(backups.length,2);assert.equal(new Set(backups.map(([key])=>key)).size,2);
  assert.deepEqual(backups.map(([,entry])=>JSON.parse(entry.raw).history[0].id).sort(),['old','second']);
  assert.equal(store.objects.get('bike-cardio-backup.json').raw,original);assert.ok(store.calls.every(c=>c.key.includes('.snapshots/')));
  assert.equal(first.bike.remote.readRemoteWork().pending,false);assert.equal(first.bike.configPayload().syncMode,'immutable');
  await assert.rejects(first.bike.remote.s3Request(automatic,'PUT','{}',{headers:{'if-none-match':'*'}}),/newly generated/);
});
test('Provider checks report unsupported conditions without blocking separate backups; explicit legacy restore stays paused',async()=>{
  const d=setup(),store=probeStore(d,{ignoreConditions:true});d.bike.remote.saveRemoteConfig({...cfg,syncMode:'auto'});
  d.bike.write('bike-cardio.history.v1',[legacyRecord()]);const legacy=d.bike.backup();legacy.history[0].metrics.notes='legacy cloud';
  store.objects.set('bike-cardio-backup.json',{raw:JSON.stringify(legacy),etag:'"legacy"'});
  const report=await d.bike.remote.remoteCheckProvider();assert.equal(report.ifMatch,'failed');assert.equal(report.ifNoneMatch,'failed');assert.equal(report.compatible,true);assert.equal(report.mode,'immutable');
  const before=JSON.stringify(d.bike.state);store.calls.length=0;await d.bike.remote.remoteStartupSync();assert.equal(JSON.stringify(d.bike.state),before);assert.equal(store.calls.length,0);
  await d.bike.remote.remoteBackup();assert.ok(store.calls.some(c=>c.method==='PUT'&&c.key.includes('.snapshots/')));
  await d.bike.remote.remoteRestoreLegacy();assert.equal(d.bike.state.history[0].metrics.notes,'legacy cloud');assert.equal(d.bike.remote.remoteSyncPaused(),true);
  assert.equal(JSON.parse(d.map.get('bike-cardio.v1.before-remote-restore')).history[0].metrics.notes,'original');
  store.calls.length=0;await d.bike.remote.remoteResumeSync();assert.equal(d.bike.remote.remoteSyncPaused(),false);assert.ok(store.calls.every(c=>c.key.includes('.snapshots/')));
});
test('immutable retries never overwrite an earlier upload and failed read-back does not claim success',async()=>{
  const d=setup(),store=probeStore(d);d.bike.remote.saveRemoteConfig({...cfg,syncMode:'immutable'});d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  const normal=d.ctx.fetch;let fail=true;d.ctx.fetch=(url,options)=>fail&&options.method==='GET'?Promise.resolve(new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404})):normal(url,options);
  await d.bike.remote.remoteBackup();assert.equal(d.bike.remote.readRemoteWork().pending,true);assert.equal(d.bike.remote.loadRemoteConfig().lastBackupAt,undefined);
  fail=false;await d.bike.remote.remoteBackup();assert.equal(store.objects.size,2);assert.equal(d.bike.remote.readRemoteWork().pending,false);
});

test('version 1 Bike backups migrate without reinterpreting old rides; version 2 preserves custom targets',()=>{
  const d=setup(),old={app:'bike-cardio',version:1,updatedAt:1,settings:{},history:[legacyRecord()],active:null};
  const candidate=d.bike.prepare(old);assert.equal(candidate.version,3);assert.equal(candidate.updatedAt,old.updatedAt);assert.equal(candidate.history[0].config.targets.zoneMin,105);assert.equal(candidate.history[0].config.mainMinutes,25);
  const newer=structuredClone(candidate);newer.history[0].config.targets={zoneMin:120,adjustBelow:123,targetMin:125,comparisonHR:130,targetMax:135,zoneMax:140};newer.history[0].config.mainMinutes=40;
  const prepared=d.bike.prepare(newer);assert.equal(prepared.history[0].config.targets.comparisonHR,130);assert.equal(prepared.history[0].config.mainMinutes,40);
  assert.equal(d.bike.backup().version,3);assert.equal(d.bike.historyPayload().version,3);assert.throws(()=>d.bike.prepare({...newer,version:4}),/version 1, 2 or 3/);
});
test('switching an existing connection to automatic mode creates a separate backup even at the former sync baseline',async()=>{
  const d=setup(),store=probeStore(d,{ignoreConditions:true});d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  d.bike.remote.saveRemoteConfig({...cfg,syncMode:'auto',lastUploadedModifiedAt:d.bike.state.updatedAt});await d.bike.remote.remoteStartupSync();
  assert.equal(d.bike.remote.readRemoteWork().pending,true);await d.bike.remote.remoteBackup();assert.equal(store.objects.size,1);assert.equal(d.bike.remote.loadRemoteConfig().lastBackupMode,'immutable');
  await d.bike.remote.remoteStartupSync();assert.equal(d.bike.remote.readRemoteWork().pending,false);
});

test('Bike presets and machine profiles roundtrip backups without changing older rides',()=>{
 const d=setup(),backup=d.bike.backup();backup.history=[legacyRecord()];backup.presets=[{id:'p',name:'Steady ride',config:{mode:'zone2',mainMinutes:40,bikeId:'bike-a',voice:false}}];backup.machines=[{id:'m',name:'Bike A',bike:'matrix',bikeId:'bike-a'}];
 const normalized=d.bike.prepare(backup);assert.equal(normalized.presets[0].config.mainMinutes,40);assert.equal(normalized.history[0].config.mainMinutes,25);assert.equal(normalized.machines[0].bikeId,'bike-a');
 assert.deepEqual(d.bike.prepare(normalized),normalized);
 backup.presets.push(backup.presets[0]);assert.throws(()=>d.bike.prepare(backup),/Invalid saved presets/);backup.presets=[];backup.machines[0].bikeId='';assert.throws(()=>d.bike.prepare(backup),/machine profile/);
 delete backup.machines;delete backup.presets;assert.equal(d.bike.prepare(backup).presets.length,0);
});

test('documented sprint v2 and external v3 files merge losslessly, preserve local rides and deduplicate',async()=>{
  const d=setup();d.bike.write('bike-cardio.history.v1',[legacyRecord()]);
  for(const file of ['bike-history-sprint-v2.json','bike-history-external-v3.json']){
    const payload=JSON.parse(fs.readFileSync(path.join(root,'examples',file),'utf8'));
    const result=await d.bike.mergeHistory(payload);assert.equal(result.added,payload.history.length);assert.equal(result.invalid,0);
    const repeat=await d.bike.mergeHistory(payload);assert.equal(repeat.added,0);assert.equal(repeat.already,payload.history.length);
  }
  assert.equal(d.bike.state.history.length,4);assert.equal(d.bike.state.history.find(r=>r.id==='old').metrics.notes,'original');
  const video=d.bike.state.history.find(r=>r.id==='example-follow-along-video');assert.equal(video.config.mode,'external');assert.equal(video.config.bike,'unknown');assert.equal(video.config.context,'unknown');
  const backup=d.bike.prepare(d.bike.backup());assert.equal(backup.version,3);assert.deepEqual(JSON.parse(JSON.stringify(backup.history.find(r=>r.id===video.id).metrics)),JSON.parse(JSON.stringify(video.metrics)));
  const reload=setup(d.map);assert.equal(reload.bike.state.history.length,4);assert.equal(reload.bike.historyPayload().version,3);
});
test('external aggregates allow zero sample count and free source text without claiming a raw recording',()=>{
  const d=setup(),ride=legacyRecord();ride.config={mode:'sprint'};ride.mainMs=0;ride.phases=[{title:'Whole session',kind:'external',outcome:'complete',ms:ride.activeMs}];
  ride.hr={source:'Polar Flow (imported)',averageHR:128,zoneMs:600000,measuredMs:ride.activeMs,coverage:100,samples:0};
  const prepared=d.bike.prepare({...d.bike.backup(),history:[ride]}).history[0];
  assert.equal(prepared.hr.samples,0);assert.equal(prepared.hr.source,'Polar Flow (imported)');assert.equal(prepared.config.bike,'unknown');assert.equal(prepared.phases.length,1);assert.equal(prepared.recording,undefined);
  for(const field of ['peakWatts','maxCadence','maxResistance','kcal','distanceKm','inclineAvgPct','inclineMaxPct']){
    assert.throws(()=>d.bike.prepare({...d.bike.backup(),history:[{...ride,metrics:{[field]:'12'}}]}),new RegExp(field));
  }
  for(const metrics of [{polarZonesMs:{z6:1}},{polarZonesMs:{z1:-1}},{trainingBenefit:12},{externalSource:12}])assert.throws(()=>d.bike.prepare({...d.bike.backup(),history:[{...ride,metrics}]}));
  assert.throws(()=>d.bike.prepare({...d.bike.backup(),history:[{...ride,config:{mode:'sprint',bike:''}}]}),/recorded bike/);
});
test('external or unclassified rides never imply a shared workout progression series',()=>{
  const d=setup(),history=vm.runInContext('BikeHistory',d.ctx);
  const [external]=d.bike.prepare({...d.bike.backup(),history:[{...legacyRecord(),config:{mode:'external'}}]}).history;
  const other={...external,id:'another'};
  assert.notEqual(history.seriesKey(external),history.seriesKey(other));assert(history.compare(external,other).rows.every(row=>row.delta===null));
  const partial=d.bike.prepare({...d.bike.backup(),history:[{...legacyRecord(),config:{mode:'zone2',bike:'unknown',context:'fresh'}}]}).history[0];
  assert.notEqual(history.seriesKey(partial),history.seriesKey({...partial,id:'other'}));
});
