/* bike-cardio storage controller. Context getters always read current app state. */
/* exported BikeStorageController */
const BikeStorageController = {
  create(context){
  let panel=null;
  const persistence=WorkoutStorage.createPersistence({askedKey:'bike-cardio.v1.persist-asked',onChange:()=>panel?.refresh()});
  // Backups & cloud storage is the shared panel; Bike supplies its data and wording.
  function storagePanel(){
    return panel ||= WorkoutStorage.createStoragePanel({appName:'Bike Cardio',namespace:'bike-cardio.v1',layout:'bike',remote:context.storage.remote,persistence,
      confirm:WorkoutUI.confirm,toast:context.toast,download:context.downloadJSON,onChange:()=>context.renderStorageStatus(),
      backup:{contents:'ride history, settings and any saved ride',size:()=>new Blob([JSON.stringify(context.storage.state)]).size,download:context.exportFullBackup,
        restore:raw=>context.storage.restore(raw),
        info:()=>{const info=context.storage.backupInfo();return {at:info.at,where:info.where==='cloud storage'?'cloud':info.where?'file':null,stale:info.stale};}},
      recovery:{restore:raw=>context.storage.restore(raw),describe:raw=>Array.isArray(raw.history)?'It holds '+raw.history.length+' rides.':'',
        extra:()=>context.storage.recoveryCopies().filter(item=>item.kind==='legacy').map(item=>({kind:'legacy',raw:item.raw,title:item.label,
          detail:'Bike Cardio could not migrate this older data. Download it before clearing site data.'}))}});
  }
  function renderBackupControls(){
    context.renderStorageStatus();
    if(context.currentView==='settings')storagePanel().refresh();
  }
  function mount(container){storagePanel().mount(container);persistence.refresh();}
  async function readJSONUpload(file){if(file.size>8*1024*1024)throw new Error('File exceeds the 8 MiB import limit.');return JSON.parse(await file.text());}
  // A ride start asks once; the Settings button can ask again.
  async function requestPersistence(fromUser=false){await persistence.request(fromUser);panel?.refresh();}
  function maybeRemindBackup(){if(context.backupReminded||!context.storage.backupInfo().stale)return;context.backupReminded=true;context.toast('Your backup needs refreshing. Download a full backup under Backups & cloud storage.');}
    return {renderBackupControls,readJSONUpload,requestPersistence,maybeRemindBackup,mount,get panel(){return storagePanel();}};
  }
};
