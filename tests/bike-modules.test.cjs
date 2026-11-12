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
