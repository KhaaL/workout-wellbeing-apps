/* Foodlog model: foods, frozen food versions, logged entries and the arithmetic
   over them. Pure functions; the storage adapter saves and app.js renders.

   A food's nutrients describe 100 g, 100 ml or one portion (its basis). null
   means unknown and never counts as 0. Logging freezes the food's values as a
   version, keyed by food id and a hash of those values, so correcting a label
   later leaves earlier days unchanged. Entries store only that key. */
/* exported FoodCore */
const FoodCore = (() => {
  const NUTRIENTS = [
    ['energy_kcal','Energy','kcal'],['energy_kj','Energy','kJ'],['protein_g','Protein','g'],['carbohydrate_g','Carbohydrate','g'],
    ['sugars_g','Sugars','g'],['fibre_g','Fibre','g'],['fat_g','Fat','g'],['saturated_fat_g','Saturated fat','g'],['salt_g','Salt','g']
  ].map(([key,label,unit])=>({key,label,unit}));
  const KEYS = NUTRIENTS.map(n=>n.key);
  // Labels give total sugars; a sugar limit means free sugars, so sugars take no target.
  const TARGET_KEYS = KEYS.filter(key=>key!=='sugars_g'&&key!=='energy_kj');
  const KINDS = {product:'Product',generic:'Everyday food',dish:'Dish'};
  const SOURCES = {label:'Label',typical:'Typical values',menu:'Menu'};
  const BASES = {g:'100 g',ml:'100 ml',portion:'portion'};
  const UNITS = {g:'g',ml:'ml',portion:'portion'};
  const LIMITS = {foods:5000,entries:20000,versions:20000,days:20000,portions:12,micros:20,meals:12,targets:12,details:16384};
  const DEFAULT_MEALS = ['Breakfast','Lunch','Dinner','Snack'];
  const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, MICRO = /^[a-z][a-z0-9_]{0,40}_(g|mg|ug)$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const MODELLED = ['id','name','brand','nutrition_per_100g','nutrition_per_100ml','nutrition_per_portion','micronutrients_per_100g','micronutrients_per_100ml','micronutrients_per_portion','foodlog'];
  const TABLE = {g:'100g',ml:'100ml',portion:'portion'};

  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };
  function text(value, max, label, required = false){
    if (value == null || value === '') { if (required) fail(label + ' is required.'); return ''; }
    if (typeof value !== 'string' || value.length > max) fail(label + ' must be text of at most ' + max + ' characters.');
    const trimmed = value.trim(); if (required && !trimmed) fail(label + ' is required.');
    return trimmed;
  }
  function number(value, label, min, max){
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(label + ' must be a number from ' + min + ' to ' + max + '.');
    return value;
  }
  function stable(value){
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (isObject(value)) return '{' + Object.keys(value).sort().map(key=>JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hash(value){
    let h = 0x811c9dc5; const s = stable(value);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  const validDate = value => typeof value === 'string' && DATE.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

  function nutrients(raw, label){
    if (!isObject(raw)) fail(label + ' needs a nutrition table.');
    const out = {};
    for (const key of KEYS) out[key] = raw[key] == null ? null : number(raw[key], label + ' ' + key, 0, 10000);
    // A kJ-only label still gives energy: 1 kcal = 4.184 kJ.
    if (out.energy_kcal == null && out.energy_kj != null) out.energy_kcal = Math.round(out.energy_kj / 4.184);
    return out;
  }
  function micros(raw, label){
    if (raw == null) return {};
    if (!isObject(raw)) fail(label + ' micronutrients must be an object.');
    const entries = Object.entries(raw).filter(([, value])=>value != null);
    if (entries.length > LIMITS.micros) fail(label + ' has more than ' + LIMITS.micros + ' micronutrients.');
    return Object.fromEntries(entries.map(([key, value])=>{
      if (!MICRO.test(key) || KEYS.includes(key)) fail(label + ' micronutrient ' + key + ' needs a _g, _mg or _ug name.');
      return [key, number(value, label + ' ' + key, 0, 100000)];
    }));
  }
  function portions(raw, label){
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > LIMITS.portions) fail(label + ' allows at most ' + LIMITS.portions + ' portions.');
    const seen = new Set();
    return raw.map(p=>{
      if (!isObject(p)) fail(label + ' has an invalid portion.');
      const portion = {label:text(p.label, 40, 'Portion name', true), amount:number(p.amount, 'Portion amount', 0.01, 5000)};
      if (seen.has(portion.label.toLowerCase())) fail(label + ' repeats the portion ' + portion.label + '.');
      seen.add(portion.label.toLowerCase()); return portion;
    });
  }
  function details(raw){
    if (raw == null) return null;
    if (!isObject(raw)) fail('Food details must be an object.');
    if (JSON.stringify(raw).length > LIMITS.details) fail('Food details exceed ' + LIMITS.details + ' characters.');
    return JSON.parse(JSON.stringify(raw));
  }
  function food(raw){
    if (!isObject(raw)) fail('Invalid food.');
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail('Food ids use letters, digits, dot, dash or underscore (at most 80).');
    const name = text(raw.name, 120, 'Food name', true), label = '“' + name + '”';
    if (!Object.hasOwn(KINDS, raw.kind)) fail(label + ' has an unknown kind.');
    if (!Object.hasOwn(BASES, raw.basis)) fail(label + ' has an unknown basis.');
    if (!Object.hasOwn(SOURCES, raw.source)) fail(label + ' has an unknown source.');
    for (const flag of ['estimate','inFile','archived']) if (raw[flag] != null && typeof raw[flag] !== 'boolean') fail(label + ' has an invalid ' + flag + ' flag.');
    const out = {id:raw.id, name, brand:text(raw.brand, 80, 'Brand'), kind:raw.kind, basis:raw.basis, nutrients:nutrients(raw.nutrients, label),
      micros:micros(raw.micros, label), portions:portions(raw.portions, label), source:raw.source, estimate:!!raw.estimate, note:text(raw.note, 500, 'Food note')};
    const extra = details(raw.details); if (extra) out.details = extra;
    if (raw.inFile) out.inFile = true; if (raw.archived) out.archived = true;
    return out;
  }
  // The frozen part of a food: what a logged amount is computed from.
  function frozen(f){ return {name:f.name, brand:f.brand, basis:f.basis, nutrients:f.nutrients, micros:f.micros, source:f.source, estimate:f.estimate}; }
  // A deep copy: editing the food later must not reach the frozen version.
  function versionOf(f){ const value = JSON.parse(JSON.stringify(frozen(f))); return {key:f.id + '@' + hash(value), value}; }
  function version(raw, key){
    if (typeof key !== 'string' || key.length > 100 || !ID.test(key.split('@')[0]) || !/^[^@]+@[0-9a-f]{8}$/.test(key)) fail('Invalid food version key.');
    if (!isObject(raw)) fail('Invalid food version.');
    const name = text(raw.name, 120, 'Food name', true);
    if (!Object.hasOwn(BASES, raw.basis) || !Object.hasOwn(SOURCES, raw.source) || typeof raw.estimate !== 'boolean') fail('Invalid food version for ' + name + '.');
    return {name, brand:text(raw.brand, 80, 'Brand'), basis:raw.basis, nutrients:nutrients(raw.nutrients, name), micros:micros(raw.micros, name), source:raw.source, estimate:raw.estimate};
  }
  function entry(raw, versions){
    if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 100) fail('Invalid log entry.');
    if (!validDate(raw.date)) fail('Invalid entry date.');
    if (typeof raw.time !== 'string' || !TIME.test(raw.time)) fail('Invalid entry time.');
    if (!Object.hasOwn(versions, raw.version)) fail('A log entry refers to a missing food version.');
    const out = {id:raw.id, date:raw.date, time:raw.time, meal:text(raw.meal, 40, 'Meal', true), version:raw.version, amount:number(raw.amount, 'Amount', 0.01, 100000)};
    const portion = text(raw.portion, 40, 'Portion'), note = text(raw.note, 300, 'Entry note');
    if (portion) out.portion = portion; if (note) out.note = note;
    return out;
  }
  function settings(raw = {}){
    if (!isObject(raw)) fail('Invalid settings.');
    const targets = raw.targets ?? [], seen = new Set();
    if (!Array.isArray(targets) || targets.length > LIMITS.targets) fail('Invalid daily targets.');
    const meals = raw.meals ?? DEFAULT_MEALS;
    if (!Array.isArray(meals) || !meals.length || meals.length > LIMITS.meals) fail('Provide 1 to ' + LIMITS.meals + ' meals.');
    const mealNames = meals.map(m=>text(m, 40, 'Meal', true));
    if (new Set(mealNames.map(m=>m.toLowerCase())).size !== mealNames.length) fail('Meal names must differ.');
    const dayStart = raw.dayStart ?? '04:00';
    if (typeof dayStart !== 'string' || !TIME.test(dayStart)) fail('Day change time must be HH:MM.');
    const out = {targets:targets.map(t=>{
      if (!isObject(t) || !TARGET_KEYS.includes(t.key) || !['min','max'].includes(t.kind)) fail('Invalid daily target.');
      if (seen.has(t.key)) fail('Each nutrient takes one target.'); seen.add(t.key);
      return {key:t.key, kind:t.kind, value:number(t.value, 'Target', 0.1, 100000)};
    }), meals:mealNames, dayStart};
    if (raw.catalog != null){
      const c = raw.catalog;
      if (!isObject(c) || JSON.stringify(c).length > LIMITS.details * 2) fail('Invalid catalog information.');
      out.catalog = {schemaVersion:text(c.schemaVersion, 20, 'Schema version'), revision:c.revision == null ? null : number(c.revision, 'Catalog revision', 0, 1e9),
        updated:text(c.updated, 40, 'Catalog date'), notes:text(c.notes, 2000, 'Catalog notes'), importedAt:c.importedAt == null ? null : number(c.importedAt, 'Import time', 0, 8.64e15),
        extra:isObject(c.extra) ? JSON.parse(JSON.stringify(c.extra)) : {}};
    }
    return out;
  }
  function days(raw = {}){
    if (!isObject(raw) || Object.keys(raw).length > LIMITS.days) fail('Invalid day notes.');
    const out = {};
    for (const [date, day] of Object.entries(raw)){
      if (!validDate(date) || !isObject(day)) fail('Invalid day notes.');
      const notes = text(day.notes, 2000, 'Day notes'), activity = text(day.activity, 500, 'Activity');
      if (notes || activity) out[date] = {...(notes ? {notes} : {}), ...(activity ? {activity} : {})};
    }
    return out;
  }
  // Full validation of the saved state; returns a normalized copy.
  function state(raw){
    if (!isObject(raw)) fail('Invalid Foodlog data.');
    for (const [key, max] of [['foods',LIMITS.foods],['entries',LIMITS.entries]])
      if (!Array.isArray(raw[key]) || raw[key].length > max) fail('Foodlog ' + key + ' must be a list of at most ' + max + '.');
    if (!isObject(raw.versions) || Object.keys(raw.versions).length > LIMITS.versions) fail('Invalid food versions.');
    const ids = new Set(), foods = raw.foods.map(f=>{const out = food(f); if (ids.has(out.id)) fail('Food ids must be unique: ' + out.id); ids.add(out.id); return out;});
    const versions = Object.fromEntries(Object.entries(raw.versions).map(([key, value])=>[key, version(value, key)]));
    const entryIds = new Set(), entries = raw.entries.map(e=>{const out = entry(e, versions); if (entryIds.has(out.id)) fail('Entry ids must be unique.'); entryIds.add(out.id); return out;});
    return {settings:settings(raw.settings), foods, versions, entries, days:days(raw.days)};
  }

  /* Arithmetic. */
  const factor = (basis, amount) => basis === 'portion' ? amount : amount / 100;
  function scaled(v, amount){
    const f = factor(v.basis, amount), out = {}, extra = {};
    for (const key of KEYS) out[key] = v.nutrients[key] == null ? null : v.nutrients[key] * f;
    for (const [key, value] of Object.entries(v.micros || {})) extra[key] = value * f;
    return {nutrients:out, micros:extra};
  }
  // Known values add up; unknown ones are counted per nutrient instead.
  function total(items){
    const sums = Object.fromEntries(KEYS.map(key=>[key, 0])), unknown = Object.fromEntries(KEYS.map(key=>[key, 0])), micro = {};
    let estimatedKcal = 0;
    for (const {v, amount} of items){
      const s = scaled(v, amount);
      for (const key of KEYS) if (s.nutrients[key] == null) unknown[key]++; else sums[key] += s.nutrients[key];
      for (const [key, value] of Object.entries(s.micros)) micro[key] = (micro[key] || 0) + value;
      if (v.estimate && s.nutrients.energy_kcal != null) estimatedKcal += s.nutrients.energy_kcal;
    }
    const microUnknown = Object.fromEntries(Object.keys(micro).map(key=>[key, items.filter(({v})=>!(key in (v.micros || {}))).length]));
    return {sums, unknown, micros:micro, microUnknown, count:items.length, estimatedShare:sums.energy_kcal > 0 ? estimatedKcal / sums.energy_kcal : 0};
  }
  function evaluate(target, sums, unknown){
    const value = sums[target.key], missing = unknown[target.key];
    // An unknown value can only add to a total: a met minimum stays met, a passed maximum stays passed.
    const status = target.kind === 'min' ? (value >= target.value ? 'met' : 'short') : (value > target.value ? 'over' : 'under');
    return {...target, current:value, missing, status, share:target.value ? value / target.value : 0};
  }
  function round(value, unit){
    if (value == null) return null;
    if (unit === 'kcal' || unit === 'kJ') return Math.round(value);
    return Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  }
  function format(value, unit){
    if (value == null) return '—';
    return round(value, unit).toLocaleString('en', {maximumFractionDigits:1}) + ' ' + unit;
  }
  const microUnit = key => key.endsWith('_ug') ? 'µg' : key.endsWith('_mg') ? 'mg' : 'g';
  const microLabel = key => { const name = key.replace(/_(g|mg|ug)$/, '').replace(/_/g, ' '); return name[0].toUpperCase() + name.slice(1); };

  /* Days. */
  const pad = n => String(n).padStart(2, '0');
  const localDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const localTime = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  // Before the change time (04:00 by default) a log still belongs to the previous day.
  function dayFor(now, dayStart = '04:00'){
    const d = new Date(now);
    if (localTime(d) < dayStart) d.setDate(d.getDate() - 1);
    return localDate(d);
  }
  function shiftDate(date, days){ const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return localDate(d); }
  function mealOrder(meals, entries){
    const extra = [...new Set(entries.map(e=>e.meal))].filter(m=>!meals.includes(m));
    return [...meals, ...extra];
  }
  function day(s, date){
    const entries = s.entries.filter(e=>e.date === date).sort((a, b)=>a.time.localeCompare(b.time));
    const items = entries.map(e=>({entry:e, v:s.versions[e.version], amount:e.amount}));
    const meals = mealOrder(s.settings.meals, entries).map(meal=>{const list = items.filter(i=>i.entry.meal === meal); return {meal, items:list, total:total(list)};});
    const sum = total(items);
    return {date, meals, total:sum, targets:s.settings.targets.map(t=>evaluate(t, sum.sums, sum.unknown)), notes:s.days[date] || {}};
  }
  function loggedDays(s){
    return [...new Set(s.entries.map(e=>e.date))].sort().reverse();
  }

  /* Search: accents fold away, so "jordnotssmor" finds Jordnötssmör. */
  const fold = value => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const foodIdOf = key => key.slice(0, key.lastIndexOf('@'));
  function search(s, {query = '', meal = '', archived = false} = {}){
    const words = fold(query).split(/\s+/).filter(Boolean), use = new Map();
    for (const e of s.entries){
      const id = foodIdOf(e.version), u = use.get(id) || {count:0, last:'', meal:''};
      u.count++; if (e.date + e.time > u.last) u.last = e.date + e.time;
      if (e.meal === meal && e.date + e.time > u.meal) u.meal = e.date + e.time;
      use.set(id, u);
    }
    return s.foods.filter(f=>(archived || !f.archived) && words.every(w=>fold(f.name + ' ' + f.brand).includes(w)))
      .map(f=>({food:f, use:use.get(f.id) || {count:0, last:'', meal:''}}))
      // Latest use in this meal first, then the most used, then by name; '' sorts last.
      .sort((a, b)=>b.use.meal.localeCompare(a.use.meal) || b.use.count - a.use.count || a.food.name.localeCompare(b.food.name))
      .map(r=>r.food);
  }
  function usage(s, foodId){ return s.entries.filter(e=>foodIdOf(e.version) === foodId).length; }
  // Keep only versions some entry still uses.
  function prune(s){
    const used = new Set(s.entries.map(e=>e.version));
    for (const key of Object.keys(s.versions)) if (!used.has(key)) delete s.versions[key];
    return s;
  }
  function log(s, f, fields, id){
    const {key, value} = versionOf(f);
    if (!s.versions[key]) s.versions[key] = value;
    const e = entry({...fields, id, version:key}, s.versions);
    s.entries.push(e); return e;
  }
  // Amount, time, meal, portion and note change; the frozen values stay.
  function updateEntry(s, id, fields){
    const index = s.entries.findIndex(e=>e.id === id);
    if (index < 0) fail('That log entry no longer exists.');
    const e = entry({...s.entries[index], ...fields, id}, s.versions);
    s.entries[index] = e; return e;
  }

  /* Catalog file, schema 1.x: { schema_version, revision, updated, notes,
     personal_budgets_per_day, products: [...] }. Fields Foodlog does not model
     are kept per product as details and written back on export. */
  function fromProduct(p){
    if (!isObject(p)) fail('A product is not an object.');
    const own = isObject(p.foodlog) ? p.foodlog : {}, basis = isObject(p.nutrition_per_100g) ? 'g' : isObject(p.nutrition_per_100ml) ? 'ml' : isObject(p.nutrition_per_portion) ? 'portion' : null;
    if (!basis) fail('no nutrition_per_100g, nutrition_per_100ml or nutrition_per_portion table');
    const serving = isObject(p.serving) ? p.serving : {}, filePortions = [];
    if (basis === 'g' && typeof serving.unit_weight_g === 'number') filePortions.push({label:'1 piece', amount:serving.unit_weight_g});
    if (basis === 'g' && typeof serving.powder_g === 'number') filePortions.push({label:'1 serving', amount:serving.powder_g});
    if (basis === 'ml' && typeof serving.unit_volume_ml === 'number') filePortions.push({label:'1 serving', amount:serving.unit_volume_ml});
    const rest = Object.fromEntries(Object.entries(p).filter(([key])=>!MODELLED.includes(key)));
    let extra = Object.keys(rest).length ? rest : null, dropped = false;
    if (extra && JSON.stringify(extra).length > LIMITS.details) { extra = null; dropped = true; }
    const merged = [...portions(own.portions, String(p.name)), ...filePortions.filter(fp=>!(own.portions || []).some(op=>String(op.label).toLowerCase() === fp.label))];
    const out = food({id:p.id, name:p.name, brand:p.brand ?? '', kind:own.kind ?? 'product', basis, nutrients:p['nutrition_per_' + TABLE[basis]],
      micros:p['micronutrients_per_' + TABLE[basis]], portions:merged.slice(0, LIMITS.portions), source:own.source ?? 'label', estimate:own.estimate ?? false,
      note:own.note ?? '', archived:own.archived ?? false, details:extra, inFile:true});
    return {food:out, dropped};
  }
  const labelFields = f => stable({name:f.name, brand:f.brand, kind:f.kind, basis:f.basis, nutrients:f.nutrients, micros:f.micros, source:f.source, estimate:f.estimate, note:f.note, details:f.details || null});
  // Returns the merged food list and a report; the caller confirms before applying.
  function importCatalog(raw, s){
    if (!isObject(raw) || !Array.isArray(raw.products)) fail('Not a catalog file: it needs a products list.');
    if (typeof raw.schema_version !== 'string' || !/^1(\.|$)/.test(raw.schema_version)) fail('Unsupported catalog schema_version: Foodlog reads 1.x.');
    if (raw.products.length > LIMITS.foods) fail('The catalog has more than ' + LIMITS.foods + ' products.');
    const revision = raw.revision == null ? null : number(raw.revision, 'Catalog revision', 0, 1e9);
    const report = {added:[], updated:[], unchanged:[], notInFile:[], skipped:[], detailsDropped:[], portionsReset:[]}, byId = new Map(s.foods.map(f=>[f.id, f])), seen = new Set();
    const foods = s.foods.map(f=>({...f}));
    for (const p of raw.products){
      let mapped;
      try { mapped = fromProduct(p); } catch (error) { report.skipped.push({id:String(p?.id ?? '?'), reason:error.message}); continue; }
      const incoming = mapped.food;
      if (seen.has(incoming.id)) { report.skipped.push({id:incoming.id, reason:'repeated id'}); continue; }
      seen.add(incoming.id); if (mapped.dropped) report.detailsDropped.push(incoming.name);
      const current = byId.get(incoming.id);
      if (!current) { foods.push(incoming); report.added.push(incoming.name); continue; }
      // Label values come from the file; portions and archiving made here stay.
      const sameBasis = current.basis === incoming.basis;
      if (!sameBasis && current.portions.length) report.portionsReset.push(incoming.name);
      const local = sameBasis ? current.portions : [];
      const merged = {...incoming, portions:[...local, ...incoming.portions.filter(p=>!local.some(l=>l.label.toLowerCase() === p.label.toLowerCase()))].slice(0, LIMITS.portions)};
      if (current.archived) merged.archived = true;
      const index = foods.findIndex(f=>f.id === incoming.id);
      (labelFields(current) === labelFields(merged) && stable(current.portions) === stable(merged.portions) ? report.unchanged : report.updated).push(incoming.name);
      foods[index] = merged;
    }
    for (const f of foods) if (f.inFile && !seen.has(f.id)) { delete f.inFile; report.notInFile.push(f.name); }
    const budgets = isObject(raw.personal_budgets_per_day) ? raw.personal_budgets_per_day : null, targets = [], ignored = [];
    if (budgets) for (const [group, kind] of [['contribution','min'],['limit','max']]) for (const [key, value] of Object.entries(isObject(budgets[group]) ? budgets[group] : {})){
      if (TARGET_KEYS.includes(key) && typeof value === 'number' && value > 0) targets.push({key, kind, value}); else ignored.push(key);
    }
    const extra = Object.fromEntries(Object.entries(raw).filter(([key])=>!['schema_version','revision','updated','notes','products'].includes(key)));
    if (JSON.stringify(extra).length > LIMITS.details * 2) fail('The catalog file header is too large.');
    const catalog = {schemaVersion:raw.schema_version, revision, updated:typeof raw.updated === 'string' ? raw.updated.slice(0, 40) : '', notes:typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : '', extra};
    const previous = s.settings.catalog?.revision;
    return {foods, report, catalog, targets:budgets ? targets : null, ignoredTargets:ignored, older:previous != null && revision != null && revision < previous};
  }
  function exportCatalog(s, now){
    const c = s.settings.catalog || {schemaVersion:'1.0', revision:null, updated:'', notes:'', extra:{}};
    const out = {schema_version:c.schemaVersion || '1.0', revision:c.revision ?? 0, updated:c.updated || localDate(new Date(now)), notes:c.notes || '', ...c.extra};
    const old = isObject(c.extra?.personal_budgets_per_day) ? c.extra.personal_budgets_per_day : {};
    // Targets set here replace the file's values for nutrients Foodlog tracks; other keys (such as a sugar limit) stay.
    const keep = group => Object.fromEntries(Object.entries(isObject(old[group]) ? old[group] : {}).filter(([key])=>!TARGET_KEYS.includes(key)));
    const pick = kind => Object.fromEntries(s.settings.targets.filter(t=>t.kind === kind).map(t=>[t.key, t.value]));
    out.personal_budgets_per_day = {...old, contribution:{...keep('contribution'), ...pick('min')}, limit:{...keep('limit'), ...pick('max')}};
    out.exported_by = 'Foodlog'; out.exported_at = new Date(now).toISOString();
    out.products = s.foods.map(f=>{
      const p = {id:f.id, name:f.name, ...(f.brand ? {brand:f.brand} : {}), ...(f.details || {})};
      p['nutrition_per_' + TABLE[f.basis]] = {...f.nutrients};
      if (Object.keys(f.micros).length) p['micronutrients_per_' + TABLE[f.basis]] = {...f.micros};
      p.foodlog = {kind:f.kind, source:f.source, estimate:f.estimate, portions:f.portions, ...(f.note ? {note:f.note} : {}), ...(f.archived ? {archived:true} : {})};
      return p;
    });
    return out;
  }

  /* Day export in the food_log shape used for reviews. */
  const sourceText = (v, s) => v.source === 'label' ? 'Foodlog catalog' + (s.settings.catalog?.revision != null ? ' (file revision ' + s.settings.catalog.revision + ')' : '') + ', label values'
    : v.source === 'menu' ? 'menu values' : 'typical values, estimate';
  const two = value => value == null ? null : Math.round(value * 100) / 100;
  const one = value => value == null ? null : Math.round(value * 10) / 10;
  const shown = KEYS.filter(key=>key !== 'energy_kj');
  function exportDay(s, date){
    const d = day(s, date), targets = {};
    for (const t of s.settings.targets) targets[t.kind === 'max' ? t.key + '_max' : t.key] = t.value;
    const sumBlock = (sums, unknown) => Object.fromEntries(shown.map(key=>[key, one(sums[key])]).concat(shown.filter(key=>unknown[key]).length ? [['unknown_items', Object.fromEntries(shown.filter(key=>unknown[key]).map(key=>[key, unknown[key]]))]] : []));
    return {
      date, notes:d.notes.notes || '', activity:(d.notes.activity || '').split('\n').map(line=>line.trim()).filter(Boolean), targets,
      meals:d.meals.filter(m=>m.items.length).map(m=>({meal:m.meal, items:m.items.map(({entry:e, v, amount})=>{
        const n = scaled(v, amount).nutrients, item = {item:v.brand ? v.brand + ' ' + v.name : v.name, time:e.time};
        if (v.basis === 'portion') item.amount = amount + (amount === 1 ? ' portion' : ' portions'); else item['amount_' + v.basis] = two(amount);
        if (e.portion) item.portion = e.portion;
        item.source = sourceText(v, s); if (v.estimate) item.estimate = true;
        item.nutrition = Object.fromEntries(shown.map(key=>[key, two(n[key])]));
        if (e.note) item.assumption = e.note;
        return item;
      }), subtotal:sumBlock(m.total.sums, m.total.unknown)})),
      day_total_eaten:sumBlock(d.total.sums, d.total.unknown),
      estimated_energy_share:Math.round(d.total.estimatedShare * 100) / 100,
      exported_by:'Foodlog'
    };
  }

  return {NUTRIENTS, KEYS, TARGET_KEYS, KINDS, SOURCES, BASES, UNITS, LIMITS, DEFAULT_MEALS,
    food, settings, state, versionOf, scaled, total, evaluate, round, format, microUnit, microLabel,
    dayFor, shiftDate, localDate, localTime, day, loggedDays, fold, search, usage, prune, log, updateEntry, foodIdOf,
    importCatalog, exportCatalog, exportDay, hash};
})();
