/* Presentation state only: never performs a save, upload or reconciliation. */
/* One sentence per pause cause recorded by the storage engine. */
WorkoutStorage.pauseReasons = {
  manual:term=>'You paused '+term.toLowerCase()+'.',
  import:()=>'Paused when you chose a backup file to restore.',
  recovery:()=>'Paused when you restored the previous local copy.',
  clear:()=>'Paused when you cleared workout data on this device.',
  'history-import':()=>'Paused when you imported workout history from a file.',
  review:()=>'Paused when a choice between the local and cloud copies did not finish.',
  snapshot:()=>'Paused when you chose a cloud backup to restore.',
  provider:()=>'Paused by the storage provider check. Its results are in Storage options.',
  handoff:()=>'Paused when you prepared a workout handoff to another device.',
  'handoff-received':()=>'Paused when this device received a workout from another device.',
  'handoff-cancelled':()=>'Paused when you cancelled a workout handoff.',
  storage:()=>'Paused because this browser could not read or save the pause setting.'
};
WorkoutStorage.storageSummary = function(input){
  const cloudAt=Number(input.cloudAt)||null,fileAt=Number(input.fileAt)||null;
  const conditional=input.mode==='conditional',term=conditional?'Cloud sync':'Cloud backups';
  const base={cloudAt,fileAt,pausedAt:null,configured:!!input.configured,detailsLabel:input.detailsLabel||'Storage options',action:'download',actionLabel:'Download backup',tone:'neutral',detail:'Your data is saved on this device.'};
  const state=(id,title,detail,action=base.action,actionLabel=base.actionLabel,tone=base.tone)=>({...base,id,title,detail,action,actionLabel,tone});
  if(input.failed||input.blocked)return state('attention','Needs attention','Changes may only be in memory. Keep this page open and download a backup.','download','Download backup','danger');
  if(input.localPending)return state('saving','Saving on this device…','Keep this page open until saving finishes.',null,null);
  if(input.held)return state('paused',term+' paused','A workout is held for transfer. Finish or cancel the handoff before resuming '+term.toLowerCase()+'.','handoff','Review handoff','warning');
  if(!input.configured)return state('local','Saved on this device','Cloud backup is not set up. Download a backup to keep a copy off this device.','configure','Set up cloud backup');
  if(input.status==='conflict')return state('attention','Needs attention','Local and cloud copies differ. Review them before choosing which copy to keep.','review','Review copies','warning');
  if(input.paused){
    // Separate backups never replace local data, so resuming is one upload the
    // person confirms. Conditional sync needs a choice between two copies.
    const code=input.pause?.code,reason=Object.prototype.hasOwnProperty.call(WorkoutStorage.pauseReasons,code)?WorkoutStorage.pauseReasons[code](term):null,pausedAt=Number(input.pause?.at)||null;
    const detail=(reason?reason+' ':'')+(conditional?'Your data stays on this device. Nothing syncs until you choose which copy to keep.':'Your data stays on this device. Nothing uploads until you resume backups.');
    return {...state('paused',term+' paused',detail,conditional?'review':'resume',conditional?'Choose a copy':'Resume backups…','warning'),pausedAt};
  }
  if(input.online===false)return state('offline','Offline',input.pending?'Your changes are saved here. Uploads will retry when a connection is available.':'Your local data is available. Cloud storage cannot be checked while offline.','download','Download backup','warning');
  if(input.busy||input.status==='checking')return state('checking','Checking cloud storage…','Your data remains on this device while the storage request completes.',null,null);
  if(input.status==='error'||input.status==='warning'){
    const hints={credentials:'Check the access key and matching secret in connection settings.',permissions:'Check that your storage key has permission for this operation.',bucket:'Check the bucket name in connection settings.',region:'Check the region and endpoint in connection settings.',clock:'Check this device’s date and time.',
      'network-or-cors':'Check your connection and the storage service’s browser access settings.',timeout:'The storage service did not respond in time. Check your connection and retry.'};
    const category=input.errorCategory,configuration=['credentials','permissions','bucket','region'].includes(category);
    return state('attention','Needs attention',hints[category]||'Cloud backup did not finish. Your local data is kept. Review the connection details and retry.',configuration?'configure':'retry',configuration?'Review connection':input.mode==='conditional'?'Retry sync':'Retry backup','danger');
  }
  const backed=cloudAt&&input.cloudRevision!=null&&input.revision!=null&&Number(input.cloudRevision)===Number(input.revision)&&!input.pending;
  if(backed)return state('backed-up','Backed up','The current saved data has a verified cloud backup.','download','Download backup','success');
  return state('pending','Upload pending',conditional?(input.active?'Your workout is saved here. A cloud comparison may wait until the workout finishes.':'Your data is saved here. Sync compares both copies; a newer cloud copy may replace local data.'):'Your data is saved here. Changes are waiting for a verified cloud backup.','backup',conditional?'Sync now':'Back up now');
};
WorkoutStorage.renderStorageSummary = function(container,input,actions){
  if(!container)return;
  const model=WorkoutStorage.storageSummary(input),signature=JSON.stringify(model);
  if(container.dataset.summary===signature)return;
  container.dataset.summary=signature;container.dataset.state=model.id;container.className='storage-summary';
  let heading=container.querySelector('h2');
  if(!heading){heading=document.createElement('h2');heading.textContent='Storage';container.append(heading);const live=document.createElement('div');live.className='storage-summary-live';live.setAttribute('role','status');live.setAttribute('aria-live','polite');container.append(live);const buttons=document.createElement('div');buttons.className='shared-actions';container.append(buttons);}
  const live=container.querySelector('.storage-summary-live');live.replaceChildren();
  const title=document.createElement('strong');title.className='storage-summary-title';title.dataset.tone=model.tone;title.textContent=model.title;
  const detail=document.createElement('p');detail.textContent=model.detail;
  const date=value=>new Date(value).toLocaleString();const backup=document.createElement('p');backup.className='hint';backup.textContent=(model.pausedAt?'Paused '+date(model.pausedAt)+'. ':'')+(model.cloudAt?'Last verified cloud backup: '+date(model.cloudAt)+'.':model.configured?'No verified cloud backup yet.':'');
  if(model.fileAt){const file=document.createElement('span');file.textContent=' Last backup download: '+date(model.fileAt)+'.';backup.append(file);}
  live.append(title,detail);if(backup.textContent)live.append(backup);
  const buttons=container.querySelector('.shared-actions'),focused=document.activeElement?.closest('.storage-summary')===container?document.activeElement.dataset.storageAction:null;buttons.replaceChildren();
  function button(id,label,primary){const b=document.createElement('button');b.type='button';b.className='btn'+(primary?' btn-primary':'');b.dataset.storageAction=id;b.textContent=label;b.addEventListener('click',()=>Promise.resolve().then(()=>actions[id]?.()).catch(error=>actions.error?.(error)));buttons.append(b);}
  if(model.action)button(model.action,model.actionLabel,true);
  if(model.action&&model.action!=='download')button('download','Download backup',false);
  // Setting up or reviewing the connection already opens the same section.
  if(model.action!=='configure')button('details',model.detailsLabel,false);
  if(focused)(buttons.querySelector('[data-storage-action="'+focused+'"]')||buttons.lastElementChild)?.focus();
};
