/* Check-in uses the shared storage engine with its own schema and namespaces. */
/* exported CheckinStorage */
const CheckinStorage = (() => {
  // Version 2 adds symptom value 0 (gone) for ongoing symptoms. Version 1 data
  // loads unchanged; version 1 apps refuse version 2 data instead of failing on 0.
  const namespace='checkin.v1',key='checkin.state.v1',VERSION=2;
  const limits={items:CheckinCore.LIMITS.items,entries:CheckinCore.LIMITS.entries};
  function prepare(raw){
    WorkoutStorage.enforceLimits(raw,limits);
    if(raw?.app==='checkin'&&Number.isSafeInteger(raw.version)&&raw.version>VERSION)throw new Error('This backup is from a newer Check-in version. Update the app, then try again.');
    if(!raw||raw.app!=='checkin'||![1,VERSION].includes(raw.version)||!Number.isSafeInteger(raw.updatedAt)||raw.updatedAt<0)throw new Error('Not a valid Check-in backup.');
    return {app:'checkin',version:VERSION,updatedAt:raw.updatedAt,...CheckinCore.state(raw)};
  }
  function create(options){
    let state,remote;
    const seed=()=>({app:'checkin',version:VERSION,updatedAt:0,settings:CheckinCore.settings(),items:CheckinCore.defaults(),entries:[]});
    const local=WorkoutStorage.createLocal({key,rescueKey:namespace+'.unreadable',seed,prepare,getState:()=>state,setState:value=>{state=value;},
      touch:()=>{state.updatedAt=Math.max(Date.now(),state.updatedAt+1);},onChange:()=>remote?.scheduleRemoteBackup(),onStatus:options.onLocalStatus});
    state=local.load();
    const backup=()=>({...WorkoutStorage.copy(state),kind:'backup',exportedAt:new Date().toISOString()});
    remote=WorkoutStorage.createRemote({namespace,objectKey:'checkin-backup.json',recoveryKey:namespace+'.before-remote-restore',local,limits,
      get state(){return state;},prepare,validate:prepare,backup,
      revision:raw=>raw.updatedAt||0,dataKey:raw=>{const candidate=prepare(raw);delete candidate.updatedAt;return WorkoutStorage.stableStringify(candidate);},
      setRevision:(candidate,value)=>{candidate.updatedAt=value;},summarizeBackup:raw=>({records:raw.entries.length,recordLabel:'check-ins',hasActive:false}),
      isPristine:s=>!s.updatedAt&&!s.entries.length,isActive:()=>false,onBrowse:options.onBrowse,
      toast:options.toast,confirm:options.confirm,onStatus:options.onRemoteStatus,onBusy:options.onBusy,onRefresh:options.onRefresh,onRestore:options.onRestore});
    async function restore(raw){
      const expected=JSON.stringify(state),candidate=prepare(raw);
      if(!await options.confirm('Restore Check-in backup?','Replace this device’s check-ins, tracked items and settings? A recovery copy will be kept and cloud sync paused.','Restore backup',true))return false;
      if(expected!==JSON.stringify(state))throw new Error('Data changed during review. Restore cancelled.');
      remote.pauseRemoteSync('Local backup restored',{code:'import'});
      candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1,candidate.updatedAt+1);
      return remote.commitSnapshot(candidate);
    }
    // Removes every check-in after a confirmation. Tracked items and settings stay.
    // commitSnapshot keeps the previous data as a recovery copy, and cloud sync
    // pauses so the cloud keeps the old data until the person reviews it.
    async function clearEntries(){
      if(!state.entries.length)throw new Error('There are no check-ins to delete.');
      const expected=JSON.stringify(state);
      if(!await options.confirm('Delete all check-ins?','All '+state.entries.length+' check-ins will be removed from this device. Tracked items and settings are kept. A recovery copy is saved and cloud backups pause until you review the data.','Delete all check-ins',true))return false;
      if(expected!==JSON.stringify(state))throw new Error('Data changed during review. Nothing deleted.');
      remote.pauseRemoteSync('Check-ins deleted on this device',{code:'clear'});
      const candidate=WorkoutStorage.copy(state);candidate.entries=[];
      candidate.updatedAt=Math.max(Date.now(),state.updatedAt+1);
      if(!remote.commitSnapshot(candidate))throw new Error('Check-ins could not be deleted. Previous data retained.');
      return true;
    }
    return {get state(){return state;},local,remote,backup,restore,clearEntries,save:(remote=true)=>local.save({immediate:true,remote})};
  }
  return {create,prepare};
})();
