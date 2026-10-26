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
  /* Labels give total sugars, so a sugar limit applies to free sugars: the
     sugars of foods marked as free sugars (honey, syrups, sweets). Each food
     carries that mark; it is read live, so marking a food updates past days. */
  const FREE = 'free_sugars_g';
  // Vitamins and minerals offered when editing a food and as daily targets.
  const COMMON_MICROS = ['vitamin_d_ug','vitamin_b12_ug','folate_ug','vitamin_c_mg','calcium_mg','iron_mg','iodine_ug','potassium_mg','magnesium_mg','zinc_mg'];
  const TARGET_KEYS = [...KEYS.filter(key=>key!=='sugars_g'&&key!=='energy_kj'), FREE, ...COMMON_MICROS];
  const KINDS = {product:'Product',generic:'Everyday food',dish:'Dish'};
  const SOURCES = {label:'Label',typical:'Typical values',menu:'Menu'};
  const BASES = {g:'100 g',ml:'100 ml',portion:'portion'};
  const UNITS = {g:'g',ml:'ml',portion:'portion'};
  const LIMITS = {foods:5000,entries:20000,versions:20000,days:20000,portions:12,micros:20,meals:12,targets:12,details:16384,dayMeals:20,dayItems:300};
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
    for (const flag of ['estimate','inFile','archived','favourite']) if (raw[flag] != null && typeof raw[flag] !== 'boolean') fail(label + ' has an invalid ' + flag + ' flag.');
    if (raw.freeSugars != null && !['yes','no'].includes(raw.freeSugars)) fail(label + ' has an invalid free sugars mark.');
    const out = {id:raw.id, name, brand:text(raw.brand, 80, 'Brand'), kind:raw.kind, basis:raw.basis, nutrients:nutrients(raw.nutrients, label),
      micros:micros(raw.micros, label), portions:portions(raw.portions, label), source:raw.source, estimate:!!raw.estimate, note:text(raw.note, 500, 'Food note')};
    const extra = details(raw.details); if (extra) out.details = extra;
    if (raw.inFile) out.inFile = true; if (raw.archived) out.archived = true; if (raw.favourite) out.favourite = true;
    if (raw.freeSugars) out.freeSugars = raw.freeSugars;
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
    // A time is optional: an imported day file may give none.
    const time = raw.time ?? '';
    if (time !== '' && (typeof time !== 'string' || !TIME.test(time))) fail('Invalid entry time.');
    if (!Object.hasOwn(versions, raw.version)) fail('A log entry refers to a missing food version.');
    const out = {id:raw.id, date:raw.date, ...(time ? {time} : {}), meal:text(raw.meal, 40, 'Meal', true), version:raw.version, amount:number(raw.amount, 'Amount', 0.01, 100000)};
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
      // An imported day keeps the meal order of its file.
      if (day.meals != null && (!Array.isArray(day.meals) || day.meals.length > LIMITS.dayMeals)) fail('Invalid meal order for ' + date + '.');
      const meals = (day.meals || []).map(m=>text(m, 40, 'Meal', true));
      if (new Set(meals.map(m=>m.toLowerCase())).size !== meals.length) fail('Invalid meal order for ' + date + '.');
      if (notes || activity || meals.length) out[date] = {...(notes ? {notes} : {}), ...(activity ? {activity} : {}), ...(meals.length ? {meals} : {})};
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
  // Known values add up; unknown ones are counted per nutrient instead. An item's
  // free sugars are its sugars when its food is marked 'yes', 0 when 'no' (or
  // when it has no sugars), and unknown otherwise.
  function total(items){
    const sums = Object.fromEntries([...KEYS, FREE].map(key=>[key, 0])), unknown = Object.fromEntries([...KEYS, FREE].map(key=>[key, 0])), micro = {};
    let estimatedKcal = 0;
    for (const {v, amount, free} of items){
      const s = scaled(v, amount), sugars = s.nutrients.sugars_g;
      for (const key of KEYS) if (s.nutrients[key] == null) unknown[key]++; else sums[key] += s.nutrients[key];
      const freeSugars = sugars === 0 || free === 'no' ? 0 : free === 'yes' ? sugars : null;
      if (freeSugars == null) unknown[FREE]++; else sums[FREE] += freeSugars;
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
  // Label and unit for any nutrient, free sugars or micronutrient key.
  function describe(key){
    const n = NUTRIENTS.find(x=>x.key === key);
    if (n) return {label:n.label, unit:n.unit};
    if (key === FREE) return {label:'Free sugars', unit:'g'};
    return {label:microLabel(key).replace(/^Vitamin (\w)/, (m, c)=>'Vitamin ' + c.toUpperCase()), unit:microUnit(key)};
  }
  // Targets read nutrients, free sugars and micronutrients alike; a micronutrient no item lists is unknown for all.
  function evaluateAll(targets, t){
    return targets.map(target=>{
      if (target.key in t.sums) return evaluate(target, t.sums, t.unknown);
      return evaluate(target, {[target.key]:t.micros[target.key] ?? 0}, {[target.key]:target.key in t.microUnknown ? t.microUnknown[target.key] : t.count});
    });
  }

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
  // The day's own order (from an imported file) first, then the meal list, then any other meal.
  function mealOrder(meals, entries, first = []){
    const order = [...first, ...meals.filter(m=>!first.includes(m))];
    const extra = [...new Set(entries.map(e=>e.meal))].filter(m=>!order.includes(m));
    return [...order, ...extra];
  }
  function day(s, date){
    // Untimed entries keep their logged order, ahead of timed ones.
    const entries = s.entries.filter(e=>e.date === date).sort((a, b)=>(a.time || '').localeCompare(b.time || ''));
    const marks = new Map(s.foods.map(f=>[f.id, f.freeSugars]));
    const items = entries.map(e=>({entry:e, v:s.versions[e.version], amount:e.amount, free:marks.get(foodIdOf(e.version))}));
    const meals = mealOrder(s.settings.meals, entries, s.days[date]?.meals).map(meal=>{const list = items.filter(i=>i.entry.meal === meal); return {meal, items:list, total:total(list)};});
    const sum = total(items);
    return {date, meals, total:sum, targets:evaluateAll(s.settings.targets, sum), notes:s.days[date] || {}};
  }
  function loggedDays(s){
    return [...new Set(s.entries.map(e=>e.date))].sort().reverse();
  }
  /* Meals from the days before `date` (up to 14 days back) to copy: the same meal
     name first, newest first, then other meals. */
  function recentMeals(s, date, meal){
    const from = shiftDate(date, -14), groups = new Map();
    for (const e of s.entries) if (e.date < date && e.date >= from){
      const key = e.date + '\n' + e.meal;
      if (!groups.has(key)) groups.set(key, {date:e.date, meal:e.meal, entries:[]});
      groups.get(key).entries.push(e);
    }
    const same = m => m.meal.toLowerCase() === String(meal).toLowerCase();
    return [...groups.values()].sort((a, b)=>same(b) - same(a) || b.date.localeCompare(a.date) || a.meal.localeCompare(b.meal))
      .map(g=>({...g, total:total(g.entries.map(e=>({v:s.versions[e.version], amount:e.amount})))}));
  }
  /* Copies a meal into another day and meal. A food still in the catalog with the
     same unit is logged at its current values; otherwise the original values are reused. */
  function copyMeal(s, source, toDate, toMeal, newId){
    if (!validDate(toDate)) fail('Invalid date.');
    const copied = [], versions = {...s.versions};
    for (const e of source.entries){
      const f = s.foods.find(x=>x.id === foodIdOf(e.version));
      let key = e.version;
      if (f && f.basis === s.versions[e.version]?.basis){ const v = versionOf(f); versions[v.key] ||= v.value; key = v.key; }
      copied.push(entry({id:newId(), date:toDate, time:e.time, meal:toMeal, version:key, amount:e.amount, portion:e.portion, note:e.note}, versions));
    }
    if (s.entries.length + copied.length > LIMITS.entries) fail('The log holds at most ' + LIMITS.entries + ' items.');
    s.versions = versions; s.entries.push(...copied);
    return copied;
  }
  /* The 7 days ending at `end`, against the 7 before: averages per day with food
     logged, days on target, and days where some item lacked the value. */
  function trends(s, end){
    const keys = ['energy_kcal', ...s.settings.targets.map(t=>t.key).filter(key=>key !== 'energy_kcal')];
    function window(last){
      const days = [];
      for (let i = 6; i >= 0; i--){ const date = shiftDate(last, -i); if (s.entries.some(e=>e.date === date)) days.push(day(s, date)); }
      const value = (d, key) => key in d.total.sums ? d.total.sums[key] : d.total.micros[key] ?? 0;
      const missing = (d, key) => key in d.total.unknown ? d.total.unknown[key] : key in d.total.microUnknown ? d.total.microUnknown[key] : d.total.count;
      return {days:days.length, from:shiftDate(last, -6), to:last,
        rows:keys.map(key=>({key, average:days.length ? days.reduce((sum, d)=>sum + value(d, key), 0) / days.length : null,
          // A limit counts as kept only when every item's value is known; unknown values could pass it.
          onTarget:days.filter(d=>d.targets.some(t=>t.key === key && (t.status === 'met' || (t.status === 'under' && !t.missing)))).length,
          partial:days.filter(d=>missing(d, key) > 0).length}))};
    }
    return {current:window(end), previous:window(shiftDate(end, -7)), targets:s.settings.targets};
  }

  /* Search: accents fold away, so "jordnotssmor" finds Jordnötssmör. */
  const fold = value => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const foodIdOf = key => key.slice(0, key.lastIndexOf('@'));
  function search(s, {query = '', meal = '', archived = false} = {}){
    const words = fold(query).split(/\s+/).filter(Boolean), use = new Map();
    for (const e of s.entries){
      const id = foodIdOf(e.version), u = use.get(id) || {count:0, last:'', meal:''};
      const at = e.date + (e.time || '');
      u.count++; if (at > u.last) u.last = at;
      if (e.meal === meal && at > u.meal) u.meal = at;
      use.set(id, u);
    }
    return s.foods.filter(f=>(archived || !f.archived) && words.every(w=>fold(f.name + ' ' + f.brand).includes(w)))
      .map(f=>({food:f, use:use.get(f.id) || {count:0, last:'', meal:''}}))
      // Latest use in this meal first, then favourites, then the most used, then by name; '' sorts last.
      .sort((a, b)=>b.use.meal.localeCompare(a.use.meal) || !!b.food.favourite - !!a.food.favourite || b.use.count - a.use.count || a.food.name.localeCompare(b.food.name))
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
      note:own.note ?? '', archived:own.archived ?? false, favourite:own.favourite ?? false, freeSugars:own.free_sugars ?? null, details:extra, inFile:true});
    return {food:out, dropped};
  }
  const labelFields = f => stable({name:f.name, brand:f.brand, kind:f.kind, basis:f.basis, nutrients:f.nutrients, micros:f.micros, source:f.source, estimate:f.estimate, note:f.note, freeSugars:f.freeSugars || null, details:f.details || null});
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
      // Archiving and favourites are choices made here; a free sugars mark from the file wins, else the local one stays.
      if (current.archived) merged.archived = true; if (current.favourite) merged.favourite = true;
      if (!merged.freeSugars && current.freeSugars) merged.freeSugars = current.freeSugars;
      const index = foods.findIndex(f=>f.id === incoming.id);
      (labelFields(current) === labelFields(merged) && stable(current.portions) === stable(merged.portions) ? report.unchanged : report.updated).push(incoming.name);
      foods[index] = merged;
    }
    for (const f of foods) if (f.inFile && !seen.has(f.id)) { delete f.inFile; report.notInFile.push(f.name); }
    const budgets = isObject(raw.personal_budgets_per_day) ? raw.personal_budgets_per_day : null, targets = [], ignored = [];
    // A sugar limit (sugar_g) limits free sugars.
    if (budgets) for (const [group, kind] of [['contribution','min'],['limit','max']]) for (const [raw, value] of Object.entries(isObject(budgets[group]) ? budgets[group] : {})){
      const key = kind === 'max' && raw === 'sugar_g' ? FREE : raw;
      if (TARGET_KEYS.includes(key) && typeof value === 'number' && value > 0 && !targets.some(t=>t.key === key)) targets.push({key, kind, value}); else ignored.push(raw);
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
    // Targets set here replace the file's values for nutrients Foodlog tracks; other keys stay.
    // A free sugars limit is written back under the file's own sugar_g key when it has one.
    const alias = kind => key => kind === 'max' && key === FREE && isObject(old.limit) && 'sugar_g' in old.limit ? 'sugar_g' : key;
    const freeTarget = s.settings.targets.some(t=>t.key === FREE);
    const keep = group => Object.fromEntries(Object.entries(isObject(old[group]) ? old[group] : {}).filter(([key])=>!TARGET_KEYS.includes(key) && !(key === 'sugar_g' && freeTarget)));
    const pick = kind => Object.fromEntries(s.settings.targets.filter(t=>t.kind === kind).map(t=>[alias(kind)(t.key), t.value]));
    out.personal_budgets_per_day = {...old, contribution:{...keep('contribution'), ...pick('min')}, limit:{...keep('limit'), ...pick('max')}};
    out.exported_by = 'Foodlog'; out.exported_at = new Date(now).toISOString();
    out.products = s.foods.map(f=>{
      const p = {id:f.id, name:f.name, ...(f.brand ? {brand:f.brand} : {}), ...(f.details || {})};
      p['nutrition_per_' + TABLE[f.basis]] = {...f.nutrients};
      if (Object.keys(f.micros).length) p['micronutrients_per_' + TABLE[f.basis]] = {...f.micros};
      p.foodlog = {kind:f.kind, source:f.source, estimate:f.estimate, portions:f.portions, ...(f.note ? {note:f.note} : {}), ...(f.archived ? {archived:true} : {}),
        ...(f.favourite ? {favourite:true} : {}), ...(f.freeSugars ? {free_sugars:f.freeSugars} : {})};
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
    const totals = [...shown, FREE];
    const sumBlock = (sums, unknown) => Object.fromEntries(totals.map(key=>[key, one(sums[key])]).concat(totals.filter(key=>unknown[key]).length ? [['unknown_items', Object.fromEntries(totals.filter(key=>unknown[key]).map(key=>[key, unknown[key]]))]] : []));
    return {
      date, notes:d.notes.notes || '', activity:(d.notes.activity || '').split('\n').map(line=>line.trim()).filter(Boolean), targets,
      meals:d.meals.filter(m=>m.items.length).map(m=>({meal:m.meal, items:m.items.map(({entry:e, v, amount})=>{
        const n = scaled(v, amount).nutrients, item = {item:v.brand ? v.brand + ' ' + v.name : v.name, food_id:foodIdOf(e.version)};
        if (e.time) item.time = e.time;
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

  /* Day file import: the food-log shape above, from Foodlog or written
     elsewhere. Every item becomes an entry pointing to a catalog food: by
     food_id, else by exact name, else by matching values (the item's nutrients
     equal a food's values for that amount within 2%), else a new food made
     from the item's values. Nothing changes until applyDayImport. */
  const UNIT = Object.fromEntries(NUTRIENTS.map(n=>[n.key, n.unit]));
  const near = (a, b, key) => Math.abs(a - b) <= Math.max(0.02 * Math.max(Math.abs(a), Math.abs(b)), UNIT[key] === 'g' ? 0.05 : 1);
  // Grams and millilitres are interchangeable (1 g = 1 ml), as day files often assume.
  const compatible = (foodBasis, basis) => foodBasis === basis || (foodBasis !== 'portion' && basis !== 'portion');
  function itemAmount(item){
    for (const basis of ['g','ml']) if (item['amount_' + basis] != null) return {basis, amount:number(item['amount_' + basis], 'amount_' + basis, 0.01, 100000)};
    if (typeof item.amount === 'number') return {basis:'portion', amount:number(item.amount, 'amount', 0.01, 100000)};
    const m = typeof item.amount === 'string' && item.amount.trim().match(/^(\d+(?:[.,]\d+)?)\s*(g|ml|portions?)?$/i);
    if (!m) fail('needs amount_g, amount_ml or an amount such as "1 portion"');
    const unit = (m[2] || 'portion').toLowerCase();
    return {basis:unit === 'g' || unit === 'ml' ? unit : 'portion', amount:number(Number(m[1].replace(',', '.')), 'amount', 0.01, 100000)};
  }
  function eatenValues(item){
    if (item.nutrition == null) return null;
    if (!isObject(item.nutrition)) fail('nutrition must be an object');
    return Object.fromEntries(KEYS.map(key=>[key, item.nutrition[key] == null ? null : number(item.nutrition[key], key, 0, 100000)]));
  }
  // How many values both sides know, or -1 when one of them disagrees.
  function compare(f, eaten, amount){
    const expected = scaled({basis:f.basis, nutrients:f.nutrients}, amount).nutrients;
    let known = 0;
    for (const key of KEYS){
      if (expected[key] == null || eaten[key] == null) continue;
      if (!near(expected[key], eaten[key], key)) return -1;
      known++;
    }
    return known;
  }
  const valueMatch = (f, eaten, amount) => f.nutrients.energy_kcal != null && eaten.energy_kcal != null && f.nutrients.protein_g != null && eaten.protein_g != null && compare(f, eaten, amount) >= 4;
  const perBasis = (eaten, basis, amount) => Object.fromEntries(KEYS.map(key=>[key, eaten[key] == null ? null : Math.round(eaten[key] / factor(basis, amount) * 1e4) / 1e4]));
  const words = value => new Set(fold(value).split(/[^a-z0-9]+/).filter(Boolean));
  function planDayImport(raw, s, newId){
    if (!isObject(raw) || !Array.isArray(raw.meals)) fail('Not a day file: it needs a date and a meals list.');
    if (!validDate(raw.date)) fail('The day file needs a date written as YYYY-MM-DD.');
    if (raw.meals.length > LIMITS.dayMeals) fail('A day file holds at most ' + LIMITS.dayMeals + ' meals.');
    if (raw.meals.reduce((n, m)=>n + (Array.isArray(m?.items) ? m.items.length : 0), 0) > LIMITS.dayItems) fail('A day file holds at most ' + LIMITS.dayItems + ' items.');
    const date = raw.date, known = new Map(s.settings.meals.map(m=>[m.toLowerCase(), m])), created = [], meals = [], skipped = [];
    function plan(item, mealTime){
      if (!isObject(item)) fail('not an object');
      const name = text(item.item, 120, 'Item name', true), {basis, amount} = itemAmount(item), eaten = eatenValues(item);
      const source = typeof item.source === 'string' ? item.source.trim().slice(0, 200) : '';
      const extra = {time:typeof item.time === 'string' && TIME.test(item.time) ? item.time : mealTime, amount,
        note:typeof item.assumption === 'string' ? item.assumption.trim().slice(0, 300) : '', portion:typeof item.portion === 'string' ? item.portion.trim().slice(0, 40) : ''};
      let match = null, how = '';
      if (typeof item.food_id === 'string'){ const f = s.foods.find(x=>x.id === item.food_id); if (f && compatible(f.basis, basis)){ match = f; how = 'id'; } }
      if (!match){
        const target = fold(name), named = s.foods.filter(f=>compatible(f.basis, basis) && (fold(f.name) === target || fold((f.brand ? f.brand + ' ' : '') + f.name) === target));
        if (named.length === 1){ match = named[0]; how = 'name'; }
      }
      if (!match && eaten){
        const found = s.foods.filter(f=>compatible(f.basis, basis) && valueMatch(f, eaten, amount));
        // Several foods with the same values: the one sharing most words with the item name, if it is the only one.
        const theirs = words(name), score = f => [...words((f.brand ? f.brand + ' ' : '') + f.name)].filter(w=>theirs.has(w)).length;
        const best = Math.max(0, ...found.map(score)), top = found.filter(f=>score(f) === best);
        if (top.length === 1){ match = top[0]; how = 'values'; }
      }
      if (match){
        // The day keeps the values it was eaten with: the catalog's when they agree (the file
        // filling values the catalog lacks), else the file's own.
        const differs = !!eaten && compare(match, eaten, amount) < 0, fromFile = eaten ? perBasis(eaten, match.basis, amount) : {};
        const filled = differs || !eaten ? [] : KEYS.filter(key=>match.nutrients[key] == null && eaten[key] != null);
        const nutrients = differs ? fromFile : {...match.nutrients, ...Object.fromEntries(filled.map(key=>[key, fromFile[key]]))};
        return {name, food:match, how, differs, filled, version:versionOf({...match, nutrients}), ...extra};
      }
      if (!eaten) fail('has no nutrition values and matches no catalog food');
      const again = created.find(f=>f.basis === basis && fold(f.name) === fold(name) && compare(f, eaten, amount) >= 0);
      if (again) return {name, food:again, how:'again', differs:false, filled:[], version:versionOf(again), ...extra};
      const kind = /menu|restaurant/i.test(source) ? 'menu' : /estimate|typical/i.test(source) ? 'typical' : 'label';
      const added = food({id:newId(name), name, brand:'', kind:basis === 'portion' ? 'dish' : 'generic', basis, nutrients:perBasis(eaten, basis, amount),
        source:kind, estimate:kind === 'typical' || /estimate/i.test(source), note:('Added from the day file for ' + date + (source ? ': ' + source : '')).slice(0, 500)});
      created.push(added);
      return {name, food:added, how:'new', differs:false, filled:[], version:versionOf(added), ...extra};
    }
    for (const m of raw.meals){
      let meal;
      try { if (!isObject(m)) fail('x'); meal = text(m.meal, 40, 'Meal', true); }
      catch { skipped.push({meal:'', item:'', reason:'a meal needs a name of at most 40 characters'}); continue; }
      meal = known.get(meal.toLowerCase()) || meal;
      let block = meals.find(b=>b.meal.toLowerCase() === meal.toLowerCase());
      if (!block){ block = {meal, items:[]}; meals.push(block); }
      const mealTime = typeof m.time === 'string' && TIME.test(m.time) ? m.time : '';
      for (const item of Array.isArray(m.items) ? m.items : []){
        try { block.items.push(plan(item, mealTime)); }
        catch (error) { skipped.push({meal, item:String(item?.item ?? '').slice(0, 80), reason:error.message}); }
      }
    }
    const items = meals.flatMap(b=>b.items), sum = total(items.map(i=>({v:i.version.value, amount:i.amount})));
    const fileTotal = isObject(raw.day_total_eaten) ? raw.day_total_eaten : null;
    const check = ['energy_kcal','protein_g'].map(key=>({key, items:sum.sums[key], file:typeof fileTotal?.[key] === 'number' ? fileTotal[key] : null}));
    const activity = Array.isArray(raw.activity) ? raw.activity.filter(a=>typeof a === 'string').join('\n') : typeof raw.activity === 'string' ? raw.activity : '';
    const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';
    return {date, meals:meals.filter(b=>b.items.length), newFoods:created, skipped, check, items:items.length,
      notes:notes.slice(0, 2000), activity:activity.trim().slice(0, 500), shortened:notes.length > 2000 || activity.trim().length > 500,
      ignored:['targets','day_summary'].filter(key=>raw[key] != null).concat(raw.meals.some(m=>isObject(m) && m.timing != null) ? ['timing'] : []),
      existing:s.entries.filter(e=>e.date === date).length};
  }
  // Applies a plan in one step: 'replace' clears the day first, 'add' keeps it.
  function applyDayImport(s, p, mode, newId){
    const next = {foods:[...s.foods], versions:{...s.versions}, entries:mode === 'replace' ? s.entries.filter(e=>e.date !== p.date) : [...s.entries], days:{...s.days}};
    for (const f of p.newFoods) if (!next.foods.some(x=>x.id === f.id)) next.foods.push(f);
    if (next.foods.length > LIMITS.foods) fail('The catalog holds at most ' + LIMITS.foods + ' foods.');
    for (const block of p.meals) for (const it of block.items){
      next.versions[it.version.key] ||= it.version.value;
      next.entries.push(entry({id:newId(), date:p.date, time:it.time, meal:block.meal, version:it.version.key, amount:it.amount, portion:it.portion, note:it.note}, next.versions));
    }
    if (next.entries.length > LIMITS.entries) fail('The log holds at most ' + LIMITS.entries + ' items.');
    const before = mode === 'replace' ? {} : next.days[p.date] || {}, order = [...(before.meals || [])];
    for (const block of p.meals) if (!order.some(m=>m.toLowerCase() === block.meal.toLowerCase())) order.push(block.meal);
    const notes = before.notes || p.notes, activity = before.activity || p.activity;
    next.days[p.date] = {...(notes ? {notes} : {}), ...(activity ? {activity} : {}), ...(order.length ? {meals:order.slice(0, LIMITS.dayMeals)} : {})};
    Object.assign(s, next);
    return prune(s);
  }

  /* Sample files for the format help, built with the same functions as real
     exports, so they always import. Values are made up. */
  function samples(date){
    const s = {settings:settings({targets:[{key:'protein_g',kind:'min',value:100},{key:'fibre_g',kind:'min',value:30},{key:'saturated_fat_g',kind:'max',value:25},{key:'salt_g',kind:'max',value:6}]}),
      foods:[], versions:{}, entries:[], days:{}};
    s.settings.catalog = {schemaVersion:'1.0', revision:1, updated:date, notes:'Sample catalog with made-up values.', importedAt:null, extra:{}};
    const add = raw => { const f = food({brand:'', micros:{}, portions:[], estimate:false, ...raw}); s.foods.push(f); return f; };
    const cheese = add({id:'sample-cottage-cheese', name:'Cottage Cheese 1.5%', brand:'Example Dairy', kind:'product', basis:'g', source:'label',
      nutrients:{energy_kcal:76, energy_kj:320, protein_g:14, carbohydrate_g:2, sugars_g:2, fibre_g:null, fat_g:1.5, saturated_fat_g:1, salt_g:0.8}});
    const bread = add({id:'sample-crispbread', name:'Wholegrain Crispbread', brand:'Example Bakery', kind:'product', basis:'g', source:'label', portions:[{label:'1 piece', amount:12}],
      nutrients:{energy_kcal:370, energy_kj:1550, protein_g:12, carbohydrate_g:60, sugars_g:2, fibre_g:12, fat_g:6, saturated_fat_g:0.8, salt_g:1}});
    const drink = add({id:'sample-oat-drink', name:'Oat Drink', brand:'Example Mills', kind:'product', basis:'ml', source:'label', portions:[{label:'1 glass', amount:200}], micros:{vitamin_d_ug:1.1},
      nutrients:{energy_kcal:48, energy_kj:200, protein_g:1, carbohydrate_g:7, sugars_g:3.4, fibre_g:0.8, fat_g:1.5, saturated_fat_g:0.2, salt_g:0.1}});
    const egg = add({id:'sample-boiled-egg', name:'Boiled egg', kind:'generic', basis:'g', source:'typical', estimate:true, portions:[{label:'1 egg', amount:50}],
      nutrients:{energy_kcal:143, protein_g:12.6, carbohydrate_g:0.7, sugars_g:0.4, fibre_g:0, fat_g:9.5, saturated_fat_g:3.1, salt_g:0.3}});
    const bowl = add({id:'sample-rice-bowl', name:'Teriyaki rice bowl', kind:'dish', basis:'portion', source:'menu',
      nutrients:{energy_kcal:700, protein_g:30, carbohydrate_g:105, sugars_g:30, fibre_g:null, fat_g:16, saturated_fat_g:4, salt_g:5}});
    let n = 0;
    const eat = (f, meal, amount, extra = {}) => log(s, f, {date, meal, amount, ...extra}, 'sample-' + (++n));
    eat(cheese, 'Breakfast', 100, {time:'07:30'});eat(bread, 'Breakfast', 24, {time:'07:30'});eat(egg, 'Breakfast', 50, {time:'07:30', portion:'1 egg', note:'medium egg assumed'});
    eat(bowl, 'Lunch', 1, {time:'12:15', note:'fibre not on the menu'});eat(drink, 'Snack', 200, {time:'15:00', portion:'1 glass'});
    s.days[date] = {notes:'Sample day with made-up values.', activity:'30 min walk'};
    return {catalog:exportCatalog(s, Date.parse(date + 'T12:00:00Z')), day:exportDay(s, date)};
  }

  return {NUTRIENTS, KEYS, TARGET_KEYS, FREE, COMMON_MICROS, KINDS, SOURCES, BASES, UNITS, LIMITS, DEFAULT_MEALS,
    food, settings, state, versionOf, scaled, total, evaluate, round, format, microUnit, microLabel, describe,
    dayFor, shiftDate, localDate, localTime, day, loggedDays, recentMeals, copyMeal, trends, fold, search, usage, prune, log, updateEntry, foodIdOf,
    importCatalog, exportCatalog, exportDay, planDayImport, applyDayImport, samples, hash};
})();
