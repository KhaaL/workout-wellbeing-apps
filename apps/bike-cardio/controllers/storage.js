/* bike-cardio storage controller. Context getters always read current app state. */
/* exported BikeStorageController */
const BikeStorageController = {
  create(context){
  function renderBackupControls(){
    context.renderStorageStatus();
    if(context.currentView!=='settings'&&context.currentView!=='summary')return;
    const cfg=context.storage.remote.loadRemoteConfig(),paused=context.storage.remote.remoteSyncPaused();context.$('cloudActions').hidden=!cfg;context.$('cloudBackup').hidden=paused;context.$('cloudPause').hidden=paused;context.$('cloudResume').hidden=!paused;
    context.$('backupStatus').textContent=context.storage.local.blocked?context.storage.local.warning:context.storage.local.failed?'Changes are in memory only. Download a full backup before closing.':`${context.storage.state.history.length} saved sessions. Full backups include settings and any saved ride.`;
    const info=context.storage.backupInfo();context.$('backupAge').textContent=info.at?`Last backup: ${context.dateLabel(info.at)} (${info.where}). ${info.rides} rides added or edited since then.${info.stale?' Download a fresh full backup.':''}`:'No full backup recorded on this device.';
    context.$('cloudUseRemote').textContent=context.storage.remote.syncMode(cfg)==='immutable'?'Restore legacy backup locally':'Use cloud copy';
    const work=context.storage.remote.readRemoteWork();context.$('cloudDetails').textContent=cfg?`Bucket: ${cfg.bucket}. Last sync: ${cfg.lastBackupAt?context.dateLabel(cfg.lastBackupAt):'never'}. Backed-up revision: ${cfg.lastUploadedModifiedAt||'none'}.${work?.pending?' Changes are waiting to sync.':''}${paused?' Cloud sync is paused.':''}`:'';
    document.querySelectorAll('#cloudActions button,#saveCloud,#cloudForm input,#cloudForm select,#importCloudConfig').forEach(button=>button.disabled=context.cloudBusy||context.configBusy);
    if(!context.storage.remote.remoteCryptoAvailable()){
      context.$('saveCloud').disabled=true;for(const id of ['cloudTest','cloudBackup','cloudResume','cloudKeepLocal','cloudUseRemote'])context.$(id).disabled=true;
      context.$('cloudDetails').textContent+=' Cloud storage needs HTTPS and Web Crypto.';
    }
    renderRecoveryCopies();renderStorageDiagnostics();context.$('storageTools').hidden=!cfg;
    WorkoutStorage.renderRemoteTools(context.$('remoteTools'),context.storage.remote,context.downloadJSON,'bike');
  }
  async function readJSONUpload(file){if(file.size>8*1024*1024)throw new Error('File exceeds the 8 MiB import limit.');return JSON.parse(await file.text());}
  function renderRecoveryCopies(){
    const container=context.$('recoveryCopies');container.replaceChildren();
    for(const saved of context.storage.recoveryCopies()){
      const card=document.createElement('div');card.className='card stack';
      const title=document.createElement('h2');title.textContent=saved.label;card.append(title);
      const description=document.createElement('p');description.className='small';description.textContent=`${new Blob([saved.raw]).size} bytes saved separately from your current rides. Download before another replacement overwrites this copy.`;card.append(description);
      const download=document.createElement('button');download.className='secondary';download.textContent='Download recovery copy';download.id=saved.kind==='before-remote-restore'?'downloadRecovery':'downloadUnreadable';
      download.addEventListener('click',()=>context.downloadJSON(saved.raw,`bike-cardio-${saved.kind}.json`));card.append(download);
      if(saved.restorable){const restore=document.createElement('button');restore.className='secondary';restore.textContent='Restore this copy…';restore.id=saved.kind==='before-remote-restore'?'restoreRecovery':'restoreUnreadable';restore.addEventListener('click',async()=>{
        try{const current=context.storage.recoveryCopies().find(item=>item.kind===saved.kind);if(!current||current.raw!==saved.raw)throw new Error('Recovery copy changed. Review it again.');await context.storage.restore(JSON.parse(current.raw));renderBackupControls();}catch(error){context.toast(error.message);}
      });card.append(restore);}
      if(saved.key){const discard=document.createElement('button');discard.className='secondary danger';discard.textContent='Discard recovery copy…';discard.addEventListener('click',async()=>{try{await context.storage.discardRecovery(saved.kind);renderBackupControls();}catch(error){context.toast(error.message);}});card.append(discard);}
      container.append(card);
    }
  }
  function renderStorageDiagnostics(){
    const label={checking:'Checking browser storage.',persistent:'Persistent storage granted. The browser has agreed to protect this site from automatic storage eviction.',
      'best-effort':'Storage is best effort. The browser may clear it when space is low.',declined:'The browser did not grant persistent storage. Keep an off-device backup.',
      unavailable:'Storage durability information is unavailable in this browser. Keep an off-device backup.'}[context.persistenceState];
    const size=new Blob([JSON.stringify(context.storage.state)]).size;
    context.$('storageDiagnostics').textContent=`Ride data: ${(size/1024).toFixed(1)} KiB. ${label}${context.storageEstimate?` Site usage estimate: ${(context.storageEstimate.usage/1048576).toFixed(1)} MiB of ${(context.storageEstimate.quota/1048576).toFixed(1)} MiB available.`:''}`;
    context.$('requestPersistence').hidden=!['best-effort','declined'].includes(context.persistenceState);
  }
  async function refreshStorageDiagnostics(){
    try{context.persistenceState=typeof navigator.storage?.persisted==='function'?(await navigator.storage.persisted()?'persistent':'best-effort'):'unavailable';
      if(typeof navigator.storage?.estimate==='function'){const estimate=await navigator.storage.estimate();if(Number.isFinite(estimate?.usage)&&Number.isFinite(estimate?.quota))context.storageEstimate=estimate;}
    }catch(error){context.persistenceState='unavailable';}renderStorageDiagnostics();
  }
  async function requestPersistence(fromUser=false){
    if(context.persistenceState==='persistent'||typeof navigator.storage?.persist!=='function')return;
    if(!fromUser){try{if(localStorage.getItem('bike-cardio.v1.persist-asked'))return;}catch(error){return;}}
    try{localStorage.setItem('bike-cardio.v1.persist-asked','1');}catch(error){}
    try{context.persistenceState=await navigator.storage.persist()||await navigator.storage.persisted()?'persistent':'declined';}
    catch(error){context.persistenceState='unavailable';}renderStorageDiagnostics();
    if(fromUser)context.toast(context.persistenceState==='persistent'?'Persistent storage granted.':'Persistence was not granted. Keep a full backup.');
  }
  function maybeRemindBackup(){if(context.backupReminded||!context.storage.backupInfo().stale)return;context.backupReminded=true;context.toast('Your backup needs refreshing. Download a full backup under Backups & cloud storage.');}
  function loadCloudFields(){const cfg=context.storage.remote.loadRemoteConfig();if(!cfg)return;for(const [id,name]of [['cloudEndpoint','endpoint'],['cloudRegion','region'],['cloudBucket','bucket'],['cloudObject','objectKey'],['cloudAccess','accessKeyId']])context.$(id).value=cfg[name]||'';context.$('cloudMode').value=cfg.syncMode||'auto';context.$('cloudPathStyle').checked=cfg.pathStyle;}
    return {renderBackupControls,readJSONUpload,renderRecoveryCopies,renderStorageDiagnostics,refreshStorageDiagnostics,requestPersistence,maybeRemindBackup,loadCloudFields};
  }
};
