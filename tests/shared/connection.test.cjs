// One cloud connection for every app on the site: two apps' engines on one storage map.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const SHARED='wellbeing.connection.v1';
const cfg={endpoint:'https://storage.test',region:'test',bucket:'apps',pathStyle:true,accessKeyId:'fake',secretAccessKey:'synthetic',syncMode:'immutable'};
function site(entries=[]){
  const map=new Map(entries),writes=[],listeners=[],refreshes={tabata:0,foodlog:0};
  const ctx={console,URL,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,navigator:{onLine:false},location:{protocol:'https:',hostname:'apps.test'},
    localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>{writes.push(k);map.set(k,String(v));},removeItem:k=>map.delete(k)},
    setTimeout:()=>0,clearTimeout:()=>{},addEventListener:(type,fn)=>{if(type==='storage')listeners.push(fn);}};
  ctx.window=ctx;vm.createContext(ctx);
  for(const file of ['packages/storage-engine/local.js','packages/storage-engine/remote.js','packages/storage-ui/connection.js','apps/tabata/timer-core.js','apps/tabata/storage-adapter.js','packages/app-ui/markdown.js','apps/foodlog/food-core.js','apps/foodlog/storage-adapter.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
  ctx.refreshes=refreshes;
  const options=name=>`{toast:()=>{},confirm:async()=>true,onLocalStatus:()=>{},onRemoteStatus:()=>{},onBusy:()=>{},onRefresh:()=>{refreshes.${name}++;},onRestore:()=>{}}`;
  const make=()=>({tabata:vm.runInContext(`TabataStorage.create(${options('tabata')})`,ctx).remote,foodlog:vm.runInContext(`FoodlogStorage.create(${options('foodlog')})`,ctx).remote});
  return {map,writes,listeners,refreshes,ctx,make,record:key=>JSON.parse(map.get(key)),describe:remote=>ctx.WorkoutStorage.describeConnection(remote)};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('a connection saved in one app serves every app, each with its own backup path',()=>{
  const s=site(),{tabata,foodlog}=s.make();
  assert.equal(tabata.connectionScope(),'none');assert.match(s.describe(foodlog).text,/^No connection yet\. The connection you save here is shared by every app/);
  tabata.saveRemoteConfig({...cfg,objectKey:'tabata-backup.json'});
  assert.deepEqual(s.record(SHARED),cfg,'the shared record holds the connection only');
  assert.deepEqual(Object.keys(s.record('tabata.v1.remote')).sort(),['historyFor','objectKey']);
  assert.equal(foodlog.connectionScope(),'shared');assert.deepEqual(plain(foodlog.loadRemoteConfig()),cfg);
  assert.equal(foodlog.defaultObjectKey,'foodlog-backup.json');
  assert.equal(s.describe(foodlog).text,'Shared connection: apps on storage.test. Every app on this site uses it, so saving it here changes it for all of them. This app backs up to foodlog-backup.json.');
  assert.equal(tabata.syncMode(foodlog.loadRemoteConfig()),'immutable','the backup mode is part of the shared connection');
});

test('backup history stays per app and follows the destination it describes',()=>{
  const s=site(),{tabata,foodlog}=s.make();
  tabata.saveRemoteConfig({...cfg});
  const before=s.writes.filter(k=>k===SHARED).length;
  tabata.saveRemoteConfig({...tabata.loadRemoteConfig(),lastBackupAt:5,lastUploadedModifiedAt:4,lastBackupMode:'immutable'});
  assert.equal(s.writes.filter(k=>k===SHARED).length,before,'an upload does not rewrite the unchanged shared connection');
  assert.equal(tabata.loadRemoteConfig().lastBackupAt,5);assert.equal(foodlog.loadRemoteConfig().lastBackupAt,undefined,'history is per app');
  foodlog.saveRemoteConfig({...cfg,bucket:'other'});
  assert.equal(tabata.loadRemoteConfig().bucket,'other');assert.equal(tabata.loadRemoteConfig().lastBackupAt,undefined,'history for the old bucket is hidden');
  foodlog.saveRemoteConfig({...cfg});
  assert.equal(tabata.loadRemoteConfig().lastBackupAt,5,'it returns with the original destination');
});

test('connections saved before sharing move to the shared record, or stay with an app when different',()=>{
  const s=site([['tabata.v1.remote',JSON.stringify({...cfg,objectKey:'t.json',lastBackupAt:9,lastUploadedModifiedAt:8})],
    ['foodlog.v1.remote',JSON.stringify({...cfg,bucket:'food',lastBackupAt:7})]]);
  const {tabata,foodlog}=s.make();
  assert.deepEqual(s.record(SHARED),cfg,'the first app seeds the shared connection');
  assert.equal(tabata.connectionScope(),'shared');assert.equal(tabata.loadRemoteConfig().lastBackupAt,9);assert.equal(tabata.loadRemoteConfig().objectKey,'t.json');
  assert.equal(foodlog.connectionScope(),'own');assert.equal(foodlog.loadRemoteConfig().bucket,'food');
  const info=s.describe(foodlog);assert.equal(info.canSwitch,true);assert.match(info.text,/its own connection.*food on storage\.test\. The other apps use apps on storage\.test\./);
  foodlog.saveRemoteConfig({...foodlog.loadRemoteConfig(),lastBackupAt:10});
  assert.deepEqual(s.record(SHARED),cfg,'saving an app’s own connection leaves the shared one alone');
  assert.equal(foodlog.useSharedConnection(),true);
  assert.equal(foodlog.connectionScope(),'shared');assert.equal(foodlog.loadRemoteConfig().bucket,'apps');assert.equal(foodlog.loadRemoteConfig().lastBackupAt,undefined,'history for its old bucket does not carry over');
  assert.ok(s.refreshes.foodlog>0);
  const same=site([['tabata.v1.remote',JSON.stringify(cfg)],['foodlog.v1.remote',JSON.stringify({...cfg,objectKey:'f.json'})]]);same.make();
  assert.equal(JSON.parse(same.map.get('foodlog.v1.remote')).bucket,undefined,'a matching connection is dropped from the app record');
});

test('saving a new connection from an app with its own connection makes it the shared one',()=>{
  const s=site([['wellbeing.connection.v1',JSON.stringify(cfg)],['foodlog.v1.remote',JSON.stringify({...cfg,bucket:'food'})]]);
  const {tabata,foodlog}=s.make();
  foodlog.saveRemoteConfig({...cfg,bucket:'new'});
  assert.equal(foodlog.connectionScope(),'shared');assert.equal(tabata.loadRemoteConfig().bucket,'new');
});

test('forgetting the shared connection ends it for every app; forgetting an own connection returns to the shared one',()=>{
  const s=site(),{tabata,foodlog}=s.make();
  tabata.saveRemoteConfig({...cfg});foodlog.saveRemoteConfig({...foodlog.loadRemoteConfig(),objectKey:'food.json',lastBackupAt:3});
  assert.match(s.ctx.WorkoutStorage.forgetConnectionText(tabata).body,/for every app on this site/);
  tabata.clearRemoteConfig();
  assert.equal(s.map.has(SHARED),false);assert.equal(s.map.has('tabata.v1.remote'),false);
  assert.equal(foodlog.loadRemoteConfig(),null);assert.equal(JSON.parse(s.map.get('foodlog.v1.remote')).objectKey,'food.json','other apps keep their path');
  tabata.saveRemoteConfig({...cfg});
  assert.equal(foodlog.loadRemoteConfig().lastBackupAt,3,'its history returns with the same destination');
  s.map.set('foodlog.v1.remote',JSON.stringify({...cfg,bucket:'own'}));
  assert.match(s.ctx.WorkoutStorage.forgetConnectionText(foodlog).title,/own connection/);
  foodlog.clearRemoteConfig();
  assert.equal(s.map.has(SHARED),true);assert.equal(foodlog.loadRemoteConfig().bucket,'apps');
});

test('a storage event for the shared connection cancels requests and refreshes every app',()=>{
  const s=site(),{tabata,foodlog}=s.make();
  const before=[tabata.generation,foodlog.generation],refreshed={...s.refreshes};
  for(const fn of s.listeners)fn({key:'tabata.v1.remote'});
  assert.deepEqual([tabata.generation,foodlog.generation],before,'other keys are ignored');
  for(const fn of s.listeners)fn({key:SHARED});
  assert.deepEqual([tabata.generation,foodlog.generation],before.map(n=>n+1));
  assert.deepEqual([s.refreshes.tabata,s.refreshes.foodlog],[refreshed.tabata+1,refreshed.foodlog+1]);
});
