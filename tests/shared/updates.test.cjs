const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../packages/app-ui/updates.js'),'utf8');
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function setup(){
  let now=1e9,checks=0,active=false;
  const document=new EventTarget();document.visibilityState='visible';document.querySelector=()=>({content:'loaded-v1'});
  const registration=new EventTarget();Object.assign(registration,{waiting:null,installing:null,update:async()=>{checks++;}});
  const service=new EventTarget();Object.assign(service,{controller:{},register:async()=>registration,ready:Promise.resolve(registration)});
  const window=new EventTarget();window.isSecureContext=true;
  class Clock extends Date{static now(){return now;}}
  const context={document,window,navigator:{serviceWorker:service,onLine:true},Date:Clock,setTimeout,clearTimeout,MessageChannel,console};vm.createContext(context);vm.runInContext(source,context);
  const states=[],api=context.WorkoutUpdates.create({workerUrl:'./sw.js',isActive:()=>active,flush:()=>true,onChange:state=>states.push(state)});
  await tick(0);
  return {api,document,window,registration,service,states,advance:()=>{now+=61000;},checks:()=>checks,setActive:value=>{active=value;}};
}
test('checks on startup, foreground and reconnect; throttles automatic checks but allows manual checks',async()=>{
  const app=await setup();assert.equal(app.checks(),1);
  app.window.dispatchEvent(new Event('online'));await tick(0);assert.equal(app.checks(),1);
  app.advance();app.document.visibilityState='hidden';app.document.dispatchEvent(new Event('visibilitychange'));await tick(0);assert.equal(app.checks(),1);
  app.document.visibilityState='visible';app.document.dispatchEvent(new Event('visibilitychange'));await tick(0);assert.equal(app.checks(),2);
  app.advance();app.window.dispatchEvent(new Event('online'));await tick(0);assert.equal(app.checks(),3);
  await app.api.check();assert.equal(app.checks(),4);
});
test('notifies again when waiting is assigned after the installed event',async()=>{
  const app=await setup(),worker=new EventTarget();worker.state='installing';
  app.registration.installing=worker;app.registration.dispatchEvent(new Event('updatefound'));
  worker.state='installed';worker.dispatchEvent(new Event('statechange'));
  assert.equal(app.states.at(-1).waiting,false);
  app.registration.installing=null;app.registration.waiting=worker;await tick(70);
  assert.equal(app.states.at(-1).waiting,true);assert.equal(app.states.at(-1).status,'Update ready.');
});
test('checks can discover an update during a workout but applying remains blocked',async()=>{
  const app=await setup(),worker=new EventTarget();worker.state='installed';worker.postMessage=()=>assert.fail('Activated during a workout');
  app.registration.waiting=worker;app.setActive(true);await app.api.apply();
  assert.match(app.api.state().error,/Finish or end/);assert.equal(app.api.canStart(),true);
});
