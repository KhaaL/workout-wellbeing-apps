const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const context=vm.createContext({WorkoutStorage:{}});
vm.runInContext(fs.readFileSync(path.join(root,'packages/storage-ui/status.js'),'utf8'),context);
const summary=context.WorkoutStorage.storageSummary;
const verified={configured:true,revision:20,cloudRevision:20,cloudAt:100,status:'synced'};
test('storage summary requires matching saved and cloud revisions, not a successful connection check',()=>{
  assert.equal(summary({}).id,'local');
  assert.equal(summary({configured:true,status:'synced'}).id,'pending');
  assert.equal(summary({...verified,cloudAt:null}).id,'pending');
  assert.equal(summary({...verified,cloudRevision:19}).id,'pending');
  assert.equal(summary({...verified,revision:null,cloudRevision:0}).id,'pending');
  assert.equal(summary({...verified,pending:true}).id,'pending');
  assert.equal(summary({...verified,pending:true,mode:'conditional'}).actionLabel,'Sync now');
  assert.match(summary({...verified,pending:true,mode:'conditional'}).detail,/may replace local data/);
  assert.equal(summary(verified).id,'backed-up');
  assert.equal(summary({...verified,fileAt:200}).cloudAt,100);
});
test('local saving failures override cloud success; holds, conflicts and pauses never offer an upload',()=>{
  for(const flag of ['failed','blocked'])assert.equal(summary({...verified,[flag]:true}).action,'download');
  assert.equal(summary({...verified,localPending:true}).id,'saving');
  assert.equal(summary({...verified,held:true}).action,'handoff');
  for(const input of [{paused:true},{status:'conflict'}])assert.equal(summary({...verified,...input}).action,'review');
  assert.equal(summary({...verified,paused:true,online:false}).id,'paused');
});
test('offline, retry and configuration errors offer distinct actions without exposing server details',()=>{
  assert.equal(summary({...verified,online:false}).id,'offline');
  assert.equal(summary({...verified,busy:true,status:'error'}).id,'checking');
  for(const category of ['credentials','permissions','bucket','region'])assert.equal(summary({...verified,status:'error',errorCategory:category}).action,'configure');
  for(const category of ['timeout','network-or-cors','unknown']){
    const model=summary({...verified,status:'error',errorCategory:category,errorMessage:'private response'});
    assert.equal(model.action,'retry');assert.doesNotMatch(JSON.stringify(model),/private response/);
  }
});
test('extracted Liftlog controllers use replacement state and UI objects after restore',()=>{
  const ctx=vm.createContext({});
  for(const file of ['workout','routines','exercises'])vm.runInContext(fs.readFileSync(path.join(root,'apps/liftlog/controllers',file+'.js'),'utf8'),ctx);
  vm.runInContext('globalThis.factories=[LiftlogWorkoutController,LiftlogRoutineController,LiftlogExerciseController]',ctx);
  let state={activeWorkout:{currentExerciseIndex:0,exercises:[{id:'before',sets:[]}]},routines:[{id:'before',items:[]}],exercises:[{id:'before'}]},ui={};
  let saves=0,renders=0;
  const deps={get state(){return state},get ui(){return ui},exerciseById:id=>state.exercises.find(ex=>ex.id===id),save:()=>saves++,render:()=>renders++,toast:()=>{}};
  const [workout,routines,exercises]=ctx.factories.map(factory=>factory.create(deps));
  assert.equal(workout.currentExercise().id,'before');assert.equal(routines.stableRoutines()[0].id,'before');
  const previous=state;
  state={activeWorkout:{currentExerciseIndex:0,exercises:[{id:'after',sets:[]}]},routines:[{id:'after',items:[]}],exercises:[{id:'after'}]};
  ui={exerciseDraft:{id:'after'}};
  assert.equal(workout.currentExercise().id,'after');assert.equal(routines.stableRoutines()[0].id,'after');
  exercises.setExerciseArchived('after',true);
  assert.equal(state.exercises[0].archived,true);assert.equal(ui.exerciseDraft,null);assert.equal(previous.exercises[0].archived,undefined);assert.equal(saves,1);assert.equal(renders,1);
});
