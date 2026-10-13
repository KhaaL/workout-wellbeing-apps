/* Explicit paused-workout transfer. Credentials and source locks stay local. */
WorkoutStorage.createHandoff = function(options){
  const key=options.namespace+'.handoff-source',receiptsKey=options.namespace+'.handoff-receipts';
  let busy=false,loaded=false,source=null;
  globalThis.addEventListener?.('storage',event=>{if(event.key===key||event.key===null)loaded=false;});
  const active=()=>options.getState()[options.activeKey];
  function held(){
    if(!active())return null;
    try{
      if(!loaded){source=JSON.parse(localStorage.getItem(key)||'null');loaded=true;}
      if(source&&(!source.payload||source.payload.kind!=='workout-handoff'||source.payload.workoutId!==source.workoutId))return {invalid:true};
      return source&&source.workoutId===active().id?source:null;
    }catch(error){return {invalid:true};}
  }
  const changed=()=>options.onChange?.();
  async function run(fn){if(busy)throw new Error('A handoff is already in progress.');busy=true;changed();try{return await fn();}finally{busy=false;changed();}}
  async function offer(){
    return run(async()=>{
      loaded=false;const existing=held();if(existing){if(existing.invalid)throw new Error('Handoff state could not be read. Export a backup and reset the hold before continuing.');return existing.payload;}
      if(!active())throw new Error('Start or restore a workout before preparing a handoff.');
      options.remote.pauseRemoteSync('Workout handoff in progress');
      await options.pause();
      if(!active()||!options.isPaused(active()))throw new Error('Workout could not be paused for transfer.');
      const expected=JSON.stringify(options.getState());
      if(!await options.confirm('Move workout to another device?','The workout and cloud uploads are paused. Preparing a handoff holds it on this device. Send the file or cloud code to the receiving device, review it there, then resume manually. Do not continue the same workout on two devices. Cancelling leaves it paused.','Prepare handoff'))return null;
      if(expected!==JSON.stringify(options.getState()))throw new Error('Data changed during review. Prepare the handoff again.');
      if(!options.local.flush())throw new Error('Paused workout could not be saved. Handoff cancelled.');
      const backup=options.backup();
      // Finished histories remain on their devices, rather than being replaced.
      if(Array.isArray(backup.history))backup.history=[];
      if(Array.isArray(backup.workouts))backup.workouts=[];
      const payload={app:options.app,kind:'workout-handoff',version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),workoutId:active().id,backup};
      WorkoutStorage.enforceLimits(payload);
      localStorage.setItem(key,JSON.stringify({workoutId:active().id,payload}));loaded=false;changed();return payload;
    });
  }
  function validate(raw){
    WorkoutStorage.enforceLimits(raw);
    if(!raw||raw.app!==options.app||raw.kind!=='workout-handoff'||raw.version!==1||typeof raw.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.id)||!Number.isFinite(Date.parse(raw.createdAt)))throw new Error('Expected a handoff file for this app.');
    const backup=options.prepare(raw.backup),workout=backup[options.activeKey];
    if(!workout||workout.id!==raw.workoutId||!options.isPaused(workout))throw new Error('The handoff must contain a paused workout.');
    return backup;
  }
  async function receive(raw){
    return run(async()=>{
      const incoming=validate(raw);
      if(active())throw new Error('Finish or discard the saved workout on this device before receiving a handoff.');
      const receipts=JSON.parse(localStorage.getItem(receiptsKey)||'[]');
      if(!Array.isArray(receipts)||receipts.includes(raw.id))throw new Error('This handoff has already been received.');
      const expected=JSON.stringify(options.getState()),candidate=options.makeCandidate(incoming);
      if(!await options.confirm('Receive paused workout?',`Handoff created ${new Date(raw.createdAt).toLocaleString()}. ${options.describe(incoming[options.activeKey])} Local finished history is kept and a recovery copy is saved. Keep the source device paused. Timing and sensors will need explicit review before resuming.`, 'Receive workout'))return false;
      if(active()||expected!==JSON.stringify(options.getState()))throw new Error('Data changed during review. Handoff cancelled.');
      options.remote.pauseRemoteSync('Received workout — review before resuming backups');
      options.setRevision(candidate);
      if(!options.remote.commitSnapshot(candidate))throw new Error('Handoff could not be saved. Previous data retained.');
      options.onReceived?.();
      try{localStorage.setItem(receiptsKey,JSON.stringify([...receipts,raw.id].slice(-100)));}catch(error){options.notify?.('Workout received, but its receipt could not be saved. Keep the source paused.');}
      options.notify?.('Paused workout received. Review it before resuming; cloud backups remain paused.');changed();return true;
    });
  }
  async function cancel(){return run(async()=>{
    const record=held();if(!record)return;
    const expected=localStorage.getItem(key),workoutId=active()?.id;
    if(!await options.confirm('Cancel handoff on this device?',(record.invalid?'Handoff state could not be read. Export a full backup first. ':'')+'Only cancel if no other device is continuing this workout. Previously shared files and codes still exist. The workout and cloud uploads remain paused.','Cancel handoff'))return;
    if(localStorage.getItem(key)!==expected||active()?.id!==workoutId)throw new Error('Handoff changed during review.');
    options.remote.pauseRemoteSync('Handoff cancelled — review before resuming backups');
    localStorage.removeItem(key);loaded=false;await options.pause();changed();
  });}
  return {offer,receive,validate,cancel,held,get hasActive(){return !!active();},get configured(){return !!options.remote.loadRemoteConfig();},get busy(){return busy;},upload:payload=>options.remote.remoteUploadHandoff(payload),receiveCode:async code=>receive(await options.remote.remoteReadHandoff(code))};
};
