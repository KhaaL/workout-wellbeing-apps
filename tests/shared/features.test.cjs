const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
const {device:lift}=require('../../apps/liftlog/tests/remote-harness.cjs');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'dist/bike-cardio/index.html'),'utf8');
function bike(){
 const map=new Map(),ctx={console,URL,TextEncoder,TextDecoder,AbortController,Headers,Response,ReadableStream,Blob,crypto:webcrypto,navigator:{onLine:true},location:{protocol:'https:',hostname:'app.test'},localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)},setTimeout:()=>1,clearTimeout:()=>{}};
 ctx.window=ctx;vm.createContext(ctx);
 for(const id of ['heart-rate-core','workout-core'])vm.runInContext(html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1],ctx);
 vm.runInContext('globalThis.C=WorkoutCore;globalThis.historyTools=BikeHistory;globalThis.api=BikeStorage.create({core:WorkoutCore,heart:HeartRateCore,confirm:(...args)=>confirm(...args),onRestore:()=>{},onRemoteStatus:()=>{},onRefresh:()=>{},toast:()=>{}});',Object.assign(ctx,{confirm:async()=>true}));
 return {ctx,api:ctx.api,map};
}
const copy=value=>JSON.parse(JSON.stringify(value));
test('cached histories serialize once during repeated active saves; real edits and stale tabs remain protected',()=>{
 let serializations=0,writes=0,revision=0,changes=0;
 const history=Array.from({length:2000},(_,id)=>({id,toJSON(){serializations++;return {id,notes:'x'.repeat(100)};}}));
 const ctx={TextEncoder,setTimeout:()=>1,clearTimeout:()=>{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'packages/storage-engine/local.js'),'utf8'),ctx);
 const map=new Map(),state={history,active:{ms:0},revision:0},storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{writes++;map.set(k,v);}};
 const local=ctx.WorkoutStorage.createLocal({key:'data',cacheKeys:['history'],storage,seed:()=>state,prepare:v=>v,getState:()=>state,setState:()=>{},touch:()=>state.revision=++revision,onChange:()=>changes++});local.load();local.save({changed:['active'],immediate:true});
 assert.equal(serializations,2000);assert.equal(writes,1);assert.equal(revision,0);
 for(let i=0;i<20;i++){state.active.ms++;local.save({changed:['active'],immediate:true});}
 assert.equal(serializations,2000,'finished history was not re-encoded for active checkpoints');assert.equal(revision,20);
 const durable=map.get('data');local.save({changed:['active'],immediate:true});assert.equal(writes,21);assert.equal(changes,20);
 state.history.push({id:2000});local.save({changed:['history'],immediate:true});assert.equal(serializations,4000);assert.equal(JSON.parse(map.get('data')).history.length,2001);
 map.set('data',durable);state.active.ms++;assert.equal(local.save({changed:['active'],immediate:true}),false);assert.equal(map.get('data'),durable);
});
for(const app of ['bike-cardio','liftlog']){
 const setup=()=>{
  if(app==='bike-cardio'){const d=bike();d.api.write('bike-cardio.active.v1',d.ctx.C.create({},Date.now(),'transfer-workout'));return {...d,h:d.api.handoff,active:()=>d.api.state.active,history:()=>d.api.state.history};}
  const d=lift();d.api.state.activeWorkout=d.api.newWorkout(d.api.state.routines[0]);d.api.save({immediate:true});return {...d,map:d.storage,h:d.api.workoutHandoff,active:()=>d.api.state.activeWorkout,history:()=>d.api.state.workouts};
 };
 const receiver=()=>{const d=app==='bike-cardio'?bike():lift();return {...d,map:d.map||d.storage,h:app==='bike-cardio'?d.api.handoff:d.api.workoutHandoff,active:()=>app==='bike-cardio'?d.api.state.active:d.api.state.activeWorkout};};
 test(app+': file handoff pauses source, preserves recipient history, recovers and blocks duplicate/active receipt',async()=>{
  const source=setup(),target=receiver(),payload=await source.h.offer();assert(payload);assert(source.h.held());assert.equal(app==='bike-cardio'?source.active().status:source.active().timer.running,app==='bike-cardio'?'paused':false);
  assert.equal((payload.backup.history||payload.backup.workouts).length,0);assert.doesNotMatch(JSON.stringify(payload),/secretAccessKey|accessKeyId/);
  const active=copy(source.active());active.id='finished-on-recipient';
  if(app==='bike-cardio'){const s=target.ctx.C.create({},Date.now()-1000,active.id);target.ctx.C.end(s,Date.now());target.api.write('bike-cardio.history.v1',[target.ctx.C.record(s)]);}
  else{active.finishedAt=active.startedAt+1000;active.timer=null;target.api.state.workouts=[active];target.api.state=target.api.prepareBackup(target.api.state);target.api.save({immediate:true});}
  const before=JSON.stringify(app==='bike-cardio'?target.api.state.history:target.api.state.workouts);
  assert.equal(await target.h.receive(copy(payload)),true);assert.equal(target.active().id,payload.workoutId);
  assert.equal(JSON.stringify(app==='bike-cardio'?target.api.state.history:target.api.state.workouts),before);
  assert(target.map.has(app==='bike-cardio'?'bike-cardio.v1.before-remote-restore':'liftlog.v1.before-remote-restore'));
  await assert.rejects(target.h.receive(payload),/saved workout/);
  if(app==='bike-cardio')target.api.write('bike-cardio.active.v1',null);else{target.api.state.activeWorkout=null;target.api.save({immediate:true});}
  await assert.rejects(target.h.receive(payload),/already been received/);
  await source.h.cancel();assert.equal(source.h.held(),null);assert.equal(app==='bike-cardio'?source.active().status:source.active().timer.running,app==='bike-cardio'?'paused':false);
 });
 test(app+': cancelled, raced, wrong-app and quota-failed receives preserve recipient data',async()=>{
  const source=setup(),target=receiver(),payload=await source.h.offer(),before=JSON.stringify(target.api.state);
  await assert.rejects(target.h.receive({...copy(payload),app:'other'}),/handoff file/);
  if(app==='bike-cardio')target.ctx.confirm=async()=>false;else target.api.confirm=async()=>false;
  assert.equal(await target.h.receive(payload),false);assert.equal(JSON.stringify(target.api.state),before);
  const mutate=async()=>{if(app==='bike-cardio')target.api.state.settings.voice=false;else target.api.state.settings.defaultRest++;return true;};
  if(app==='bike-cardio')target.ctx.confirm=mutate;else target.api.confirm=mutate;
  await assert.rejects(target.h.receive(payload),/changed during review/);assert.equal(target.active(),null);
  if(app==='bike-cardio')target.ctx.confirm=async()=>true;else target.api.confirm=async()=>true;
  const stable=JSON.stringify(target.api.state);target.ctx.localStorage.setItem=(key,value)=>{if(key.endsWith('state.v1')||key==='liftlog.v1')throw Error('quota');target.map.set(key,String(value));};
  await assert.rejects(target.h.receive(payload),/could not be saved/);assert.equal(JSON.stringify(target.api.state),stable);
 });
 test(app+': cloud handoff uses distinct app prefix, verifies read-back, retries and never exposes credentials',async()=>{
  const source=setup(),target=receiver(),payload=await source.h.offer(),objects=new Map(),calls=[];
  const cfg={endpoint:'https://storage.test',region:'test',bucket:'test',pathStyle:true,objectKey:app+'.json',accessKeyId:'fake',secretAccessKey:'synthetic',syncMode:'immutable'};
  const attach=d=>{(app==='bike-cardio'?d.api.remote:d.api.remoteEngine).saveRemoteConfig(copy(cfg));d.ctx.fetch=async(url,options)=>{calls.push([url,options.method]);if(options.method==='GET')return objects.has(url)?new Response(objects.get(url)):new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});assert.equal(options.headers['if-none-match'],'*');if(objects.has(url))return new Response('',{status:412});objects.set(url,options.body);return new Response('');};};attach(source);attach(target);
  assert.equal(await source.h.upload(payload),payload.id);assert.equal(await source.h.upload(payload),payload.id);assert.equal(objects.size,1);
  assert(calls.every(([url])=>new URL(url).pathname.startsWith('/test/'+app+'.json.handoffs/')));
  assert.equal(await target.h.receiveCode(payload.id),true);assert.equal(target.active().id,payload.workoutId);
  const count=calls.length;await assert.rejects(target.h.receiveCode('../other'),/valid handoff code/);assert.equal(calls.length,count);
  objects.set([...objects.keys()][0],'{}');await assert.rejects(source.h.upload(payload),/could not be verified/);
 });
}
test('Bike comparisons retain unknown readings and zero, withhold mismatched deltas and validate perceived effort',()=>{
 const d=bike(),a={id:'a',startedAt:1,config:d.ctx.C.config(),activeMs:60000,mainMs:30000,outcome:'complete',metrics:{averageWatts:'0'}},b={...copy(a),id:'b',startedAt:2,metrics:{averageWatts:'10',perceivedEffort:'7'}};
 const model=d.ctx.historyTools.compare(b,a);assert.equal(model.before.id,'a');assert.equal(model.rows[0].delta,10);assert.equal(model.rows[1].before,null);assert.equal(model.rows.at(-1).before,null);
 b.config.bikeId='other';assert.equal(d.ctx.historyTools.compare(a,b).rows[0].delta,null);
 const backup=d.api.backup(),s=d.ctx.C.create({},Date.now(),'record');d.ctx.C.end(s,Date.now());backup.history=[d.ctx.C.record(s)];backup.history[0].metrics={perceivedEffort:'11'};assert.throws(()=>d.api.prepare(backup),/perceivedEffort/);
});
test('Liftlog comparisons convert logged units, exclude warm-ups and preserve unknown durations',()=>{
 const d=lift(),a={id:'a',routineId:'r',routineName:'Routine',startedAt:1000,finishedAt:61000,exercises:[{exerciseId:'e',name:'Press',unit:'kg',sets:[{completed:true,reps:5,weight:20,unit:'kg'},{completed:true,reps:100,weight:100,unit:'kg',countForVolume:false}]}]},b=copy(a);b.id='b';b.startedAt=2000;b.finishedAt=null;b.exercises[0].unit='lb';b.exercises[0].sets=[{completed:true,reps:6,weight:44.0924524,unit:'lb'}];
 const options={canonical:x=>x,sameContract:d.api.sameProgressionContract,unit:'kg',sets:w=>w.exercises.reduce((n,ex)=>n+ex.sets.filter(s=>s.completed&&s.countForVolume!==false).length,0),volume:d.api.workoutVolume,duration:d.api.workoutDuration,load:d.api.setWeight};
 const model=d.api.LiftlogComparisons.compare(a,b,options);assert.equal(model.rows[0].before,1);assert.equal(model.rows[1].before,100);assert.equal(model.rows[2].after,null);assert.equal(model.rows[4].delta,1);assert(Math.abs(model.rows[5].delta)<0.001);
 b.exercises[0].loadMode='per_hand';assert.equal(d.api.LiftlogComparisons.compare(a,b,options).rows[1].delta,null);
});

test('an unchanged separate backup makes no new network requests or snapshot',async()=>{
 const d=bike(),cfg={endpoint:'https://storage.test',region:'test',bucket:'test',pathStyle:true,objectKey:'bike.json',accessKeyId:'fake',secretAccessKey:'synthetic',syncMode:'immutable'};
 d.api.local.save({immediate:true});d.api.remote.saveRemoteConfig(cfg);let raw,calls=0;
 d.ctx.fetch=async(url,options)=>{calls++;if(options.method==='PUT'){raw=options.body;return new Response('');}return new Response(raw,{headers:{etag:'"1"'}});};
 await d.api.remote.remoteBackup();const count=calls;assert.equal(count,2);await d.api.remote.remoteBackup();assert.equal(calls,count);
});
test('unreadable source holds protect active work without hiding backup/recovery access',async()=>{
 const d=bike();d.api.write('bike-cardio.active.v1',d.ctx.C.create({},Date.now(),'hold'));
 d.map.set('bike-cardio.v1.handoff-source','{broken');assert.equal(d.api.handoff.held().invalid,true);
 await assert.rejects(d.api.handoff.offer(),/could not be read/);assert(d.api.backup().active);
 await d.api.handoff.cancel();assert.equal(d.api.handoff.held(),null);assert.equal(d.api.state.active.status,'paused');
});
test('Liftlog compares each exercise with its own last session from any routine',()=>{
 const d=lift(),set=(weight,reps,extra={})=>({completed:true,reps,weight,unit:'kg',...extra});
 const block=(exerciseId,name,sets,extra={})=>({exerciseId,name,unit:'kg',loadMode:'total',sets,...extra});
 const workout=(id,routineId,startedAt,exercises)=>({id,routineId,routineName:'Routine '+routineId,startedAt,finishedAt:startedAt+60000,exercises});
 const older=workout('older','B',1000,[block('press','Press',[set(20,10,{countForVolume:false,countForPR:false}),set(50,8),set(50,7)])]);
 const perHand=workout('per-hand','C',2000,[block('press','Press',[set(25,8)],{loadMode:'per_hand'})]);
 const today=workout('today','A',3000,[block('press','Press',[set(52.5,8),set(52.5,6)]),block('row','Row',[set(40,10)])]);
 const options={canonical:x=>x,sameContract:d.api.sameProgressionContract,unit:'kg',load:d.api.setWeight,label:w=>w.id};
 const model=d.api.LiftlogComparisons.compareExercises(today,[today,perHand,older],options);
 assert.equal(model.before,null);
 const load=model.rows.find(row=>row.label==='Press · max logged load');
 assert.equal(load.beforeLabel,'older','a different load convention is skipped, a different routine is not');
 assert.equal(load.before,50);assert.equal(load.delta,2.5);assert.equal(load.highlight,true);
 assert.equal(model.rows.find(row=>row.label==='Press · working sets').before,2,'warm-ups stay out of the baseline');
 assert.match(model.details[0],/Row/);
 assert.equal(d.api.LiftlogComparisons.compareExercises(older,[today,perHand,older],options).rows.length,0,'later sessions never serve as a baseline');
 assert.equal(d.api.LiftlogComparisons.sharedExercises(today,older,x=>x),1);
 assert.equal(d.api.LiftlogComparisons.sharedExercises(today,workout('x','D',1,[block('squat','Squat',[])]),x=>x),0);
});
test('Liftlog estimates, day labels and load suggestions follow what was logged',()=>{
 const d=lift();
 assert.equal(d.api.epley(120,0),0,'a missed attempt estimates nothing');
 assert.equal(d.api.epley(100,null),100*(1+1/30),'a set without a count is one rep');
 const realNow=vm.runInContext('Date.now',d.ctx);
 vm.runInContext('Date.now=()=>'+new Date(2026,9,14,8,0).getTime(),d.ctx);
 assert.equal(d.api.relDays(new Date(2026,9,13,21,0).getTime()),'yesterday');
 assert.equal(d.api.relDays(new Date(2026,9,14,0,30).getTime()),'today');
 assert.equal(d.api.relDays(new Date(2026,9,11,23,0).getTime()),'3 days ago');
 d.ctx.realNow=realNow;vm.runInContext('Date.now=realNow',d.ctx);
 d.api.state.settings.unit='kg';d.api.state.settings.loadStep=1.25;
 const next=d.api.nextLoadFor({cue:{latest:{kind:'weighted',load:50,targetMax:12}},ex:{unit:'kg',loadMode:'total'},item:{repsMin:8}});
 assert.equal(next.next,'51.25 kg');assert.equal(next.last,'50 kg');
});
test('Liftlog seeds working sets from last time’s working sets in today’s unit and drops untouched rows on finish',()=>{
 const d=lift(),s=d.api.state;
 s.exercises.push({id:'bench',name:'Bench',category:'Push',unit:'kg',loadMode:'total',equipmentKey:'',movementFamily:'horizontal_push',archived:false,notes:'',url:''});
 s.workouts=[{id:'last',routineId:'r',routineName:'R',startedAt:Date.now()-86400000,finishedAt:Date.now()-86000000,exercises:[{exerciseId:'bench',name:'Bench',unit:'kg',loadMode:'total',sets:[
  {completed:true,reps:5,weight:40,unit:'kg',countForVolume:false,countForPR:false},{completed:true,reps:5,weight:100,unit:'kg'},{completed:true,reps:5,weight:90,unit:'kg'}]}]}];
 s.settings.unit='lb';
 const block=d.api.buildWorkoutExercise({exerciseId:'bench',sets:2});
 assert.equal(JSON.stringify(block.sets.map(x=>[x.weight,x.unit])),'[[220.46,"lb"],[198.42,"lb"]]','warm-up skipped, kg converted to lb');
 s.settings.unit='kg';
 const untouched=()=>({id:Math.random().toString(36),weight:100,reps:null,durationSeconds:null,completed:false,unit:'kg'});
 s.activeWorkout={id:'now',routineId:'',routineName:'Free',startedAt:Date.now()-60000,finishedAt:null,notes:'',currentExerciseIndex:0,timer:null,exercises:[
  {exerciseId:'bench',name:'Bench',unit:'kg',loadMode:'total',skipped:false,sets:[{...untouched(),reps:5,completed:true},untouched(),{...untouched(),reps:4}]},
  {exerciseId:'bench',name:'Bench',unit:'kg',loadMode:'total',skipped:false,sets:[untouched()]}]};
 d.ctx.scrollTo=()=>{};d.api.finishWorkout();
 const saved=s.workouts.find(w=>w.id==='now');
 assert.equal(saved.exercises.length,1,'an exercise never started is not saved');
 assert.equal(saved.exercises[0].sets.map(x=>x.reps).join(),'5,4','a seeded load alone is not a logged set');
});
test('Liftlog starts working sets at the suggested load once the prescription was met',()=>{
 const d=lift(),s=d.api.state;s.settings.unit='kg';s.settings.loadStep=2.5;
 s.exercises.push({id:'bench',name:'Bench',category:'Push',unit:'kg',loadMode:'total',equipmentKey:'',movementFamily:'horizontal_push',archived:false,notes:'',url:''});
 const set=(weight,reps)=>({completed:true,reps,weight,unit:'kg'});
 const last=(reps)=>({id:'last',routineId:'r',routineName:'R',startedAt:Date.now()-86400000,finishedAt:Date.now()-86000000,exercises:[{exerciseId:'bench',name:'Bench',unit:'kg',loadMode:'total',equipmentKey:'',plannedSets:3,targetRepsMin:8,targetRepsMax:10,targetRir:null,
  sets:[{completed:true,reps:5,weight:60,unit:'kg',countForVolume:false,countForPR:false},set(100,reps),set(100,reps),set(100,reps)]}]});
 const item={exerciseId:'bench',sets:3,repsMin:8,repsMax:10};
 const weights=()=>d.api.buildWorkoutExercise(item).sets.map(x=>x.weight).join();
 s.workouts=[last(10)];assert.equal(weights(),'102.5,102.5,102.5','top of the range met: next load');
 s.workouts=[last(9)];assert.equal(weights(),'100,100,100','range not met: same load');
 s.workouts=[last(10)];assert.equal(d.api.buildWorkoutExercise({...item,weight:90}).sets[0].weight,90,'a planned weight wins');
 s.progressionPreferences=[{exerciseId:'bench',loadCuesOff:true,dismissedExposureKey:''}];assert.equal(weights(),'100,100,100','suggestions turned off');
});
test('Liftlog rest comes from the exercise when it sets one, else from Settings',()=>{
 const d=lift(),s=d.api.state;s.settings.defaultRest=90;
 const def=(id,extra={})=>({id,name:id,category:'Legs',unit:'kg',loadMode:'total',equipmentKey:'',movementFamily:'squat',archived:false,notes:'',url:'',...extra});
 s.exercises.push(def('squat',{restSeconds:180}),def('curl'),def('dips',{restSeconds:120}));
 assert.equal(d.api.currentRestSeconds([{exerciseId:'squat'}]),180);
 assert.equal(d.api.currentRestSeconds([{exerciseId:'curl'}]),90);
 assert.equal(d.api.currentRestSeconds([{exerciseId:'curl'},{exerciseId:'dips'}]),120,'a superset round rests as long as its longest member');
 const backup=JSON.parse(JSON.stringify(s));backup.exercises.find(e=>e.id==='curl').restSeconds=5;backup.exercises.find(e=>e.id==='dips').restSeconds=0;
 const prepared=d.api.prepareBackup(backup);
 assert.equal(prepared.version,15);
 assert.equal(prepared.exercises.find(e=>e.id==='squat').restSeconds,180);
 assert.equal(prepared.exercises.find(e=>e.id==='curl').restSeconds,15,'clamped to the shortest rest');
 assert.equal('restSeconds' in prepared.exercises.find(e=>e.id==='dips'),false,'0 means use Settings');
 backup.exercises.find(e=>e.id==='curl').restSeconds='long';assert.throws(()=>d.api.prepareBackup(backup),/restSeconds/);
 const v14=JSON.parse(JSON.stringify(s));v14.version=14;v14.exercises.forEach(e=>delete e.restSeconds);assert.equal(d.api.prepareBackup(v14).version,15);
});
test('Liftlog swaps an exercise for this session and keeps its prescription',()=>{
 const d=lift(),s=d.api.state;s.settings.unit='kg';
 const def=(id,unit='kg')=>({id,name:id,category:'Push',unit,loadMode:'total',equipmentKey:'',movementFamily:'horizontal_push',archived:false,notes:'',url:''});
 s.exercises.push(def('bench'),def('incline'),def('plank','time'),def('row'));
 const row=()=>({id:Math.random().toString(36).slice(2),weight:100,reps:null,durationSeconds:null,completed:false,unit:'kg'});
 const block=(exerciseId,extra={})=>({exerciseId,name:exerciseId,unit:'kg',loadMode:'total',equipmentKey:'',movementFamily:'horizontal_push',plannedSets:4,targetRepsMin:6,targetRepsMax:8,targetRir:2,targetWeight:100,skipped:false,notes:'',sets:[row(),row(),row(),row(),row()],...extra});
 s.activeWorkout={id:'now',routineId:'r',routineName:'R',startedAt:Date.now(),finishedAt:null,notes:'',currentExerciseIndex:0,timer:null,exercises:[block('bench',{supersetOf:'k'}),block('row',{supersetOf:'k'})]};
 d.api.swapExercise(0,'incline');
 const swapped=s.activeWorkout.exercises[0];
 assert.equal(JSON.stringify([swapped.exerciseId,swapped.plannedSets,swapped.sets.length,swapped.targetRepsMin,swapped.targetRepsMax,swapped.targetRir,swapped.targetWeight,swapped.supersetOf]),
  JSON.stringify(['incline',4,5,6,8,2,null,'k']),'count, range, RIR and pairing kept; planned load dropped; the extra row stays');
 assert.equal(s.activeWorkout.exercises[1].exerciseId,'row');
 d.api.swapExercise(0,'row');assert.equal(s.activeWorkout.exercises[0].exerciseId,'incline','an exercise already in the session is refused');
 d.api.swapExercise(0,'plank');const timed=s.activeWorkout.exercises[0];
 assert.equal(JSON.stringify([timed.exerciseId,timed.targetRepsMin,timed.targetRepsMax,timed.targetRir]),JSON.stringify(['plank',30,30,null]),'seconds do not inherit a rep range');
 timed.sets[0].completed=true;assert.equal(d.api.canSwap(timed),false);
 d.api.swapExercise(0,'bench');assert.equal(s.activeWorkout.exercises[0].exerciseId,'plank','logged work is never relabelled');
});
test('Bike backups accept a measured HR trace and reject malformed ones',()=>{
 const d=bike(),backup=d.api.backup(),s=d.ctx.C.create({},Date.now(),'traced');d.ctx.C.end(s,Date.now());
 const ride=d.ctx.C.record(s);ride.hr={...ride.hr,trace:{binSeconds:5,bpm:'100,,115,121'},main:{averageHR:118,coverage:96,driftPct:2.5},recovery60:[25,null]};backup.history=[ride];
 assert.equal(d.api.prepare(backup).history[0].hr.trace.bpm,'100,,115,121');
 for(const [change,pattern] of [[r=>r.hr.trace.bpm='100,abc',/HR trace/],[r=>r.hr.trace.binSeconds=1,/HR trace/],[r=>r.hr.trace.bpm='100,900',/HR trace/],
  [r=>r.hr.main.averageHR=0,/Main-block HR/],[r=>r.hr.main.driftPct=500,/HR drift/],[r=>r.hr.recovery60=['x'],/HR recovery/]]){
  const bad=JSON.parse(JSON.stringify(backup));change(bad.history[0]);assert.throws(()=>d.api.prepare(bad),pattern);
 }
});
test('Bike backups accept measured power and reject malformed power',()=>{
 const d=bike(),backup=d.api.backup(),s=d.ctx.C.create({},Date.now(),'powered');d.ctx.C.end(s,Date.now());
 const ride=d.ctx.C.record(s);ride.power={source:'Bluetooth bike sensor',measuredMs:600000,coverage:95,averageWatts:140,peak5sWatts:180,trace:{binSeconds:5,watts:'140,,150',rpm:'90,,88'},main:{averageWatts:147.5,cadence:90,coverage:100,decouplingPct:3.2,fixedHRWatts:150}};backup.history=[ride];
 assert.equal(d.api.prepare(backup).history[0].power.main.fixedHRWatts,150);
 for(const [change,pattern] of [[r=>r.power.coverage=120,/Power coverage/],[r=>r.power.trace.watts='140,x',/power trace/],[r=>r.power.trace.rpm='900',/power trace/],
  [r=>r.power.main.cadence=400,/cadence/],[r=>r.power.main.decouplingPct=200,/decoupling/],[r=>r.power=[],/measured power/]]){
  const bad=JSON.parse(JSON.stringify(backup));change(bad.history[0]);assert.throws(()=>d.api.prepare(bad),pattern);
 }
});
test('Liftlog adds a warm-up ramp before the first working set',()=>{
 const d=lift(),s=d.api.state;s.settings.unit='kg';s.settings.loadStep=2.5;
 const row=(weight,extra={})=>({id:Math.random().toString(36).slice(2),weight,reps:null,durationSeconds:null,completed:false,unit:'kg',...extra});
 const start=(block)=>{s.activeWorkout={id:'now',routineId:'',routineName:'Free',startedAt:Date.now(),finishedAt:null,notes:'',currentExerciseIndex:0,timer:null,exercises:[block]};};
 const block=(sets,extra={})=>({exerciseId:'bench',name:'Bench',unit:'kg',loadMode:'total',equipmentKey:'',movementFamily:'horizontal_push',plannedSets:3,targetRepsMin:5,targetRepsMax:8,targetRir:null,skipped:false,notes:'',sets,...extra});
 start(block([row(100),row(100),row(100)]));d.api.addWarmups();
 const sets=s.activeWorkout.exercises[0].sets;
 assert.equal(JSON.stringify(sets.map(x=>[x.weight,x.reps,x.countForVolume===false&&x.countForPR===false])),
  JSON.stringify([[50,8,true],[70,5,true],[85,3,true],[100,null,false],[100,null,false],[100,null,false]]));
 assert.equal(d.api.warmupPlan(s.activeWorkout.exercises[0]).length,0,'a second ramp is not offered');
 start(block([row(5),row(5)]));assert.equal(JSON.stringify(d.api.warmupPlan(s.activeWorkout.exercises[0])),'[{"load":2.5,"reps":8}]','a light load gets fewer warm-ups');
 start(block([row(100,{completed:true,reps:5}),row(100)]));assert.equal(d.api.warmupPlan(s.activeWorkout.exercises[0]).length,0,'not after a logged set');
 start(block([row(null)]));assert.equal(d.api.warmupPlan(s.activeWorkout.exercises[0]).length,0,'no load, no ramp');
 start(block([{...row(null),unit:'bw',addedWeight:20,addedWeightUnit:'kg'}],{unit:'bw',loadMode:'bodyweight_added'}));
 assert.equal(JSON.stringify(d.api.warmupPlan(s.activeWorkout.exercises[0])),'[{"load":0,"reps":8},{"load":10,"reps":5}]','bodyweight ramps its added load');
 start(block([{...row(null),unit:'time',durationSeconds:60}],{unit:'time'}));assert.equal(d.api.warmupPlan(s.activeWorkout.exercises[0]).length,0,'timed work has none');
});
