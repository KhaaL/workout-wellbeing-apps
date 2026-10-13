/* Device-local, bounded record recovery. Adapters validate and commit mutations. */
WorkoutStorage.createUndo = function(options){
  const storage=options.storage||localStorage,copy=WorkoutStorage.copy,same=(a,b)=>WorkoutStorage.stableStringify(a)===WorkoutStorage.stableStringify(b);
  function list(){
    const raw=storage.getItem(options.key);if(!raw)return [];
    try{const entries=JSON.parse(raw);if(!Array.isArray(entries))throw Error();return entries.filter(e=>e&&typeof e.id==='string'&&Number.isFinite(e.at)&&e.at>Date.now()-30*86400000&&e.target&&typeof e.label==='string'&&'before'in e&&'after'in e).slice(0,30);}
    catch{throw new Error('Recent changes could not be read. Existing recovery data was kept.');}
  }
  function record({target,before,after,label,deleted=false,coalesce=false},silent=false){
    if(same(before,after))return null;
    try{
      let entries=list();const previous=entries[0];
      const combine=coalesce&&previous&&!previous.deleted&&previous.label===label&&same(previous.target,target)&&same(previous.after,before)&&Date.now()-previous.at<30000;
      const entry={id:combine?previous.id:crypto.randomUUID(),at:Date.now(),target:copy(target),before:copy(combine?previous.before:before),after:copy(after),label,deleted};
      if(combine)entries.shift();entries.unshift(entry);entries=entries.slice(0,30);
      while(new TextEncoder().encode(JSON.stringify(entries)).length>1024*1024&&entries.length>1)entries.pop();
      if(new TextEncoder().encode(JSON.stringify(entries)).length>1024*1024)throw Error('Recovery record is too large');
      storage.setItem(options.key,JSON.stringify(entries));if(!silent)options.onRecord?.(entry);return entry;
    }catch{if(!silent)options.notify?.('Saved, but Undo could not be stored. Download a backup if needed.');return null;}
  }
  function protect(change,commit){
    const previous=storage.getItem(options.key),entry=record(change,true);
    if(!entry)throw new Error('Could not save a recovery copy. Nothing deleted.');
    const staged=storage.getItem(options.key);
    try{if(!commit())throw new Error('Deletion could not be saved. Current data was kept.');}
    catch(error){try{if(storage.getItem(options.key)===staged){if(previous===null)storage.removeItem(options.key);else storage.setItem(options.key,previous);}}catch{}throw error;}
    options.onRecord?.(entry);return entry;
  }
  function undo(id){
    if(options.blocked?.())throw new Error('Finish the handoff or resolve the save warning before restoring changes.');
    const entries=list(),entry=entries.find(e=>e.id===id);if(!entry)throw new Error('This change is no longer available.');
    if(!same(options.read(entry.target),entry.after))throw new Error('This record changed since that edit. Newer changes were kept.');
    if(!options.apply(entry.target,copy(entry.before)))throw new Error('Restoring could not be saved. Current data was kept.');
    // A crash between commit and removal is harmless: the equality guard stops reapplication.
    try{storage.setItem(options.key,JSON.stringify(entries.filter(e=>e.id!==id)));}catch{}
    options.onRestore?.();return true;
  }
  return {list,record,protect,undo};
};
