const {test}=require('node:test');
const assert=require('node:assert/strict');
const {device}=require('./remote-harness.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const d=device();
  d.api.state=d.api.prepareBackup({version:14,settings:{lastModifiedAt:100},
    exercises:[{id:'e',name:'Squat',unit:'kg'}],routines:[],
    workouts:[{id:'w',startedAt:1,finishedAt:2,exercises:[{exerciseId:'e',name:'Squat',unit:'kg',sets:[{id:'s',reps:5,weight:20,completed:true}]}]}],activeWorkout:null});
  d.api.save({touch:false,remote:false,immediate:true});
  return d;
}
test('clearing history persists the candidate and full recovery copy, retains other data and pauses uploads across reload',async()=>{
  const d=setup(),before=copy(d.api.state);
  assert.equal(await d.api.clearWorkoutData(),true);
  assert.equal(d.api.state.workouts.length,0);
  for(const key of ['exercises','routines','bodyweights'])assert.deepEqual(copy(d.api.state[key]),before[key]);
  assert.deepEqual(copy(d.api.prepareBackup(JSON.parse(d.api.rescue))),before);
  assert.ok(d.api.state.settings.lastModifiedAt>before.settings.lastModifiedAt);
  const reloaded=device(d.storage);
  assert.equal(reloaded.api.state.workouts.length,0);assert.equal(reloaded.api.remoteSyncPaused(),true);
  await reloaded.api.remoteStartupSync();assert.equal(reloaded.api.state.workouts.length,0);
});
test('an active or resumable workout blocks clearing before confirmation',async()=>{
  const d=setup();d.api.state.activeWorkout={id:'active'};d.api.dialog=()=>assert.fail('Asked to clear an active workout');
  const before=JSON.stringify(d.api.state);
  assert.equal(await d.api.clearWorkoutData(),false);assert.equal(JSON.stringify(d.api.state),before);assert.equal(d.api.remoteSyncPaused(),false);
});
test('cancelling clear changes neither data nor upload pause',async()=>{
  const d=setup(),before=d.storage.get('liftlog.v1');d.api.dialog=async()=>false;
  assert.equal(await d.api.clearWorkoutData(),false);assert.equal(d.storage.get('liftlog.v1'),before);assert.equal(d.api.rescue,null);assert.equal(d.api.remoteSyncPaused(),false);
});
test('local edits or a workout starting during review cancel clearing',async()=>{
  for(const change of [d=>{d.api.state.workouts[0].notes='new edit';},d=>{d.api.state.activeWorkout={id:'started-during-review'};}]){
    const d=setup();d.api.dialog=async()=>{change(d);return true;};
    assert.equal(await d.api.clearWorkoutData(),false);assert.equal(d.api.state.workouts.length,1);assert.equal(d.api.rescue,null);assert.equal(d.api.remoteSyncPaused(),false);
    assert.match(d.messages.at(-1),/changed during confirmation/);
  }
});
test('a different tab saving during review prevents stale history replacement',async()=>{
  const d=setup(),other=copy(d.api.state);other.workouts[0].notes='other tab';other.settings.lastModifiedAt++;
  d.api.dialog=async()=>{d.storage.set('liftlog.v1',JSON.stringify(other));return true;};
  assert.equal(await d.api.clearWorkoutData(),false);assert.equal(d.api.state.workouts.length,1);assert.equal(d.storage.get('liftlog.v1'),JSON.stringify(other));assert.equal(d.api.remoteSyncPaused(),true);
});
test('failed pause, recovery or main writes never clear the live or durable history',async()=>{
  for(const failingKey of ['liftlog.v1.remote-paused','liftlog.v1.before-remote-restore','liftlog.v1']){
    const d=setup(),before=d.storage.get('liftlog.v1'),live=JSON.stringify(d.api.state),set=d.ctx.localStorage.setItem;
    d.ctx.localStorage.setItem=(key,value)=>{if(key===failingKey)throw Error('Storage full');set(key,value);};
    assert.equal(await d.api.clearWorkoutData(),false);assert.equal(d.storage.get('liftlog.v1'),before);assert.equal(JSON.stringify(d.api.state),live);assert.equal(d.api.remoteSyncPaused(),true);
  }
});
