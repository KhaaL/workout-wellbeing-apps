// Check-in model and storage schema: validation, day keys, the merge window, severity steps, items and storage versions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
// Day keys depend on local time, so the tests fix one zone with a DST change.
process.env.TZ='Europe/Stockholm';
const context=vm.createContext({TextEncoder});
for(const file of ['packages/storage-engine/local.js','apps/checkin/checkin-core.js','apps/checkin/storage-adapter.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const C=vm.runInContext('CheckinCore',context),Store=vm.runInContext('CheckinStorage',context);
const plain=value=>JSON.parse(JSON.stringify(value));
const at=iso=>new Date(iso).getTime();
const fresh=()=>({settings:C.settings(),items:C.defaults(),entries:[]});
let n=0;const id=()=>'c'+(++n);
const backup=extra=>({app:'checkin',version:1,updatedAt:5,settings:{dayStart:'04:00',mergeMinutes:30},items:C.defaults(),entries:[],...extra});

test('defaults hold one mood and five symptoms, all on Today',()=>{
  const items=C.defaults();
  assert.deepEqual(plain(items.map(i=>i.kind)),['mood','symptom','symptom','symptom','symptom','symptom']);
  assert.ok(items.every(i=>i.pinned&&!i.archived));
});

test('the day changes at the configured time, across a DST change',()=>{
  assert.equal(C.dayFor(at('2026-03-29T01:30:00+01:00')),'2026-03-28','before 04:00 counts toward the evening before');
  assert.equal(C.dayFor(at('2026-03-29T04:00:00+02:00')),'2026-03-29');
  assert.equal(C.dayFor(at('2026-03-29T03:30:00+02:00'),'03:00'),'2026-03-29');
  assert.equal(C.shiftDate('2026-03-29',-1),'2026-03-28');assert.equal(C.shiftDate('2026-10-25',1),'2026-10-26');
});

test('taps inside the merge window edit one check-in, later taps start another',()=>{
  const s=fresh(),t0=at('2026-01-20T09:00:00+01:00');
  C.setValue(s,'mood',3,t0,id);C.setValue(s,'headache',1,t0+29*60000,id);
  assert.equal(s.entries.length,1);assert.deepEqual(plain(s.entries[0].values),{mood:3,headache:1});
  assert.equal(s.entries[0].at,t0,'the start time stays');
  C.setValue(s,'mood',4,t0+30*60000,id);
  assert.equal(s.entries.length,2,'the window ends at exactly 30 minutes');
  assert.equal(C.current(s,t0+31*60000).id,s.entries[1].id);
  s.settings.mergeMinutes=0;assert.equal(C.current(s,t0+30*60000),null,'0 minutes makes every tap a new check-in');
});

test('the merge window never crosses the day change',()=>{
  const s=fresh(),t0=at('2026-01-20T03:50:00+01:00');
  C.setValue(s,'mood',2,t0,id);C.setValue(s,'mood',3,t0+15*60000,id);
  assert.deepEqual(plain(s.entries.map(e=>e.day)),['2026-01-19','2026-01-20']);
});

test('clearing the last value removes the check-in, and clearing with none open does nothing',()=>{
  const s=fresh(),t0=at('2026-01-20T09:00:00+01:00');
  C.setValue(s,'mood',3,t0,id);assert.equal(C.setValue(s,'mood',null,t0+1000,id),null);
  assert.equal(s.entries.length,0);
  assert.equal(C.setValue(s,'mood',null,t0+2000,id),null);assert.equal(s.entries.length,0);
  C.setNote(s,'  slept badly ',t0,id);assert.equal(s.entries[0].note,'slept badly');
  C.setNote(s,'',t0+1000,id);assert.equal(s.entries.length,0,'a note-only check-in goes with its note');
});

test('a symptom steps off, mild, moderate, severe, off',()=>{
  const steps=[];let v=null;for(let i=0;i<4;i++){v=C.nextSeverity(v);steps.push(v);}
  assert.deepEqual(steps,[1,2,3,null]);
  assert.deepEqual(plain(C.SEVERITY),['Mild','Moderate','Severe']);
});

test('values outside each kind’s range are refused',()=>{
  const s=fresh(),t=at('2026-01-20T09:00:00+01:00');
  for(const [item,value] of [['mood',0],['mood',6],['mood',2.5],['headache',4],['headache',0],['headache',true]])
    assert.throws(()=>C.setValue(s,item,value,t,id),/Invalid value/,item+' '+value);
  assert.throws(()=>C.setValue(s,'nope',1,t,id),/Unknown tracked item/);
  assert.equal(s.entries.length,0);
});

test('items: add, rename, archive and restore keep names unique among active items',()=>{
  const s=fresh();
  const it=C.addItem(s,{kind:'symptom',name:' Dizziness '},'s-1');assert.equal(it.name,'Dizziness');
  assert.throws(()=>C.addItem(s,{kind:'symptom',name:'headache'}),/already tracked/);
  assert.throws(()=>C.renameItem(s,'s-1','Fatigue'),/already tracked/);
  C.archiveItem(s,'headache',true);assert.deepEqual(plain(C.visible(s,'symptom').map(i=>i.id)),['fatigue','anxiety','low-mood','nausea','s-1']);
  const back=C.addItem(s,{kind:'symptom',name:'Headache'},'s-2');
  assert.equal(back.id,'headache','adding an archived name restores it, so history stays linked');assert.equal(back.archived,false);
  C.archiveItem(s,'s-1',true);C.addItem(s,{kind:'symptom',name:'Dizzy'},'s-3');C.renameItem(s,'s-3','Dizziness');
  assert.throws(()=>C.archiveItem(s,'s-1',false),/already tracked/,'restoring a name in use is refused');
});

test('descriptions list mood first, then symptoms by severity',()=>{
  const s=fresh(),t=at('2026-01-20T09:00:00+01:00');
  C.setValue(s,'fatigue',1,t,id);C.setValue(s,'headache',3,t,id);C.setValue(s,'mood',2,t,id);
  assert.equal(C.describe(s,s.entries[0]),'Mood 2 Low, Headache severe, Fatigue mild');
  C.renameItem(s,'headache','Migraine');assert.match(C.describe(s,s.entries[0]),/Migraine severe/,'history follows a rename');
});

test('days list latest first',()=>{
  const s=fresh();
  for(const iso of ['2026-01-18T09:00:00+01:00','2026-01-20T09:00:00+01:00','2026-01-20T21:00:00+01:00','2026-01-19T09:00:00+01:00'])C.setValue(s,'mood',3,at(iso),id);
  s.entries.sort((a,b)=>a.at-b.at);
  assert.deepEqual(plain(C.days(s)),['2026-01-20','2026-01-19','2026-01-18']);
  assert.equal(C.entriesFor(s,'2026-01-20').length,2);
});

test('storage prepare accepts version 1 and rebuilds known fields only',()=>{
  const raw=backup({entries:[{id:'b',at:2000,day:'2026-01-20',values:{mood:4},note:'',extra:1},{id:'a',at:1000,day:'2026-01-20',values:{headache:2}}],stray:true});
  const s=Store.prepare(raw);
  assert.deepEqual(plain(s.entries.map(e=>e.id)),['a','b'],'sorted by time');
  assert.equal('extra' in s.entries[1],false);assert.equal('stray' in s,false);assert.equal(s.entries[0].note,'');
  const numberItem={id:'sleep',kind:'number',name:'Sleep',unit:'h',min:0,max:14,step:0.5},tag={id:'coffee',kind:'tag',name:'Coffee'};
  const later=Store.prepare(backup({items:[...C.defaults(),numberItem,tag],entries:[{id:'x',at:1,day:'2026-01-20',values:{sleep:7.5,coffee:true}}]}));
  assert.deepEqual(plain(later.entries[0].values),{sleep:7.5,coffee:true},'number and tag items already validate');
});

test('storage prepare refuses newer versions, other apps and broken rows',()=>{
  assert.throws(()=>Store.prepare(backup({version:2})),/newer Check-in version/);
  assert.throws(()=>Store.prepare(backup({app:'foodlog'})),/Not a valid Check-in backup/);
  const bad=[
    [{entries:[{id:'a',at:1,day:'2026-01-20',values:{ghost:1}}]},/unknown item/],
    [{entries:[{id:'a',at:1,day:'2026-01-20',values:{mood:9}}]},/Invalid value for Mood/],
    [{entries:[{id:'a',at:1,day:'2026-01-20',values:{}}]},/no values/],
    [{entries:[{id:'a',at:1,day:'20 Jan',values:{mood:1}}]},/Invalid check-in day/],
    [{entries:[{id:'a',at:1,day:'2026-01-20',values:{mood:1}},{id:'a',at:2,day:'2026-01-20',values:{mood:2}}]},/Duplicate check-in id/],
    [{items:[...C.defaults(),{id:'x',kind:'symptom',name:'headache'}]},/share the name/],
    [{items:[{id:'m',kind:'feeling',name:'Mood'}]},/Unknown tracked item kind/],
    [{settings:{dayStart:'4am'}},/HH:MM/],
    [{settings:{mergeMinutes:500}},/0 to 240/]];
  for(const [extra,message] of bad)assert.throws(()=>Store.prepare(backup(extra)),message,JSON.stringify(extra));
});
