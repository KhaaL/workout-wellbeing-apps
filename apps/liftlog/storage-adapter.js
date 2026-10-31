/* Liftlog's schema remains in the app; this adapter supplies storage policy. */
/* exported LiftlogStorage */
const LiftlogStorage = (() => {
  const limits={workouts:10000,exercises:5000,routines:2000,bodyweights:20000};
  function revision(obj){
    const n=Number(obj?.settings?.lastModifiedAt);
    return Number.isSafeInteger(n)&&n>0?n:0;
  }
  function dataKey(obj,prepare){
    const candidate=prepare(obj);
    delete candidate.version;
    ['lastModifiedAt','lastFileBackupAt','seededAt'].forEach(key=>delete candidate.settings[key]);
    return WorkoutStorage.stableStringify(candidate);
  }
  function createLocal(options){
    return WorkoutStorage.createLocal({...options,cacheKeys:['workouts'],touch:()=>{
      const state=options.getState(),n=Number(state.settings.lastModifiedAt);
      state.settings.lastModifiedAt=Math.max(Date.now(),(Number.isFinite(n)?n:0)+1);
    }});
  }
  function createRemote(options){
    return WorkoutStorage.createRemote({
      namespace:'liftlog.v1',objectKey:'liftlog-backup.json',recoveryKey:options.recoveryKey,
      local:options.local,limits,
      get state(){return options.getState();},prepare:options.prepare,validate:options.validate,
      backup:options.backup,revision,dataKey:obj=>dataKey(obj,options.prepare),
      summarizeBackup:obj=>({records:obj.workouts.length,recordLabel:'workouts',hasActive:!!obj.activeWorkout}),
      // An unedited sample seed: seeding never sets a revision, and any edit does.
      isPristine:state=>!!(state.settings.seededAt&&!revision(state)&&!state.activeWorkout),
      setRevision:(obj,value)=>{obj.settings.lastModifiedAt=value;},isActive:()=>!!options.getState().activeWorkout,
      onStatus:options.onStatus,toast:options.toast,confirm:options.confirm,choose:options.choose,
      onBusy:options.onBusy,onRefresh:options.onRefresh,onToolsChange:options.onToolsChange,onRestore:options.onRestore,onBrowse:options.onBrowse
    });
  }
  function createHandoff(options){
    return WorkoutStorage.createHandoff({namespace:'liftlog.v1',app:'liftlog',activeKey:'activeWorkout',getState:options.getState,
      remote:options.remote,local:options.local,backup:options.backup,prepare:options.prepare,
      pause:options.pause,isPaused:workout=>!workout.timer?.running&&!(workout.restTimers||[]).some(timer=>timer?.running),
      makeCandidate:incoming=>{
        const current=options.getState(),workout=incoming.activeWorkout;
        if(current.workouts.some(row=>row.id===workout.id))throw new Error('This workout is already in the receiving history.');
        if(current.settings.unit!==incoming.settings.unit)throw new Error('Set this device’s weight unit to match the handoff before receiving it.');
        const candidate=WorkoutStorage.copy(current),routine=incoming.routines.find(row=>row.id===workout.routineId);
        const ids=new Set([...workout.exercises.map(ex=>ex.exerciseId),...(routine?.items||[]).map(item=>item.exerciseId)]);
        for(const id of ids){
          const incomingExercise=incoming.exercises.find(ex=>ex.id===id),existing=candidate.exercises.find(ex=>ex.id===id);
          if(existing&&incomingExercise&&(options.nameKey(existing.name)!==options.nameKey(incomingExercise.name)||(JSON.stringify(existing)!==JSON.stringify(incomingExercise)&&!options.sameContract(existing,incomingExercise))))throw new Error('An exercise definition conflicts with this device. Review the library before receiving the handoff.');
          if(!existing&&incomingExercise)candidate.exercises.push(WorkoutStorage.copy(incomingExercise));
        }
        if(routine){const existing=candidate.routines.find(row=>row.id===routine.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(routine))throw new Error('The referenced routine differs on this device. Review it before receiving the handoff.');if(!existing)candidate.routines.push(WorkoutStorage.copy(routine));}
        if(workout.exercises.some(ex=>ex.unit==='bw')){
          const baseline=state=>(state.bodyweights||[]).filter(row=>row.loggedAt<=workout.startedAt).sort((a,b)=>b.loggedAt-a.loggedAt)[0];
          const source=baseline(incoming),target=baseline(current);
          if((source?.weight??null)!==(target?.weight??null)||(source?.unit??null)!==(target?.unit??null))throw new Error('Bodyweight records differ for this workout date. Align them before receiving bodyweight work.');
        }
        candidate.activeWorkout=WorkoutStorage.copy(workout);return options.prepare(candidate);
      },
      setRevision:candidate=>{candidate.settings.lastModifiedAt=Math.max(Date.now(),revision(options.getState())+1);},
      describe:workout=>`${workout.routineName}: ${workout.exercises.length} exercises. Rest timer is paused. The original workout date is retained.`,
      confirm:options.confirm,onChange:options.onChange,notify:options.notify});
  }
  return {createLocal,createRemote,createHandoff,revision,dataKey};
})();
