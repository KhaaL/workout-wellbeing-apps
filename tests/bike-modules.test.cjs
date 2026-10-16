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
