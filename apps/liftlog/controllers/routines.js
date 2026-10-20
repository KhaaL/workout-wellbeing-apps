/* liftlog routines controller. Context getters always read current app state. */
/* exported LiftlogRoutineController */
const LiftlogRoutineController = {
  create(context){
function pairKeyOf(it){
  return it.eitherOf ? 'e:' + it.eitherOf : it.supersetOf ? 's:' + it.supersetOf : '';
}
/* A pair key is local to a routine, independent of item order and IDs. */
function cleanRoutinePairs(items){
  items.forEach(it => context.PAIR_KEYS.forEach(key => {
    if (typeof it[key] !== 'string' || !it[key].trim()) delete it[key];
  }));
  items.forEach(it => { if (it.eitherOf) delete it.supersetOf; });
  context.PAIR_KEYS.forEach(key => {
    const groups = new Map();
    items.forEach(it => {
      if (!it[key]) return;
      if (!groups.has(it[key])) groups.set(it[key], []);
      groups.get(it[key]).push(it);
    });
    groups.forEach(pair => {
      if (pair.length !== 2 || pair[0].exerciseId === pair[1].exerciseId)
        pair.forEach(it => delete it[key]);
    });
  });
}
function routineGroups(items){
  const groups = [], pairs = new Map();
  items.forEach(it => {
    const key = pairKeyOf(it);
    if (key && pairs.has(key)) pairs.get(key).push(it);
    else { const group = [it]; groups.push(group); if (key) pairs.set(key, group); }
  });
  return groups;
}
/* Either-of plans the larger alternative; a superset plans every member. */
function groupPlannedSets(group, count){
  return group[0].supersetOf ? group.reduce((n, it) => n + count(it), 0) : Math.max(...group.map(count));
}
function keepRoutinePairsAdjacent(items){
  items.splice(0, items.length, ...routineGroups(items).flat());
}
function routineSummary(items){
  const groups = routineGroups(items);
  const sum = (g, pick) => g[0].supersetOf ? g.reduce((n, it) => n + it.sets, 0) : pick(...g.map(it => it.sets));
  const low = groups.reduce((n, g) => n + sum(g, Math.min), 0);
  const high = groups.reduce((n, g) => n + sum(g, Math.max), 0);
  const exercises = groups.reduce((n, g) => n + (g[0].supersetOf ? g.length : 1), 0);
  return context.plural(exercises, 'exercise') + ' · ' + low + (high !== low ? '–' + high : '') + ' planned sets';
}
function normalizeRoutineItem(it){
  it.sets = context.clamp(parseInt(it.sets, 10) || context.ITEM_LIMITS.sets[0], ...context.ITEM_LIMITS.sets);
  const legacy = context.toNum(it.reps);
  let low = context.toNum(it.repsMin), high = context.toNum(it.repsMax);
  if (low == null) low = legacy == null ? 0 : legacy;
  if (high == null) high = legacy == null ? low : legacy;
  low = context.clamp(Math.round(low), ...context.ITEM_LIMITS.reps);
  high = context.clamp(Math.round(high), ...context.ITEM_LIMITS.reps);
  if (high < low) [low, high] = [high, low];
  it.repsMin = low;
  it.repsMax = high;
  const rir = context.toNum(it.targetRir);
  it.targetRir = rir == null ? null : context.clamp(Math.round(rir), 0, 10);
  it.weight = context.toNum(it.weight);
  if (it.weight != null && it.weight < 0) it.weight = null;
  delete it.reps;
  delete it.rest;
  return it;
}
function normalizeWorkoutTargets(ex){
  const legacy = context.toNum(ex.targetReps);
  let low = context.toNum(ex.targetRepsMin), high = context.toNum(ex.targetRepsMax);
  if (low == null && legacy != null) low = legacy;
  if (high == null && legacy != null) high = legacy;
  if (low == null && high != null) low = high;
  if (high == null && low != null) high = low;
  if (low != null){
    low = context.clamp(Math.round(low), ...context.ITEM_LIMITS.reps);
    high = context.clamp(Math.round(high), ...context.ITEM_LIMITS.reps);
    if (high < low) [low, high] = [high, low];
    ex.targetRepsMin = low;
    ex.targetRepsMax = high;
  } else {
    delete ex.targetRepsMin;
    delete ex.targetRepsMax;
  }
  const rir = context.toNum(ex.targetRir);
  ex.targetRir = rir == null ? null : context.clamp(Math.round(rir), 0, 10);
  delete ex.targetReps;
  delete ex.restSeconds;
  return ex;
}
/* Where a logged count sits against the target range. Warm-ups are not held
   to the working target. */
function repRangeState(ex, s){
  const v = context.toNum(ex.unit === 'time' ? s.durationSeconds : s.reps);
  const low = context.toNum(ex.targetRepsMin), high = context.toNum(ex.targetRepsMax);
  if (v == null || low == null || context.isWarmup(s)) return null;
  const target = targetRangeLabel(ex);
  if (v < low) return { cls:'reps-under', title:'Below the ' + target + ' target' };
  if (high != null && v > high) return { cls:'reps-over', title:'Above the ' + target + ' target — time for more load?' };
  return null;
}
/* The count inputs commit without a re-render, so the mark is repainted here. */
function paintRepRange(ex){
  ex.sets.forEach(s => {
    const el = document.getElementById('sr-' + s.id); if (!el) return;
    const st = repRangeState(ex, s);
    el.classList.remove('reps-under', 'reps-over');
    if (st){ el.classList.add(st.cls); el.title = st.title; } else el.removeAttribute('title');
  });
}
/* The routine editor takes a range as one field: "8", "8-12", "8–12",
   "8 to 12". Null when the text is not a count or a range. */
function parseRepRange(text){
  const m = String(text == null ? '' : text).trim().match(/^(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?$/i);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
  return { min:Math.min(a, b), max:Math.max(a, b) };
}
function targetRangeLabel(ex){
  const low = context.toNum(ex.targetRepsMin), high = context.toNum(ex.targetRepsMax);
  if (low == null && high == null) return '–';
  if (low == null || high == null || low === high) return context.fmtNum(low == null ? high : low);
  return context.fmtNum(low) + '–' + context.fmtNum(high);
}
function pairRoutineItems(firstId, secondId, key = 'eitherOf'){
  const items = context.ui.routineDraft && context.ui.routineDraft.items;
  if (!items || !context.PAIR_KEYS.includes(key)) return false;
  const first = items.find(it => it.id === firstId);
  const second = items.find(it => it.id === secondId);
  if (!first || !second || first === second || pairKeyOf(first) || pairKeyOf(second) ||
      first.exerciseId === second.exerciseId) return false;
  first[key] = second[key] = context.uid();
  keepRoutinePairsAdjacent(items);
  return true;
}
function unpairRoutineItems(groupId){
  const items = context.ui.routineDraft && context.ui.routineDraft.items;
  if (!items || !groupId) return false;
  let removed = false;
  items.forEach(it => context.PAIR_KEYS.forEach(key => {
    if (it[key] === groupId){ delete it[key]; removed = true; }
  }));
  return removed;
}
/* One dialog serves both kinds of pair; only its words change. */
const PAIR_KINDS = {
  eitherOf:{ title:'Either of', second:'Or this exercise', add:'Pair exercises',
    desc:'Choose two exercises already in this routine. Completing either one removes the other from that workout only.',
    current:'Current pairs', join:' or ', unpair:'Unpair', empty:'Add two unpaired exercises to create another pair.' },
  supersetOf:{ title:'Superset', second:'Alternate with', add:'Create superset',
    desc:'Choose two exercises already in this routine. In a workout you alternate between them set by set, and each exercise rests on its own timer.',
    current:'Current supersets', join:' + ', unpair:'Split', empty:'Add two unpaired exercises to create a superset.' }
};
/* …and both places that pair: the routine being edited, and the workout in
   progress. A scope names its list, which entries in it may pair, how a pair
   is made and undone, and the button focus returns to. The picker's values are
   positions in the list, which nothing can move while the dialog is open. */
const PAIR_SCOPES = {
  routine:{
    list:() => context.ui.routineDraft ? context.ui.routineDraft.items : [],
    name:it => (context.exerciseById(it.exerciseId) || {}).name || '(removed exercise)',
    free:it => !pairKeyOf(it) && !!context.exerciseById(it.exerciseId),
    pair:(a, b, kind) => { const items = context.ui.routineDraft.items; return pairRoutineItems(items[a].id, items[b].id, kind); },
    unpair:key => unpairRoutineItems(key),
    opener:kind => kind === 'supersetOf' ? 'routine-superset-open' : 'routine-pair-open'
  },
  session:{
    list:() => context.state.activeWorkout ? context.state.activeWorkout.exercises : [],
    name:ex => ex.name,
    free:ex => context.hasWorkLeft(ex) && !ex.eitherOf && !ex.supersetOf,
    pair:(a, b) => context.pairSessionExercises(a, b),
    unpair:key => context.unpairSessionExercises(key),
    opener:() => 'session-superset-open',
    copy:{ desc:'Choose two exercises with sets still to do. You alternate between them set by set, and each exercise rests on its own timer. ' +
      'This workout only: the routine keeps its plan.', empty:'A superset needs two unpaired exercises with sets still to do.' }
  }
};
const pairScope = () => PAIR_SCOPES[context.ui.pairScope] || PAIR_SCOPES.routine;
/* Positions of the entries that can pair with something, in list order. */
function pairCandidates(scopeName, first){
  const scope = PAIR_SCOPES[scopeName], list = scope.list();
  const free = list.map((it, i) => i).filter(i => scope.free(list[i]));
  const fits = (i, j) => i !== j && list[i].exerciseId !== list[j].exerciseId;
  return first == null ? free.filter(i => free.some(j => fits(i, j))) : free.filter(j => fits(first, j));
}
function pairPickerOptions(positions){
  const scope = pairScope(), list = scope.list();
  return positions.map(i => '<option value="' + i + '">' + context.esc(scope.name(list[i])) + ' · #' + (i + 1) + '</option>').join('');
}
function refreshSecondPairPicker(){
  const first = context.$('#pair-first').value;
  const second = context.$('#pair-second');
  const selected = second.value;
  const choices = first === '' ? [] : pairCandidates(context.ui.pairScope, Number(first));
  second.innerHTML = pairPickerOptions(choices);
  if (choices.includes(Number(selected))) second.value = selected;
}
function openPairDialog(scopeName, kind){
  context.ui.pairScope = PAIR_SCOPES[scopeName] ? scopeName : 'routine';
  context.ui.pairKind = PAIR_KINDS[kind] ? kind : 'eitherOf';
  const scope = pairScope(), list = scope.list();
  if (list.length < 2) return;
  const copy = { ...PAIR_KINDS[context.ui.pairKind], ...(scope.copy || {}) };
  context.$('#pair-title').textContent = copy.title;
  context.$('#pair-desc').textContent = copy.desc;
  context.$('#pair-second-cap').textContent = copy.second;
  context.$('#pair-add').textContent = copy.add;
  context.$('#pair-empty').textContent = copy.empty;
  const groups = new Map();
  list.forEach(it => { const key = it[context.ui.pairKind]; if (key) groups.set(key, (groups.get(key) || []).concat([it])); });
  const paired = [...groups].filter(([, group]) => group.length === 2);
  context.$('#pair-existing').innerHTML = paired.length
    ? '<h3>' + copy.current + '</h3>' + paired.map(([key, group]) =>
      '<div class="routine-pair-existing-row"><span>' + group.map(it => context.esc(scope.name(it))).join(copy.join) +
        '</span><button type="button" class="btn btn-sm" data-action="pair-unpair" data-group="' +
        context.esc(key) + '">' + copy.unpair + '</button></div>').join('') : '';
  const firstChoices = pairCandidates(context.ui.pairScope);
  const canPair = firstChoices.length > 0;
  context.$('#pair-picker').hidden = !canPair;
  context.$('#pair-empty').hidden = canPair;
  context.$('#pair-add').disabled = !canPair;
  context.$('#pair-error').hidden = true;
  context.$('#pair-first').innerHTML = pairPickerOptions(firstChoices);
  refreshSecondPairPicker();
  context.$('#pair-dlg').showModal();
  (canPair ? context.$('#pair-first') : context.$('#pair-dlg [data-action="pair-close"]')).focus();
}
function closePairDialog(changed){
  const opener = pairScope().opener(context.ui.pairKind);
  context.$('#pair-dlg').close();
  if (changed){ context.ui.focus = opener; context.render(); }
  else { const el = document.getElementById(opener); if (el) el.focus(); }
}
function addPair(){
  const a = context.$('#pair-first').value, b = context.$('#pair-second').value;
  if (a !== '' && b !== '' && pairScope().pair(Number(a), Number(b), context.ui.pairKind)){
    closePairDialog(true);
    if (context.ui.pairScope === 'session') context.toast('Superset created for this workout');
    return;
  }
  const error = context.$('#pair-error');
  error.textContent = 'Choose two different, unpaired exercises.';
  error.hidden = false;
}
/* ---------- plans ----------
   A plan is a routine marked one-off, optionally for a calendar day. Saving
   the session started from it removes it: the workout already copied its
   prescription, so History is where it lives on. The day is a local calendar
   date string, never a timestamp, so time zones cannot move it. */
const isPlan = r => !!r && r.plan === true;
const stableRoutines = () => context.state.routines.filter(r => !isPlan(r));
function localDay(ts = Date.now()){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function validPlanDay(v){
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number), date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
/* Stable routines carry no plan fields at all, so their exports stay as before. */
function normalizePlanFields(r){
  if (r.plan === true) r.plannedFor = validPlanDay(r.plannedFor) ? r.plannedFor : null;
  else { delete r.plan; delete r.plannedFor; }
  return r;
}
function planDay(r){
  if (!r.plannedFor) return { rank:2, label:'Anytime', overdue:false };
  const [y, m, d] = r.plannedFor.split('-').map(Number);
  const when = context.fmtDate(new Date(y, m - 1, d).getTime()), today = localDay();
  if (r.plannedFor < today) return { rank:0, label:'Overdue · ' + when, when, overdue:true };
  if (r.plannedFor === today) return { rank:1, label:'Today', overdue:false };
  return { rank:3, label:when, overdue:false };
}
/* Overdue (oldest first), today, anytime, then later days in order. */
function sortedPlans(){
  return context.state.routines.filter(isPlan).map(r => ({ r, day:planDay(r) }))
    .sort((a, b) => a.day.rank - b.day.rank || String(a.r.plannedFor || '').localeCompare(String(b.r.plannedFor || '')) ||
      a.r.name.localeCompare(b.r.name));
}
/* A plan is known by its name on its day, so "Day B" can be a routine and
   next week's plan at once; a stable routine by its name alone. */
const routineKey = r => isPlan(r)
  ? 'plan|' + context.normalizedExerciseName(r.name) + '|' + (validPlanDay(r.plannedFor) ? r.plannedFor : '')
  : context.normalizedExerciseName(r.name);
function defaultRoutineId(){
  const first = sortedPlans()[0];
  return first ? first.r.id : (stableRoutines()[0] || {}).id || null;
}
function newRoutineDraft(r){
  return r ? context.deepCopy(r) : { id:null, name:'', items:[] };
}
/* The stable routine stays as it is; the copy is that one day's version. */
function newPlanDraft(r){
  const draft = context.deepCopy(r);
  draft.id = null; draft.plan = true; draft.plannedFor = localDay();
  draft.items.forEach(it => { it.id = context.uid(); });
  return draft;
}
function saveRoutineDraft(){
  const d = context.ui.routineDraft; if (!d) return;
  if (!d.name.trim()){ context.ui.routineError = 'Give the routine a name.'; context.render(); return; }
  if (d.items.length === 0){ context.ui.routineError = 'Add at least one exercise.'; context.render(); return; }
  d.items.forEach(normalizeRoutineItem);
  cleanRoutinePairs(d.items);
  keepRoutinePairsAdjacent(d.items);
  if (d.plan && d.plannedFor && !validPlanDay(d.plannedFor)){ context.ui.routineError = 'Choose a valid day, or leave it empty for anytime.'; context.render(); return; }
  const routine = normalizePlanFields({ id:d.id || context.uid(), name:d.name.trim(), items:d.items,
    plan:d.plan === true, plannedFor:d.plannedFor || null });
  const i = d.id ? context.state.routines.findIndex(r => r.id === d.id) : -1;
  if (i !== -1) context.state.routines[i] = routine;
  else context.state.routines.push(routine);
  context.ui.routineDraft = null; context.ui.routineError = '';
  context.save(); context.render(); context.toast(isPlan(routine) ? 'Plan saved — ' + planDay(routine).label : 'Routine saved');
}
function duplicateRoutine(id){
  const r = context.routineById(id); if (!r) return;
  const copy = context.deepCopy(r);
  copy.id = context.uid(); copy.name = r.name + ' (copy)';
  copy.items.forEach(it => it.id = context.uid());
  context.state.routines.push(copy);
  /* from its sheet, the copy is what you want to look at (and edit) next */
  if (context.ui.detail && context.ui.detail.kind === 'routine' && context.ui.detail.id === id) context.ui.detail = { kind:'routine', id:copy.id };
  context.save(); context.render(); context.toast('Duplicated “' + r.name + '”');
}
function deleteRoutine(id){
  const r = context.routineById(id); if (!r) return;
  context.confirmDlg('Delete routine?','“' + r.name + '” will be removed. Past workouts in History are not affected.','Delete routine',true)
    .then(ok => {
      if (!ok) return;
      context.state.routines = context.state.routines.filter(x => x.id !== id);
      if (context.ui.routineDraft && context.ui.routineDraft.id === id) context.ui.routineDraft = null;
      context.save(); context.render(); context.toast('Routine deleted');
    });
}
function routineStep(idx, dir){
  const d = context.ui.routineDraft; if (!d) return;
  const groups = routineGroups(d.items);
  const groupIndex = groups.findIndex(group => group.includes(d.items[idx]));
  const next = groupIndex + dir;
  if (groupIndex < 0 || next < 0 || next >= groups.length) return;
  const target = groups[next];
  const row = dir < 0 ? d.items.indexOf(target[0]) : d.items.indexOf(target[target.length - 1]);
  const offset = groups[groupIndex].indexOf(d.items[idx]);
  const landed = (dir < 0 ? d.items.indexOf(target[0]) : d.items.indexOf(groups[groupIndex][0]) + target.length) + offset;
  const atBound = dir < 0 ? next === 0 : next === groups.length - 1;
  const keep = atBound ? (dir < 0 ? 'ri-down-' : 'ri-up-') : (dir < 0 ? 'ri-up-' : 'ri-down-');
  context.SORTABLES['routine-items'].drop(idx, row, keep + landed);
}
function removeRoutineItem(idx){
  const d = context.ui.routineDraft; if (!d) return;
  d.items.splice(idx,1);
  cleanRoutinePairs(d.items);
  context.render();
}
function addRoutineItem(exId){
  const d = context.ui.routineDraft; if (!d || !exId) return;
  d.items.push(context.newRoutineItem(exId));
  context.render();
}
    return {pairKeyOf,cleanRoutinePairs,routineGroups,groupPlannedSets,keepRoutinePairsAdjacent,routineSummary,normalizeRoutineItem,normalizeWorkoutTargets,repRangeState,paintRepRange,parseRepRange,targetRangeLabel,pairRoutineItems,unpairRoutineItems,PAIR_KINDS,PAIR_SCOPES,pairScope,pairCandidates,pairPickerOptions,refreshSecondPairPicker,openPairDialog,closePairDialog,addPair,isPlan,stableRoutines,localDay,validPlanDay,normalizePlanFields,planDay,sortedPlans,routineKey,defaultRoutineId,newRoutineDraft,newPlanDraft,saveRoutineDraft,duplicateRoutine,deleteRoutine,routineStep,removeRoutineItem,addRoutineItem};
  }
};
