/* Shared browser storage primitives. App schemas and presentation are adapters. */
globalThis.WorkoutStorage = (() => {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  function stableStringify(value){
    const ordered=entry=>Array.isArray(entry)?entry.map(ordered):entry&&typeof entry==='object'
      ?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,ordered(entry[key])])):entry;
    return JSON.stringify(ordered(value));
  }
  function enforceLimits(obj, counts = {}, maxBytes = 8 * 1024 * 1024) {
    let nodes = 0;
    const visit = (value, depth) => {
      if (++nodes > 200000 || depth > 40) throw new Error('Backup exceeds mobile object/depth limits');
      if (value && typeof value === 'object') Object.values(value).forEach(v => visit(v, depth + 1));
    };
    visit(obj, 0);
    for (const [key, max] of Object.entries(counts))
      if (Array.isArray(obj?.[key]) && obj[key].length > max) throw new Error('Backup exceeds ' + key + ' count limit (' + max + ')');
    if (new TextEncoder().encode(JSON.stringify(obj)).length > maxBytes) throw new Error('Backup exceeds 8 MiB limit');
  }
  function createLocal(options) {
    const storage = options.storage || globalThis.localStorage;
    let timer = 0, pending = false, failed = false, blocked = false, existing = false, warning = '', baseline, observed;
    const cached=new Map(),cacheKeys=new Set(options.cacheKeys||[]);
    function invalidate(changed){for(const key of changed||cacheKeys)cached.delete(key);}
    function serialize(state){
      if(!cacheKeys.size)return JSON.stringify(state);
      return '{'+Object.keys(state).filter(key=>state[key]!==undefined).map(key=>{
        const value=state[key];let part=cached.get(key);
        if(!cacheKeys.has(key)||!part||part.value!==value){part={value,json:JSON.stringify(value)};if(cacheKeys.has(key))cached.set(key,part);}
        return JSON.stringify(key)+':'+part.json;
      }).join(',')+'}';
    }
    const remember=state=>{cached.clear();observed=serialize(state);return state;};
    const notify = () => options.onStatus?.({failed, blocked, warning});
    function rescue(raw, why) {
      try {
        const previous = storage.getItem(options.rescueKey);
        if (previous != null && previous !== raw) throw new Error('A previous recovery copy already exists');
        storage.setItem(options.rescueKey, raw);
        if (storage.getItem(options.rescueKey) !== raw) throw new Error('Recovery copy was not saved');
        warning = why + ' The original was set aside; starting fresh.';
      } catch (error) {
        blocked = true;
        warning = why + ' The original is still stored. Saving is disabled until you restore a valid backup or clear this site\'s storage in your browser settings.';
      }
    }
    function load() {
      let raw;
      try { raw = storage.getItem(options.key); baseline = raw; }
      catch (error) { failed = true; warning = 'Browser storage is unavailable. Export a backup before closing.'; return remember(options.seed()); }
      if (!raw) {
        if (options.legacy) {
          try { const migrated = options.legacy(); if (migrated) { existing = true; return remember(options.prepare(migrated, {local:true})); } }
          catch (error) { blocked = true; warning = 'Existing data could not be migrated: ' + error.message + '. Original data retained; saving is disabled.'; }
        }
        return remember(options.seed());
      }
      try { const candidate = options.prepare(JSON.parse(raw), {local:true}); existing = true; return remember(candidate); }
      catch (error) { rescue(raw, 'Saved data could not be loaded: ' + error.message); return remember(options.seed()); }
    }
    function flush() {
      clearTimeout(timer); timer = 0;
      if (!pending) return !failed;
      pending = false;
      if (blocked) { failed = true; notify(); return false; }
      try {
        const serialized=serialize(options.getState()),current=storage.getItem(options.key);
        if(baseline!==undefined&&current!==baseline&&current!==serialized){pending=true;failed=true;warning='Another tab changed this app’s data. Download a backup of this tab’s changes, then reload to review the saved copy.';notify();return false;}
        if(current!==serialized)storage.setItem(options.key,serialized);baseline=serialized;observed=serialized;failed=false;notify();return true;
      }
      catch (error) { pending = true; failed = true; notify(); return false; }
    }
    function save(opts = {}) {
      invalidate(opts.changed);
      const before=serialize(options.getState()),changed=before!==observed;
      if(!changed&&!blocked&&!failed&&(pending||before===baseline))return opts.immediate?flush():true;
      if (changed&&opts.touch !== false) options.touch?.();
      observed=serialize(options.getState());
      pending = true; clearTimeout(timer);
      if (changed&&opts.remote !== false) options.onChange?.();
      if (opts.immediate) return flush();
      timer = setTimeout(flush, options.delay ?? 300);
    }
    // Persist before replacing live state. Each key write is atomic; preserve the
    // previous state first, so a failed replacement remains recoverable.
    function commit(candidate, recovery) {
      try {
        const serialized=JSON.stringify(candidate),current=storage.getItem(options.key);
        if(baseline!==undefined&&current!==baseline&&current!==serialized){failed=true;warning='Another tab changed this app’s data. Download a backup of this tab’s changes, then reload before replacing it.';notify();return false;}
        if (recovery) storage.setItem(recovery.key, JSON.stringify(recovery.payload));
        storage.setItem(options.key,serialized);baseline=serialized;observed=serialized;cached.clear();
      } catch (error) { failed = true; notify(); return false; }
      clearTimeout(timer); timer = 0; pending = false; failed = false; blocked = false; existing = true; warning = '';
      options.setState(candidate); notify(); return true;
    }
    return {load, save, flush, commit, rescue, get failed(){return failed;}, get blocked(){return blocked;},
      get pending(){return pending;}, get warning(){return warning;}, get existing(){return existing;}, set existing(value){existing = value;}};
  }
  return {version:'1.0.0', copy, stableStringify, enforceLimits, createLocal};
})();
