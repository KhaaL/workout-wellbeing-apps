const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({});
for(const file of ['targets.js','trace.js','heart-rate.js','power.js','bluetooth.js','plans.js','workout-core.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../apps/bike-cardio',file),'utf8'),ctx);
const {H,Connection,P,BikeConnection}=vm.runInContext('({H:HeartRateCore,Connection:H10Connection,P:PowerCore,BikeConnection:BikeSensorConnection})',ctx);
const packet=bytes=>new DataView(Uint8Array.from(bytes).buffer);
test('extracted HR parsing handles wide values, contact, RR intervals and truncated packets',()=>{
  assert.equal(H.parse(packet([0,115])).bpm,115);
  assert.equal(H.parse(packet([1,4,1])).bpm,260);
  assert.equal(H.parse(packet([4,115])).valid,false);
  assert.equal(H.parse(packet([6,115])).valid,true);
  assert.equal(H.parse(packet([16,115,0,4])).rr[0],1000);
  for(const bytes of [[1,115],[8,115],[16,115,0]])assert.equal(H.parse(packet(bytes)),null);
});
function setup(){
  let now=1000,visible=true,id=0,measurements=[],connections=0;
  const timers=new Map(),device=new EventTarget(),characteristics=[];
  const server={getPrimaryService:async name=>{
    assert.equal(name,'heart_rate');return {getCharacteristic:async name=>{
      assert.equal(name,'heart_rate_measurement');const characteristic=new EventTarget();
      characteristic.startNotifications=async()=>characteristic;characteristics.push(characteristic);return characteristic;
    }};
  }};
  device.gatt={connected:false,connect:async()=>{connections++;device.gatt.connected=true;return server;},disconnect:()=>{device.gatt.connected=false;}};
  const connection=new Connection({bluetooth:{requestDevice:async()=>device},secure:true,protocol:'https:',
    now:()=>now,visible:()=>visible,onMeasurement:reading=>measurements.push(reading),
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  const send=(characteristic,bpm)=>{characteristic.value=packet([0,bpm]);characteristic.dispatchEvent(new Event('characteristicvaluechanged'));};
  return {connection,device,timers,characteristics,send,measurements,setVisible:value=>{visible=value;},connections:()=>connections};
}
test('extracted Bluetooth reconnect obtains a fresh characteristic and ignores stale packets',async()=>{
  const d=setup();await d.connection.connect();assert.equal(d.connection.state,'connected');
  const first=d.characteristics[0];d.send(first,115);assert.equal(d.connection.reading.bpm,115);
  d.device.gatt.connected=false;d.device.dispatchEvent(new Event('gattserverdisconnected'));
  assert.equal(d.connection.state,'disconnected');assert.equal(d.connection.reading,null);
  assert.equal([...d.timers.values()][0].delay,1000);
  await d.connection.connect(true);assert.equal(d.connections(),2);assert.equal(d.characteristics.length,2);
  d.send(first,190);assert.equal(d.connection.reading,null);
  d.send(d.characteristics[1],116);assert.equal(d.connection.reading.bpm,116);
  d.connection.disconnect();assert.equal(d.connection.state,'idle');assert.equal(d.timers.size,0);
  d.send(d.characteristics[1],120);assert.equal(d.connection.reading,null);
});
test('hidden pages suspend reconnects and manual disconnect cancels them',async()=>{
  const d=setup();await d.connection.connect();
  d.device.gatt.connected=false;d.device.dispatchEvent(new Event('gattserverdisconnected'));
  d.setVisible(false);d.connection.visibilityChanged();assert.equal(d.timers.size,0);
  d.setVisible(true);d.connection.visibilityChanged();assert.equal(d.timers.size,1);
  d.connection.disconnect();assert.equal(d.timers.size,0);
  d.connection.visibilityChanged();assert.equal(d.timers.size,0);
});
test('returning to the page retries again after three failed reconnects',async()=>{
  const d=setup();await d.connection.connect();
  d.device.gatt.connect=async()=>{throw Object.assign(new Error('gone'),{name:'NetworkError'});};
  d.device.gatt.connected=false;d.device.dispatchEvent(new Event('gattserverdisconnected'));
  for(let attempt=0;attempt<3;attempt++){const [key,timer]=[...d.timers].at(-1);d.timers.delete(key);timer.fn();await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(d.connection.state,'disconnected');assert.equal(d.timers.size,0,'automatic retries stop after three attempts');
  d.setVisible(false);d.connection.visibilityChanged();d.setVisible(true);d.connection.visibilityChanged();
  assert.equal(d.timers.size,1);assert.equal([...d.timers.values()][0].delay,1000);
});
test('manual HR remains available when Bluetooth cannot be used',async()=>{
  const connection=new Connection({secure:false,protocol:'https:'});
  await connection.connect();assert.equal(connection.state,'unavailable');assert.match(connection.error,/HTTPS/);
});
test('heart-rate targets come from maximum HR, heart-rate reserve or threshold HR',()=>{
  const T=vm.runInContext('BikeTargets',ctx),targets=profile=>JSON.stringify(T.fromProfile(profile).targets);
  assert.equal(JSON.stringify(T.fromProfile({method:'max',maxHR:185}).zones.map(z=>[z.min,z.max])),'[[93,111],[111,130],[130,148],[148,167],[167,185]]');
  assert.equal(targets({method:'max',maxHR:185}),'{"zoneMin":111,"zoneMax":130,"targetMin":117,"targetMax":128,"adjustBelow":114,"comparisonHR":123}');
  assert.equal(targets({method:'reserve',maxHR:185,restingHR:55}),'{"zoneMin":133,"zoneMax":146,"targetMin":137,"targetMax":144,"adjustBelow":135,"comparisonHR":141}');
  assert.equal(targets({method:'threshold',thresholdHR:160}),'{"zoneMin":130,"zoneMax":142,"targetMin":134,"targetMax":141,"adjustBelow":132,"comparisonHR":138}');
  for(const [profile,pattern] of [[{method:'max',maxHR:300},/Maximum HR/],[{method:'reserve',maxHR:150,restingHR:120},/at least 40/],[{method:'threshold'},/Threshold HR/],[{method:'other'},/Choose/]])
    assert.throws(()=>T.fromProfile(profile),pattern);
});
const bytes=(...words)=>{const out=[];for(const [n,size] of words){for(let i=0;i<size;i++)out.push((n>>(8*i))&255);}return new DataView(Uint8Array.from(out).buffer);};
test('bike power and cadence parse from Indoor Bike Data and Cycling Power packets',()=>{
  assert.equal(JSON.stringify(P.parseIndoorBike(bytes([0x44,2],[2500,2],[180,2],[200,2]))),'{"watts":200,"cadence":90,"valid":true}','speed, cadence and power');
  assert.equal(JSON.stringify(P.parseIndoorBike(bytes([0x74,2],[2500,2],[171,2],[1234,3],[8,2],[-5&0xffff,2]))),'{"watts":null,"cadence":85.5,"valid":true}','distance and resistance skipped; negative power is unknown');
  assert.equal(P.parseIndoorBike(bytes([0x44,2],[2500,2],[180,2])),null,'truncated');
  assert.equal(P.parseIndoorBike(bytes([0x01,2])),null,'a More Data packet without power or cadence');
  const first=P.parseCyclingPower(bytes([0x20,2],[180,2],[100,2],[1000,2]));assert.equal(first.watts,180);assert.equal(first.cadence,null,'one crank event is not a cadence');
  const second=P.parseCyclingPower(bytes([0x20,2],[185,2],[101,2],[1683,2]),first);assert.equal(Math.round(second.cadence),90);
  assert.equal(P.parseCyclingPower(bytes([0x20,2],[185,2],[101,2],[1683,2]),second).cadence,second.cadence,'no new crank event keeps the cadence');
  const wrapped=P.parseCyclingPower(bytes([0x20,2],[190,2],[0,2],[147,2]),{crank:{revs:65535,time:65000},cadence:null});assert.equal(Math.round(wrapped.cadence),90,'counters wrap at 65536');
  assert.equal(P.parseCyclingPower(bytes([0x25,2],[150,2],[50,1],[10,2],[101,2],[1683,2]),first).watts,150,'balance and torque fields are skipped');
});
function sensor(Kind,services){
  let visible=true;const timers=new Map(),device=new EventTarget(),requests=[];let id=0;
  const server={getPrimaryService:async uuid=>{if(!services[uuid])throw Object.assign(new Error('missing'),{name:'NotFoundError'});return {getCharacteristic:async name=>{
    assert.equal(name,services[uuid]);const characteristic=new EventTarget();characteristic.startNotifications=async()=>characteristic;device.characteristic=characteristic;return characteristic;}};}};
  device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return server;},disconnect:()=>{device.gatt.connected=false;}};
  const readings=[],connection=new Kind({bluetooth:{requestDevice:async options=>{requests.push(options);return device;}},secure:true,protocol:'https:',now:()=>1000,visible:()=>visible,
    onMeasurement:reading=>readings.push(reading),setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key)});
  return {connection,device,requests,readings,send:value=>{device.characteristic.value=value;device.characteristic.dispatchEvent(new Event('characteristicvaluechanged'));}};
}
test('any heart-rate strap and any standard bike sensor can connect',async()=>{
  const strap=sensor(Connection,{heart_rate:'heart_rate_measurement'});await strap.connection.connect();
  assert.equal(JSON.stringify(strap.requests[0].filters),'[{"services":["heart_rate"]}]','no device-name filter');
  const bikeFtms=sensor(BikeConnection,{[0x1826]:0x2AD2});await bikeFtms.connection.connect();assert.equal(bikeFtms.connection.state,'connected');
  bikeFtms.send(bytes([0x44,2],[2500,2],[180,2],[200,2]));assert.equal(bikeFtms.connection.reading.watts,200);assert.equal(bikeFtms.connection.reading.cadence,90);
  const meter=sensor(BikeConnection,{[0x1818]:0x2A63});await meter.connection.connect();assert.equal(meter.connection.state,'connected','falls back to Cycling Power');
  meter.send(bytes([0x20,2],[180,2],[100,2],[1000,2]));meter.send(bytes([0x20,2],[185,2],[101,2],[1683,2]));assert.equal(Math.round(meter.connection.reading.cadence),90,'cadence uses the previous packet');
  const none=sensor(BikeConnection,{});await none.connection.connect();assert.equal(none.connection.state,'disconnected');assert.match(none.connection.error,/Could not connect to the bike/);
  const plain=new BikeConnection({secure:false,protocol:'https:'});await plain.connect();assert.match(plain.error,/HTTPS/);
});
const talkTest=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/bike-plan-talk-test.json'),'utf8'));
test('plan steps take a checked HR band and a question; a talk-test plan names its result',()=>{
  const {P}=vm.runInContext('({P:BikePlans})',ctx);
  const plan=P.normalize({id:'t',...talkTest}),phases=P.expand(plan.steps),stages=phases.filter(p=>p.check);
  assert.equal(plan.result,'zone2Ceiling');
  const json=JSON.stringify;
  assert.equal(json(stages.map(p=>[p.title,p.hr,p.hrRange.join('-')])),json([['Step 1','115–120','115-120'],['Step 2','120–125','120-125'],['Step 3','125–130','125-130']]));
  assert.equal(json(stages[0].check),json({prompt:'Count aloud to 20',options:['Smooth','Broken','Could not'],pass:['Smooth']}));
  const bad=(step,pattern)=>assert.throws(()=>P.normalize({id:'b',name:'b',steps:[step]}),pattern);
  bad({kind:'main',seconds:60,hrRange:[110,120]},/hrRange is for warmup, settle, recovery, cooldown/);
  bad({kind:'main',seconds:60,hrRange:[110,120]},/Use kind "settle" for a step with its own HR band/);
  bad({kind:'main',seconds:60,hrMax:130},/a band step uses kind "settle", not "main"/);
  assert.match(P.FORMAT,/"main" is a steady block steered by the Settings zone targets: it takes no hrRange or hrMax/);
  bad({kind:'settle',seconds:60,hrRange:[120,120]},/must rise/);
  bad({kind:'settle',seconds:60,hrRange:[110,120],hrBelow:120},/not both/);
  bad({kind:'settle',untilHrBelow:100,check:{prompt:'x',options:['a','b']}},/timed step/);
  bad({kind:'effort',seconds:30,check:{prompt:'x',options:['a','b']}},/cannot hold a check/);
  bad({kind:'settle',seconds:60,check:{prompt:'x',options:['a']}},/2 to 5 options/);
  bad({kind:'settle',seconds:60,check:{prompt:'x',options:['a','a']}},/must differ/);
  bad({kind:'settle',seconds:60,check:{prompt:'x',options:['a','b'],pass:['c']}},/pass must list/);
  assert.throws(()=>P.normalize({id:'r',name:'r',result:'zone2Ceiling',steps:[{kind:'settle',seconds:60}]}),/needs a step with an hrRange/);
  assert.throws(()=>P.normalize({id:'r',name:'r',result:'vo2max',steps:[{kind:'settle',seconds:60}]}),/result must be zone2Ceiling/);
});
test('the talk test proposes a ceiling: highest step passed, measured HR first, and whether the limit was found',()=>{
  const {P}=vm.runInContext('({P:BikePlans})',ctx);
  const c=(title,range,answer,averageHR=null)=>({title,hrRange:range,pass:['Smooth'],options:['Smooth','Broken','Could not'],answer,averageHR});
  const json=JSON.stringify;
  assert.equal(json(P.ceilingFrom([c('Step 1',[115,120],'Smooth',118.4),c('Step 2',[120,125],'Smooth',123.6),c('Step 3',[125,130],'Broken',128)])),
    json({value:124,measured:true,title:'Step 2',hrRange:[120,125],limitFound:true}));
  assert.equal(json(P.ceilingFrom([c('Step 1',[115,120],'Smooth'),c('Step 2',[120,125],null)])),json({value:120,measured:false,title:'Step 1',hrRange:[115,120],limitFound:false}),'no strap: the top of the band; unanswered steps say nothing');
  assert.equal(P.ceilingFrom([c('Step 1',[115,120],'Could not')]),null);
  assert.equal(P.ceilingFrom(undefined),null);
});
test('a new ceiling keeps the zone minimum and rebuilds the working band in proportion',()=>{
  const T=vm.runInContext('BikeTargets',ctx);
  assert.equal(JSON.stringify(T.withCeiling(T.defaults,122)),JSON.stringify(T.defaults),'the default zone comes back unchanged');
  assert.equal(JSON.stringify(T.withCeiling(T.defaults,126)),JSON.stringify({zoneMin:105,zoneMax:126,targetMin:111,targetMax:123,adjustBelow:109,comparisonHR:117}));
  assert.throws(()=>T.withCeiling(T.defaults,108),/at least 5 above the zone minimum \(105\)/);
});
test('a check opens 30 s before its step ends, cues once, keeps its answer and records the HR over its window',()=>{
  const {C,H}=vm.runInContext('({C:WorkoutCore,H:HeartRateCore})',ctx);
  const s=C.create({plan:{id:'t',...talkTest}},0,'ride');
  const step1=C.build(s.config).find(p=>p.title==='Step 1');
  assert.equal(C.checkWindow(step1),210000);
  s.index=step1.id;s.finishedPhases=C.build(s.config).slice(0,step1.id).map(p=>({id:p.id,kind:p.kind,title:p.title,ms:p.duration,outcome:'complete'}));s.activeMs=480000;s.lastAt=0;
  let events=C.advance(s,200000);assert.equal(events.filter(e=>e.type==='checkDue').length,0);
  // A strap reading of 118 bpm every second through the check window.
  const cues=[];
  for(let t=201000;t<=240000;t+=1000){events=C.advance(s,t);if(events.some(e=>e.type==='checkDue'))cues.push(s.phaseMs);H.sample(s.hr,{bpm:118,valid:true,at:t},t,s.activeMs);}
  assert.equal(JSON.stringify(cues),'[210000]','cued once, when the window opens');
  assert.equal((s.checkCued||[]).length,1);
  assert.equal(C.answerCheck(s,step1.id,'Maybe'),false,'only its own options');
  assert.equal(C.answerCheck(s,step1.id,'Smooth'),true);assert.equal(C.checkAnswer(s,step1.id),'Smooth');
  const restored=C.restore(JSON.parse(JSON.stringify(s)),241000);assert.equal(C.checkAnswer(restored,step1.id),'Smooth','an answer survives a reload');
  const r=C.record(C.end(s,241000)&&s);const check=r.checks[0];
  assert.deepEqual([check.title,check.answer,check.hrRange.join('-'),Math.round(check.averageHR)],['Step 1','Smooth','115-120',118]);
  assert.equal(r.checks.length,2,'the step cut short by ending is listed too');
  assert.equal(H.rangeAdvice({bpm:121,valid:true,at:1},1,[115,120]).text,'Above 120 · ease one level');
  assert.equal(H.rangeAdvice({bpm:117,valid:true,at:1},1,[115,120]).action,'hold');
});
test('resistance and incline are logged at the start and at each change, with the HR measured at each setting',()=>{
  const {C,H}=vm.runInContext('({C:WorkoutCore,H:HeartRateCore})',ctx);
  const j=x=>JSON.parse(JSON.stringify(x));
  assert.equal(C.config({}).startResistance,undefined,'recording is off unless a start value is given');
  assert.equal(C.config({startResistance:500,startIncline:'x'}).startResistance,undefined,'out-of-range and non-numeric values are dropped');
  const s=C.create({startResistance:6,startIncline:2},1000,'ride');
  assert.deepEqual(JSON.parse(JSON.stringify(s.loadLog)),[{ms:0,at:1000,resistance:6,incline:2}],'the start is the first entry');
  // Ride a minute at 6 / 2 with HR 110, raise resistance, ride a minute at 7 / 2 with HR 120, then incline.
  let t=1000;const ride=(seconds,bpm)=>{for(let n=0;n<seconds;n++){t+=1000;C.advance(s,t);H.sample(s.hr,{bpm,valid:true,at:t},t,s.activeMs);}};
  ride(60,110);assert.deepEqual(j(C.adjustLoad(s,t,'resistance',1).map(e=>e.type)),['load']);
  ride(60,120);C.adjustLoad(s,t,'incline',1);C.adjustLoad(s,t,'incline',1);
  assert.deepEqual(JSON.parse(JSON.stringify(s.load)),{resistance:7,incline:3},'incline moves in half-percent steps');
  ride(30,125);
  const restored=C.restore(JSON.parse(JSON.stringify(s)),t+1000);
  assert.equal(restored.loadLog.length,s.loadLog.length,'the log survives a reload');assert.deepEqual(JSON.parse(JSON.stringify(restored.load)),{resistance:7,incline:3});
  const r=C.record(C.end(s,t)&&s),changes=r.load.changes;
  assert.deepEqual(j(changes.map(e=>[e.ms,e.resistance,e.incline])),[[0,6,2],[60000,7,2],[120000,7,2.5],[120000,7,3]]);
  assert.deepEqual(j(changes.map(e=>e.untilMs)),[60000,120000,120000,150000],'each setting runs until the next change');
  assert.equal(changes.every((e,i)=>i===0||e.ms>=changes[i-1].ms),true,'changes are in order');
  assert.deepEqual(j(changes.map(e=>e.averageHR===null?null:Math.round(e.averageHR))),[110,120,null,125],'HR over each stretch; none where the stretch is too short to measure');
  assert.equal(r.activeMs,150000);
  // Only a value given at the start can change; a paused or finished ride ignores the buttons.
  const solo=C.create({startResistance:5},0,'solo');assert.deepEqual(j(C.adjustLoad(solo,10,'incline',1)),[],'incline was left blank');
  assert.equal(solo.loadLog.length,1);
  const limit=C.create({startResistance:0},0,'low');assert.deepEqual(j(C.adjustLoad(limit,10,'resistance',-1)),[],'no change below the minimum');
  const none=C.create({},0,'none');assert.equal(none.loadLog.length,0);assert.equal(C.record(C.end(none,5)&&none).load,undefined,'no log, no load record');
  const old=JSON.parse(JSON.stringify(C.create({},0,'old')));delete old.load;delete old.loadLog;assert.deepEqual(JSON.parse(JSON.stringify(C.restore(old,10).load)),{resistance:null,incline:null},'a ride saved before this existed restores without one');
});

const adaptive=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/bike-plan-talk-test-adaptive.json'),'utf8'));
test('the adaptive talk-test sample uses a hard cap, a band shift after a failed check and a note hint',()=>{
  const {P}=vm.runInContext('({P:BikePlans})',ctx),json=JSON.stringify;
  const plan=P.normalize(adaptive),phases=P.expand(plan.steps),stages=phases.filter(p=>p.check);
  assert.equal(plan.noteHint,'Sleep last night, hours and quality');
  assert.equal(json(stages.map(p=>[p.title,p.hr,p.hrMax??null,p.check.onFail?.shiftBpm??null])),json([['Step 1','115–120',null,-5],['Step 2','120–125',null,-5],['Step 3','125–130 (max 132)',132,null]]));
  assert.equal(P.minimumMs(phases),40*60000,'5 + 3 x 10 + 5 minutes');
  assert.notEqual(P.hash(plan),P.hash(P.normalize({...adaptive,steps:adaptive.steps.map(step=>step.hrMax?{...step,hrMax:131}:step)})),"a changed cap starts a new progress series");
  assert.equal(P.hash(plan),P.hash(P.normalize({...adaptive,noteHint:'Other',name:'Renamed'})),'the note hint and name do not split a series');
  const bad=(patch,pattern)=>assert.throws(()=>P.normalize({id:'b',name:'b',steps:[{kind:'settle',seconds:60,hrRange:[110,120],...patch}]}),pattern);
  bad({hrMax:120},/hrMax must be above the top of hrRange/);
  bad({hrMax:300},/hrMax must be a whole number from 40 to 230/);
  assert.throws(()=>P.normalize({id:'b',name:'b',steps:[{kind:'settle',seconds:60,hrMax:130}]}),/hrMax needs an hrRange/);
  const check=extra=>({prompt:'x',options:['a','b'],pass:['a'],...extra});
  bad({check:check({onFail:{shiftBpm:0}})},/shiftBpm must be a whole number from -30 to -1/);
  bad({check:check({onFail:{shiftBpm:-31}})},/shiftBpm must be a whole number from -30 to -1/);
  bad({check:check({onFail:{shiftBpm:2.5}})},/shiftBpm/);
  bad({check:check({onFail:[-5]})},/onFail must be an object/);
  bad({check:{prompt:'x',options:['a','b'],onFail:{shiftBpm:-5}}},/onFail needs pass answers/);
  assert.throws(()=>P.normalize({id:'b',name:'b',noteHint:'x'.repeat(81),steps:[{kind:'settle',seconds:60}]}),/noteHint must be text of at most 80 characters/);
});
test('the ceiling comes from the last step passed before the first failure; later steps are ignored',()=>{
  const {P}=vm.runInContext('({P:BikePlans})',ctx),json=JSON.stringify;
  const c=(title,range,answer,averageHR=null)=>({title,hrRange:range,pass:['Smooth'],options:['Smooth','Broken','Could not'],answer,averageHR});
  // A failed step 2 lowers step 3, which then passes: it must not raise the ceiling.
  const ridden=[c('Step 1',[115,120],'Smooth',118),c('Step 2',[120,125],'Broken',123),c('Step 3',[120,125],'Smooth',122.7)];
  assert.equal(json(P.ceilingFrom(ridden)),json({value:118,measured:true,title:'Step 1',hrRange:[115,120],limitFound:true}));
  assert.equal(P.firstFailure(ridden).title,'Step 2');
  const early=[c('Step 1',[115,120],'Could not'),c('Step 2',[110,115],'Smooth',112)];
  assert.equal(P.ceilingFrom(early),null,'a first-step failure proposes nothing');assert.equal(P.firstFailure(early).title,'Step 1');
  assert.equal(P.firstFailure([c('Step 1',[115,120],'Smooth')]),null);
  assert.equal(P.bandText([125,130],132),'125–130 (max 132)');assert.equal(P.bandText([125,130],null),'125–130');
});
test('the live advice names a hard cap before the band',()=>{
  const {H}=vm.runInContext('({H:HeartRateCore})',ctx),at=Date.now(),reading=bpm=>({bpm,valid:true,at});
  assert.equal(H.rangeAdvice(reading(131),at,[125,130],132).action,'high');assert.equal(H.rangeAdvice(reading(131),at,[125,130],132).over,undefined,'above the band, under the cap: ease one level');
  const over=H.rangeAdvice(reading(133),at,[125,130],132);assert.equal(over.action,'high');assert.equal(over.over,true);assert.match(over.text,/Above 132 · ease resistance now/);
  assert.match(H.rangeAdvice(reading(131),at,[125,130]).text,/Above 130 · ease one level/,'no cap: as before');
});
