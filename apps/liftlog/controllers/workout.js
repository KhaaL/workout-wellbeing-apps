/* liftlog workout controller. Context getters always read current app state. */
/* exported LiftlogWorkoutController */
const LiftlogWorkoutController = {
  create(context){
/* A planned set leaves its count and effort blank: the inputs show the target
   range and target RIR as faint placeholders, and logging an untouched set
   records the lower bound (fillSetDefaults). A new set copies the load from
   the set it follows, never the count or the effort: those are what each set
   is for, and a copied figure hides the target it should be measured against. */
function newSetFrom(ex, copyFrom){
  const timed = ex.unit === 'time';
  const bodyweight = ex.unit === 'bw';
  return {
    id:context.uid(),
    weight: copyFrom ? copyFrom.weight : null,
    ...(bodyweight ? {
      addedWeight:copyFrom ? copyFrom.addedWeight : null,
      addedWeightUnit:copyFrom ? (copyFrom.addedWeightUnit || context.unitLabel()) : context.unitLabel()
    } : {}),
    /* reps stays a pure count; timed work lives in durationSeconds */
    reps:null, durationSeconds:null,
    rpe:null, rir:null, completed:false, completedAt:null,
    unit: ex.unit === 'bw' ? 'bw' : (timed ? 'time' : context.state.settings.unit)
  };
}
/* item is a routine item ({exerciseId, sets, repsMin, repsMax, targetRir, weight}); the returned block
   is the workout-local copy that logging writes into. */
function buildWorkoutExercise(item){
  const exDef = context.exerciseById(item.exerciseId) || { name:'Unknown exercise', category:'', unit:context.state.settings.unit, notes:'' };
  const prev = context.lastPerformance(item.exerciseId);
  const ex = {
    exerciseId:item.exerciseId, name:exDef.name, category:exDef.category || '',
    unit:exDef.unit || 'kg', loadMode:context.normalizeLoadMode(exDef.loadMode, exDef.unit),
    equipmentKey:exDef.equipmentKey || '', movementFamily:exDef.movementFamily || context.inferMovementFamily(exDef.name, exDef.category),
    plannedSets:item.sets || 3,
    targetRepsMin:item.repsMin != null ? item.repsMin : 8,
    targetRepsMax:item.repsMax != null ? item.repsMax : (item.repsMin != null ? item.repsMin : 8),
    targetRir:item.targetRir != null ? item.targetRir : null,
    targetWeight:item.weight != null ? item.weight : null,
    ...(item.eitherOf ? { eitherOf:item.eitherOf } : {}),
    ...(item.supersetOf ? { supersetOf:item.supersetOf } : {}),
    notes:exDef.notes || '', skipped:false, sets:[]
  };
  const n = Math.max(1, item.sets || 3);
  /* Planned sets are working sets, so they line up with last time's working
     sets: a warm-up ramp must not seed the first working set with its load. */
  const prevWork = prev ? prev.sets.filter(s => !context.isWarmup(s)) : [];
  /* When last time met this prescription, working sets start at the suggested
     next load (the same figure the load cue shows) instead of repeating it.
     Bodyweight work only steps a load that was already added. */
  const cue = item.weight == null ? context.loadCueFor(item.exerciseId, item) : null;
  const suggested = cue ? context.suggestedLoad(cue) : null;
  for (let i = 0; i < n; i++){
    const set = newSetFrom(ex, null);
    /* seed the bar with the plan, else the suggestion, else what was lifted last time */
    const prevSet = prevWork[i] || prevWork[0];
    if (ex.unit === 'bw'){
      if (item.weight != null){ set.addedWeight = item.weight; set.addedWeightUnit = context.unitLabel(); }
      else if (suggested && suggested.kind === 'bw' && suggested.last > 0){ set.addedWeight = suggested.next; set.addedWeightUnit = suggested.unit; }
      else if (prevSet && prevSet.addedWeight != null){
        set.addedWeight = context.convertWeight(prevSet.addedWeight, prevSet.addedWeightUnit || context.unitLabel(), context.unitLabel());
        set.addedWeightUnit = context.unitLabel();
      }
    } else if (item.weight != null) set.weight = item.weight;
    else if (suggested && suggested.kind === 'loaded' && suggested.unit === set.unit) set.weight = suggested.next;
    /* the old set keeps its own unit; the new one is logged in today's */
    else if (prevSet && prevSet.weight != null)
      set.weight = Math.round(context.convertWeight(prevSet.weight, prevSet.unit === 'lb' ? 'lb' : 'kg', set.unit) * 100) / 100;
    ex.sets.push(set);
  }
  return ex;
}
function beginWorkout(workout){
  if(context.workoutHandoff.held()){context.toast('Cancel the handoff before starting another workout');return;}
  if(context.appUpdates&&!context.appUpdates.canStart()){context.toast('App update in progress — wait before starting a workout');return;}
  context.state.activeWorkout = workout;
  /* a suggestion menu opened on Today must not open on the workout card */
  context.ui.cueMenuId = null;
  context.save();
  context.requestPersistence(false);   /* a user gesture, and the point data starts mattering */
  context.restoreTimer();
  context.ui.view = 'today';
  context.ui.detail = null;
  context.ui.selectedRoutineId = null;
  /* nothing to log yet means the sheet is where the user needs to be — and the
     focus with it: everything outside an open modal is inert. */
  context.ui.overviewOpen = workout.exercises.length === 0;
  context.ui.notesOpen = false;
  context.ui.focus = context.ui.overviewOpen ? 'add-ex-select' : 'workout-title';
  context.render();
}
/* startRoutine and startEmpty differ only in the workout they build and the
   wording of the "you already have one running" prompt. */
function startSession(build, replaceBody, started){
  if(context.workoutHandoff.held()){context.toast('Cancel the handoff in Settings before starting another workout');return;}
  const go = () => { beginWorkout(build()); context.toast(started); };
  if (!context.state.activeWorkout){ go(); return; }
  context.confirmDlg('Replace current workout?', replaceBody, 'Discard & start', true)
    .then(ok => { if (ok){ context.state.activeWorkout = null; go(); } });
}
function newWorkout(routine){
  return {
    id:context.uid(),
    routineId:routine ? routine.id : null,
    routineName:routine ? routine.name : 'Quick session',
    startedAt:Date.now(), finishedAt:null, notes:'', currentExerciseIndex:0, supersetSide:0,
    exercises:routine ? routine.items.map(buildWorkoutExercise) : [],
    timer:null
  };
}
function startRoutine(id){
  const r = context.routineById(id);
  if (!r) return;
  startSession(() => newWorkout(r),
    'You already have a workout in progress. Starting “' + r.name + '” will discard it.',
    'Workout started — ' + r.name);
}
function startEmpty(){
  startSession(() => newWorkout(null),
    'Starting a new session will discard the workout in progress.',
    'Quick session started');
}
/* Default plan for a freshly added exercise: timed work is measured in
   seconds, everything else in reps. */
function newRoutineItem(exId){
  const def = context.exerciseById(exId);
  return { id:context.uid(), exerciseId:exId, sets:3,
    repsMin:(def && def.unit === 'time') ? 30 : 8,
    repsMax:(def && def.unit === 'time') ? 30 : 12,
    targetRir:null, weight:null };
}
function addExerciseToWorkout(exId){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout;
  if (!w || !exId) return;
  const def = context.exerciseById(exId);
  /* The picker already leaves out what is in the session, so this catches the
     stale-value case (a submit against a list rendered before another add).
     One movement, one panel: a second copy would split its sets and its volume
     across two rows of the same session. */
  if (w.exercises.some(x => x.exerciseId === exId)){
    context.toast((def ? def.name : 'That exercise') + ' is already in this session');
    return;
  }
  w.exercises.push(buildWorkoutExercise(newRoutineItem(exId)));
  if (w.currentExerciseIndex >= w.exercises.length - 1 || allSetsDone(currentExercise()))
    pointAt(w, w.exercises.length - 1);
  context.save(); context.render();
  context.toast('Added ' + (def ? def.name : 'exercise'));
}
/* The group cursor. currentExerciseIndex always names the first block of a
   superset (or a lone block), so everything that reasons about "before the
   cursor is settled" keeps working unchanged; supersetSide picks which member
   of that superset is on screen. A superset is a run of adjacent blocks
   sharing supersetOf — settleSupersets() keeps that true. */
function supersetRun(w, i){
  const ex = w.exercises[i];
  if (!ex || !ex.supersetOf) return [i];
  let lo = i, hi = i;
  while (lo > 0 && w.exercises[lo - 1].supersetOf === ex.supersetOf) lo--;
  while (hi < w.exercises.length - 1 && w.exercises[hi + 1].supersetOf === ex.supersetOf) hi++;
  const run = [];
  for (let k = lo; k <= hi; k++) run.push(k);
  return run;
}
function currentMemberIndex(w){
  const run = supersetRun(w, w.currentExerciseIndex);
  return run[Math.min(w.supersetSide || 0, run.length - 1)];
}
/* The one way to move the cursor to a block: it lands on that block's
   superset and selects the block within it. */
function pointAt(w, idx){
  const run = supersetRun(w, idx);
  w.currentExerciseIndex = run[0];
  w.supersetSide = idx - run[0];
}
/* Moving onto a superset starts with its first member that still has work. */
function enterAt(w, idx){
  const run = supersetRun(w, idx);
  const open = run.find(i => !w.exercises[i].skipped && !allSetsDone(w.exercises[i]));
  pointAt(w, open != null ? open : idx);
}
/* Alternation only works between neighbours. A session change that separates
   or orphans a member (a reorder, a removal) ends that superset for this
   session only; the saved routine keeps it. Returns whether any ended. */
function settleSupersets(w){
  const members = new Map();
  w.exercises.forEach((ex, i) => {
    if (typeof ex.supersetOf !== 'string' || !ex.supersetOf){ delete ex.supersetOf; return; }
    if (!members.has(ex.supersetOf)) members.set(ex.supersetOf, []);
    members.get(ex.supersetOf).push(i);
  });
  let ended = false;
  members.forEach(idx => {
    if (idx.length >= 2 && idx[idx.length - 1] - idx[0] === idx.length - 1) return;
    idx.forEach(i => delete w.exercises[i].supersetOf);
    ended = true;
  });
  return ended;
}
/* Whose turn it is after a set in the current superset: the next member, in
   order, that still has work. Null outside a superset or once every member is
   finished. */
function supersetTurn(w){
  const run = supersetRun(w, w.currentExerciseIndex);
  if (run.length < 2) return null;
  const side = run.indexOf(currentMemberIndex(w));
  for (let k = 1; k <= run.length; k++){
    const j = (side + k) % run.length, ex = w.exercises[run[j]];
    if (!ex.skipped && !allSetsDone(ex)) return { index:run[j] };
  }
  return null;
}
function currentExercise(){
  const w = context.state.activeWorkout;
  return w ? w.exercises[currentMemberIndex(w)] || null : null;
}
function allSetsDone(ex){ return ex && ex.sets.length > 0 && ex.sets.every(s => s.completed); }
/* Finishing one alternative settles only this session's copy of the plan.
   Keep the current block's identity stable when its partner was before it. */
function settleEitherOf(w, ex){
  if (!ex.eitherOf) return null;
  const partnerIndex = w.exercises.findIndex(other => other !== ex && other.eitherOf === ex.eitherOf);
  delete ex.eitherOf;
  if (partnerIndex < 0) return null;
  const [partner] = w.exercises.splice(partnerIndex, 1);
  if (partnerIndex < w.currentExerciseIndex) w.currentExerciseIndex--;
  return partner;
}

/* A set left blank falls back to the target. Timed work must land in
   durationSeconds — writing it to `reps` is exactly the v2 bug v3 undid. */
function fillSetDefaults(ex, s){
  const field = ex.unit === 'time' ? 'durationSeconds' : 'reps';
  if (context.toNum(s[field]) == null) s[field] = ex.targetRepsMin != null ? ex.targetRepsMin : 0;
  if (!s.unit) s.unit = ex.unit === 'time' ? 'time' : (ex.unit === 'bw' ? 'bw' : context.state.settings.unit);
}
function toggleWarmup(setId, focusId){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(); if (!ex) return;
  const s = ex.sets.find(x => x.id === setId); if (!s) return;
  const on = !context.isWarmup(s);
  context.trackChange(context.setUndoTarget(context.state.activeWorkout,ex,s),'Edited set type',()=>{context.setWarmup(s,on);context.save({changed:['activeWorkout']});});
  context.ui.focus = focusId || 'sn-' + setId;
  context.render();
  context.announce(on ? 'Marked as a warm-up: it no longer counts toward volume or records.'
              : 'Marked as a working set.');
}
/* The one way a set is logged: its own box in the done column. It therefore
   also owns what used to hang off the "Set N done" button — the announcement
   and the auto-rest that starts the moment a set lands. */
function toggleSet(setId){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(); if (!ex) return;
  const i = ex.sets.findIndex(x => x.id === setId);
  if (i === -1) return;
  const s = ex.sets[i];
  const w = context.state.activeWorkout;
  s.completed = !s.completed;
  if (s.completed){ s.completedAt = Date.now(); fillSetDefaults(ex, s); }
  else s.completedAt = null;
  const lastSet = s.completed && allSetsDone(ex);
  let finished = lastSet;
  const removed = finished ? settleEitherOf(w, ex) : null;
  /* In a superset a logged set hands over to the partner. The superset is
     finished only when every member is. A warm-up stays on this exercise,
     unless it was this member's last open set. */
  const inSuperset = s.completed && supersetRun(w, w.currentExerciseIndex).length > 1;
  const turn = inSuperset ? supersetTurn(w) : null;
  if (inSuperset) finished = !turn;
  const holdForWarmup = context.isWarmup(s) && !allSetsDone(ex);
  const handOver = turn && !holdForWarmup && turn.index !== currentMemberIndex(w) ? w.exercises[turn.index] : null;
  context.save({changed:['activeWorkout']});
  if (removed) context.toast('Either of: removed ' + removed.name + ' from this workout');
  if (s.completed){
    context.announce('Set ' + (i+1) + ' of ' + ex.sets.length + ' complete.' + (handOver ? ' Now: ' + handOver.name + '.' : ''));
    /* Rest belongs to the exercise just performed, superset member or not.
       Superset partners work different muscles, so each rests on its own
       clock: this one counts down while the partner is worked. Rest only
       separates sets of one exercise, so its last set ends its clock. */
    if (lastSet) context.endRest();
    else if (context.state.settings.autoRest){
      context.loadTimer(context.currentRestSeconds(ex));
      context.startTimer();
    }
  }
  /* checking the last open box leaves nothing to log here, so move on rather
     than sit on a fully-done set list */
  if (finished) advanceExercise(false, true);
  else if (handOver){ pointAt(w, turn.index); context.save({changed:['activeWorkout']}); context.ui.focus = 'ex-panel-top'; context.render(); }
  else { context.ui.focus = 'sd-' + setId; context.render(); }
}
/* The manual override: work on another member of the current superset now,
   say because its station just came free. */
function switchSupersetMember(idx){
  const w = context.state.activeWorkout; if (!w) return;
  if (!supersetRun(w, w.currentExerciseIndex).includes(idx) || idx === currentMemberIndex(w)) return;
  pointAt(w, idx);
  w.exercises[idx].skipped = false;
  context.save();
  context.ui.focus = 'ex-panel-top';
  context.render();
  context.announce('Now: ' + w.exercises[idx].name + '.');
}
/* Setting a weight is nearly always a decision about the rest of the exercise
   rather than about one row, so it flows down to later sets — but only into
   rows that are still blank. Reps, seconds and RIR never flow: each set's
   count is what that set is logged for, and the target stays visible as the
   field's placeholder until something is typed. A row that already
   holds a number (typed, pre-filled from the plan or last session, or a
   deliberately different warm-up or back-off load) is a decision of its own
   and is never overwritten. Completed sets are left alone too — they record
   what was actually done, not what is planned.

   Two deliberate choices. It runs on commit rather than per keystroke, so
   typing "100" does not walk the rows below through 1 and 10. And it writes
   the other inputs directly rather than calling render(), because a re-render
   here would take the focus with it as the user tabs to the next field. */
function cascadeSetField(setId, field, value, elPrefix, unitSuffix){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(); if (!ex) return;
  const i = ex.sets.findIndex(x => x.id === setId);
  if (i === -1) return;
  value = context.normalizeSetNumber(field, value);
  ex.sets[i][field] = value;
  /* clearing a field is not "setting" it, and must not wipe the rest */
  if (value == null){ context.save({changed:['activeWorkout']}); return; }
  let changed = 0;
  for (let j = i + 1; j < ex.sets.length; j++){
    const s = ex.sets[j];
    if (s.completed || s[field] != null) continue;
    s[field] = value;
    const el = document.getElementById(elPrefix + s.id);
    if (el) el.value = value;
    changed++;
  }
  context.save({changed:['activeWorkout']});
  /* the rows visibly change, so this is for screen readers only */
  if (changed) context.announce(context.plural(changed, 'later set') + ' set to ' + context.fmtNum(value) + (unitSuffix ? ' ' + unitSuffix : '') + '.');
}
function cascadeWeight(setId, value){
  const ex = currentExercise(); if (!ex) return;
  const field = ex.unit === 'bw' ? 'addedWeight' : 'weight';
  if (ex.unit === 'bw') ex.sets.forEach(s => { s.addedWeightUnit = context.unitLabel(); });
  cascadeSetField(setId, field, value, 'sw-', context.unitLabel());
}
/* The count belongs to its own row only; see cascadeSetField. */
function setReps(setId, value){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(); if (!ex) return;
  const s = ex.sets.find(x => x.id === setId); if (!s) return;
  const field = ex.unit === 'time' ? 'durationSeconds' : 'reps';
  s[field] = context.normalizeSetNumber(field, value);
  context.save({changed:['activeWorkout']});
}

/* Numeric edits stay in the dialog draft until Save. Less frequent warm-up
   and delete actions share this editor. */
function openSetEditor(setId){
  if(context.workoutHandoff.held())return;
  const ex=currentExercise(),set=ex?.sets.find(s=>s.id===setId);if(!set)return;
  const number=ex.sets.indexOf(set)+1,opener=document.querySelector('[data-action="edit-set"][data-id="'+CSS.escape(setId)+'"]');
  const dialog=document.createElement('dialog');dialog.className='numeric-editor';dialog.setAttribute('aria-label','Edit set '+number);
  const heading=document.createElement('h2');heading.textContent='Set '+number;dialog.append(heading);
  const inputs=[];
  for(const original of opener.closest('.set-row').querySelectorAll('input')){
    const label=document.createElement('label');label.className='field';const cap=document.createElement('span');cap.textContent=original.getAttribute('aria-label');
    const input=original.cloneNode();input.removeAttribute('id');input.removeAttribute('data-bind');input.removeAttribute('data-change');input.removeAttribute('data-id');input.value=original.value;input.dataset.stepper='';
    if(['weight','addedWeight'].includes(original.dataset.field)){input.dataset.increment=context.state.settings.loadStep||original.step;input.step='any';}
    label.append(cap,input);dialog.append(label);inputs.push({input,field:original.dataset.field});
  }
  const actions=document.createElement('div');actions.className='editor-actions';dialog.append(actions);
  const button=(text,css,action)=>{const b=document.createElement('button');b.type='button';b.className='btn '+css;b.textContent=text;b.addEventListener('click',action);actions.append(b);};
  button('Save changes','btn-primary',()=>{if(inputs.some(({input})=>!input.reportValidity()))return;context.trackChange(context.setUndoTarget(context.state.activeWorkout,ex,set),'Edited set',()=>{for(const {input,field}of inputs)set[field]=context.normalizeSetNumber(field,input.value);context.save();});dialog.close();context.ui.focus='sd-'+setId;context.render();});
  button(context.isWarmup(set)?'Mark as working set':'Mark as warm-up','',()=>{dialog.close();toggleWarmup(setId);});
  button('Cancel','',()=>dialog.close());
  const divider=document.createElement('hr');actions.append(divider);
  button('Delete set '+number+'…','btn-danger',()=>{dialog.close();deleteSet(setId);});
  button('Remove exercise…','btn-danger',()=>{dialog.close();confirmExerciseRemoval(context.state.activeWorkout,ex);});
  dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus();},{once:true});document.body.append(dialog);context.WorkoutUI.attachSteppers(dialog);dialog.showModal();
}

/* Swap the current exercise for another, for this session only, keeping the
   prescription: the set count, and the rep range and target RIR when both
   movements are counted the same way (reps or seconds). A planned load belongs
   to the old movement, so the new one is seeded from its own history. Pairings
   carry over. It is offered only before a set is logged, so logged work is
   never relabelled. */
function swapCandidates(w, ex){
  const inSession = new Set(w.exercises.map(x => x.exerciseId));
  const pool = context.state.exercises.filter(e => !e.archived && !inSession.has(e.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric:true, sensitivity:'base' }));
  return { related:pool.filter(e => e.movementFamily === ex.movementFamily), other:pool.filter(e => e.movementFamily !== ex.movementFamily) };
}
function canSwap(ex){ return !!ex && !ex.sets.some(s => s.completed); }
function swapExercise(idx, newId){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout, ex = w && w.exercises[idx], def = context.exerciseById(newId);
  if (!ex || !def || def.archived) return;
  if (!canSwap(ex)){ context.toast('Sets are already logged for ' + ex.name + '. Add the other exercise instead.'); return; }
  if (w.exercises.some(x => x.exerciseId === newId)){ context.toast(def.name + ' is already in this session'); return; }
  const sameCount = (ex.unit === 'time') === (def.unit === 'time');
  const fresh = newRoutineItem(newId);
  const block = buildWorkoutExercise({ exerciseId:newId, sets:ex.plannedSets || ex.sets.length,
    repsMin:sameCount ? ex.targetRepsMin : fresh.repsMin, repsMax:sameCount ? ex.targetRepsMax : fresh.repsMax,
    targetRir:sameCount ? ex.targetRir : null, weight:null,
    ...(ex.eitherOf ? { eitherOf:ex.eitherOf } : {}), ...(ex.supersetOf ? { supersetOf:ex.supersetOf } : {}) });
  /* the session's own count of working rows, which may differ from the plan
     after Add set; warm-up rows ramp to the old movement's load and are dropped */
  const working = ex.sets.filter(s => !context.isWarmup(s)).length;
  while (block.sets.length < working) block.sets.push(newSetFrom(block, block.sets[block.sets.length - 1]));
  block.sets.length = Math.max(1, working);
  w.exercises[idx] = block;
  context.save(); context.ui.focus = 'ex-panel-top'; context.render();
  context.toast('Swapped ' + ex.name + ' for ' + def.name + (sameCount ? '. Sets, reps and RIR kept for this session.' : '. Set count kept for this session.'));
}
/* The less frequent actions for the current exercise, one tap behind More…,
   so the row under the sets holds Add set and the next exercise on one line.
   Each entry is listed only when it applies. */
function openExerciseMenu(){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout, ex = currentExercise(); if (!w || !ex) return;
  const opener = document.querySelector('[data-action="exercise-menu"]');
  const dialog = document.createElement('dialog'); dialog.className = 'numeric-editor'; dialog.setAttribute('aria-label', 'More for ' + ex.name);
  const heading = document.createElement('h2'); heading.textContent = ex.name; dialog.append(heading);
  const actions = document.createElement('div'); actions.className = 'editor-actions'; dialog.append(actions);
  let next = null;
  const button = (text, css, action) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + css; b.textContent = text;
    b.addEventListener('click', () => { next = action; dialog.close(); }); actions.append(b); };
  const ramp = warmupPlan(ex);
  if (ramp.length) button('Add ' + context.plural(ramp.length, 'warm-up set'), '', addWarmups);
  if (canSwap(ex)) button('Swap for another exercise…', '', openSwapDialog);
  button('Remove exercise…', 'btn-danger', () => confirmExerciseRemoval(w, ex));
  button('Cancel', '', null);
  /* the follow-up runs after focus has gone back, so its own dialog or render owns focus */
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); if (next) next(); }, { once:true });
  document.body.append(dialog); dialog.showModal();
}
function openSwapDialog(){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout, ex = currentExercise(); if (!w || !ex) return;
  const idx = w.exercises.indexOf(ex), opener = document.querySelector('[data-action="exercise-menu"]');
  const { related, other } = swapCandidates(w, ex);
  const dialog = document.createElement('dialog'); dialog.className = 'numeric-editor'; dialog.setAttribute('aria-label', 'Swap ' + ex.name);
  const heading = document.createElement('h2'); heading.textContent = 'Swap ' + ex.name; dialog.append(heading);
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = 'For this session only; the routine is unchanged. The new exercise keeps ' + (ex.plannedSets || ex.sets.length) + ' sets' +
    (ex.targetRepsMin != null ? ' of ' + ex.targetRepsMin + (ex.targetRepsMax !== ex.targetRepsMin ? ' to ' + ex.targetRepsMax : '') + (ex.unit === 'time' ? ' seconds' : ' reps') : '') +
    (ex.targetRir != null ? ' at RIR ' + ex.targetRir : '') + '.';
  const label = document.createElement('label'); label.className = 'field'; const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = 'Swap for';
  const select = document.createElement('select'); select.id = 'swap-select';
  for (const [title, list] of [['Same movement family', related], ['Other exercises', other]]){
    if (!list.length) continue;
    const group = document.createElement('optgroup'); group.label = title;
    for (const e of list){ const option = document.createElement('option'); option.value = e.id; option.textContent = e.name; group.append(option); }
    select.append(group);
  }
  label.append(cap, select); dialog.append(hint, label);
  const actions = document.createElement('div'); actions.className = 'editor-actions'; dialog.append(actions);
  const button = (text, css, action, disabled) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + css; b.textContent = text; b.disabled = !!disabled; b.addEventListener('click', action); actions.append(b); };
  button('Swap', 'btn-primary', () => { dialog.close(); swapExercise(idx, select.value); }, !select.options.length);
  button('Cancel', '', () => dialog.close());
  if (!select.options.length){ const none = document.createElement('p'); none.className = 'hint'; none.textContent = 'Every library exercise is already in this session.'; label.after(none); }
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); }, { once:true });
  document.body.append(dialog); dialog.showModal();
}
function deleteSet(setId){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout, ex = currentExercise();
  if (!w || !ex) return;
  const i = ex.sets.findIndex(s => s.id === setId);
  if (i === -1) return;
  const s = ex.sets[i];
  const go = () => {
    if(!context.deleteRecoverableSet(w,ex,s))return;
    const remaining=currentExercise()?.sets||[];
    context.ui.focus=remaining.length?'sd-'+remaining[Math.min(i,remaining.length-1)].id:'ex-panel-top';
    context.render();
  };
  /* Only a logged set is worth a dialog. An uncompleted row is a plan, and
     "+ Set" puts it back — asking about one would also be misleading, since
     addSet() pre-fills a new row from the set above it, so "this row has a
     weight in it" says nothing about whether the user typed anything. */
  if (!s.completed){ go(); return; }
  context.confirmDlg('Delete set ' + (i + 1) + '?',
    'This set is logged as done. Deleting it removes it from this session\u2019s totals.',
    'Delete set', true).then(ok => { if (ok) go(); });
}

/* Removing the exercise from the session is the local answer; if it came from
   a routine, the user may well mean the plan itself, so that is offered as a
   separate, clearly-labelled choice rather than assumed either way. */
function confirmExerciseRemoval(w, ex){
  const idx = w.exercises.indexOf(ex);
  const routine = w.routineId ? context.routineById(w.routineId) : null;
  const inRoutine = routine ? routine.items.filter(it => it.exerciseId === ex.exerciseId).length : 0;

  const buttons = [
    { label:'Cancel', value:'cancel', cls:'', autofocus:true },
    { label:'Remove from session', value:'session', cls:'btn-danger' }
  ];
  if (inRoutine) buttons.push({ label:'Remove from routine too', value:'routine', cls:'btn-danger-solid' });

  context.dialog({
    title:'Remove \u201C' + ex.name + '\u201D?',
    body:'Remove this exercise and its sets from the current session.' +
      (inRoutine
        ? ' You can drop it from this session only, or also remove it from \u201C' + routine.name +
          '\u201D so it stops appearing in future sessions.'
        : ''),
    buttons
  }).then(v => {
    if (v !== 'session' && v !== 'routine') return;
    const run = supersetRun(w, idx);
    const partners = run.filter(i => i !== idx).map(i => w.exercises[i]);
    w.exercises.splice(idx, 1);
    if (ex.eitherOf){
      const partner = w.exercises.find(other => other.eitherOf === ex.eitherOf);
      if (partner) delete partner.eitherOf;
    }
    settleSupersets(w);
    /* a superset partner with work left takes over; otherwise move on past
       whatever remains of it, which for a lone block is the old position */
    const heir = partners.find(p => !p.skipped && !allSetsDone(p));
    if (heir) pointAt(w, w.exercises.indexOf(heir));
    else pointAt(w, Math.min(run[run.length - 1], w.exercises.length));
    let msg = 'Removed ' + ex.name + ' from this session';
    if (v === 'routine'){
      /* the workout block does not record which routine item built it, so
         every item for this exercise goes — reported, not silent */
      routine.items = routine.items.filter(it => it.exerciseId !== ex.exerciseId);
      context.cleanRoutinePairs(routine.items);
      msg = 'Removed ' + ex.name + ' from this session and from ' + routine.name +
        (inRoutine > 1 ? ' (' + inRoutine + ' entries)' : '');
    }
    /* removing the last exercise leaves the same empty session that starting a
       quick session does, so land in the same place: the drawer, which is
       where exercises are added */
    if (!w.exercises.length){ context.ui.overviewOpen = true; context.ui.focus = 'add-ex-select'; }
    else context.ui.focus = 'ex-panel-top';
    context.save();
    context.render();
    context.toast(msg);
  });
}

function addSet(){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(); if (!ex) return;
  const s = newSetFrom(ex, ex.sets[ex.sets.length - 1]);
  ex.sets.push(s);
  context.save();
  context.ui.focus = (ex.unit === 'time' ? 'sr-' : 'sw-') + s.id;
  context.render();
  context.toast('Set ' + ex.sets.length + ' added');
}
/* A warm-up ramp before the first working set: 50% for 8, 70% for 5 and 85%
   for 3 of its load, each rounded to the Settings load step. A step that rounds
   to nothing, to the working load or to the step before it is dropped, so a
   light load gets fewer warm-ups. Bodyweight work ramps its added load from
   none. Timed work, a set with no load, and an exercise that already has
   warm-ups or logged sets get none. */
const WARMUP_RAMP = [[0.5, 8], [0.7, 5], [0.85, 3]];
function warmupPlan(ex){
  if (!ex || ex.unit === 'time' || ex.sets.some(s => s.completed || context.isWarmup(s))) return [];
  const first = ex.sets[0], bodyweight = ex.unit === 'bw';
  const load = first && context.toNum(bodyweight ? first.addedWeight : first.weight);
  if (load == null || load <= 0) return [];
  const step = context.toNum(context.state.settings.loadStep) || 2.5, plan = [];
  for (const [share, reps] of bodyweight ? [[0, 8], [0.5, 5]] : WARMUP_RAMP){
    const value = Math.round(Math.round(load * share / step) * step * 100) / 100;
    if ((value <= 0 && !bodyweight) || value >= load || plan.some(p => p.load === value)) continue;
    plan.push({ load:value, reps });
  }
  return plan;
}
function addWarmups(){
  if(context.workoutHandoff.held())return;
  const ex = currentExercise(), plan = warmupPlan(ex);
  if (!plan.length){ context.toast('No warm-up sets to add for ' + (ex ? ex.name : 'this exercise')); return; }
  const first = ex.sets[0], bodyweight = ex.unit === 'bw';
  const rows = plan.map(({ load, reps }) => {
    const s = newSetFrom(ex, null);
    if (bodyweight){ s.addedWeight = load; s.addedWeightUnit = first.addedWeightUnit || context.unitLabel(); }
    else { s.weight = load; s.unit = first.unit || s.unit; }
    s.reps = reps; context.setWarmup(s, true);
    return s;
  });
  ex.sets.unshift(...rows);
  context.save({changed:['activeWorkout']});
  context.ui.focus = 'sn-' + rows[0].id;
  context.render();
  context.toast('Added ' + context.plural(rows.length, 'warm-up set') + '. They count toward neither volume nor records.');
}
/* `toOpen` is the move a finished exercise makes: on to the next one with
   work left (nextOpenBlock), rather than the next one in the list. */
function advanceExercise(markSkipped, toOpen){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout; const ex = currentExercise();
  if (!w || !ex) return;
  if (markSkipped){ ex.skipped = true; context.announce(ex.name + ' skipped.'); }
  /* a skipped superset member leaves its partner to finish as straight sets */
  const turn = markSkipped ? supersetTurn(w) : null;
  const open = toOpen && !turn ? nextOpenBlock(w) : null;
  if (turn) pointAt(w, turn.index);
  else if (open != null){
    if (open < 0){ w.currentExerciseIndex = w.exercises.length; w.supersetSide = 0; }
    else enterAt(w, open);
  } else {
    /* the cursor moves a superset at a time, so "next" is past its last member */
    const run = supersetRun(w, w.currentExerciseIndex);
    const next = run[run.length - 1] + 1;
    if (next >= w.exercises.length){ w.currentExerciseIndex = w.exercises.length; w.supersetSide = 0; }
    else enterAt(w, next);
  }
  context.save();
  if (!markSkipped && w.currentExerciseIndex < w.exercises.length)
    context.announce('Now: ' + currentExercise().name);
  context.ui.focus = 'ex-panel-top';
  context.render();
}
/* Back one exercise. `reopenExercise` is the same move the drawer makes, so
   stepping back into a skipped exercise un-skips it: the exercise you are
   looking at is never one the session has written off. From the end-of-session
   state the index sits one past the last exercise, hence the clamp. */
function goToPreviousExercise(){
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout; if (!w) return;
  const i = Math.min(w.currentExerciseIndex, w.exercises.length) - 1;
  if (i < 0) return;
  reopenExercise(i);
  context.announce('Back to ' + w.exercises[i].name + '.');
}
function reopenExercise(idx){
  const w = context.state.activeWorkout; if (!w) return;
  if (idx < 0 || idx >= w.exercises.length) return;
  w.exercises[idx].skipped = false;
  pointAt(w, idx);
  context.save();
  context.ui.focus = 'ex-panel-top';
  context.render();
}
/* An exercise the session has finished with: skipped, or every set logged and
   not the one on screen. It is a matter of status, not of position — an
   exercise passed over by jumping ahead still has work in it, and a finished
   one can sit anywhere once the list has been rearranged. The sheet draws
   these with their logged sets and a Reopen button; automatic advancing steps
   over them. */
function isSettledRow(w, ex, i){
  return ex.skipped || (allSetsDone(ex) && i !== currentMemberIndex(w));
}
const hasWorkLeft = ex => !!ex && !ex.skipped && !allSetsDone(ex);
/* Move one exercise to another position in the session. Every row moves —
   finished, skipped, current and still to come alike — so the sheet is one
   list with one set of rules, and ordering it never depends on how far the
   session has got.

   "Now" stays with the exercise being worked on, wherever it or anything else
   moves, with one exception that is the point of moving it: dragging the
   current exercise later means "I'll come back to this one", standing in front
   of an occupied machine. Then the first exercise with work left that it was
   moved past takes over. Moved past nothing but finished work, it stays. A move
   within its own superset never hands over: that is reordering the round.

   A move that separates a superset ends it for this session (settleSupersets).
   Returns { landed, ended }: where the exercise ended up and whether a
   superset ended. */
function moveSessionExercise(w, from, to){
  const cur = w.exercises[currentMemberIndex(w)] || null;
  const [moved] = w.exercises.splice(from, 1);
  w.exercises.splice(to, 0, moved);
  const ended = settleSupersets(w);
  let next = cur;
  if (cur && moved === cur && to > from){
    const own = supersetRun(w, w.exercises.indexOf(cur)).map(i => w.exercises[i]);
    for (let k = from; k < to; k++){
      const ex = w.exercises[k];
      if (hasWorkLeft(ex) && !own.includes(ex)){ next = ex; break; }
    }
  }
  if (next) pointAt(w, w.exercises.indexOf(next));
  else w.currentExerciseIndex = w.exercises.length;
  return { landed:w.exercises.indexOf(moved), ended };
}
/* After an exercise is finished: the next block that still has work, looking
   forward first and then back to anything passed over earlier — rearranging
   can leave finished exercises later in the list, and jumping ahead can leave
   unfinished ones earlier. -1 when nothing is left. The pager's Next stays a
   plain step to the following exercise; this is only the automatic move. */
function nextOpenBlock(w){
  const run = supersetRun(w, w.currentExerciseIndex);
  const n = w.exercises.length, after = run[run.length - 1];
  for (let k = 1; k <= n; k++){
    const i = (after + k) % n;
    if (!run.includes(i) && hasWorkLeft(w.exercises[i])) return i;
  }
  return -1;
}
/* The arrow buttons are a drag of exactly one place, and they commit the same
   way — through the list's own drop. All they add is where the focus goes
   afterwards: it stays on the button being held, unless the move disabled it,
   in which case the other one takes over. */
function overviewStep(idx, dir){
  const w = context.state.activeWorkout; if (!w) return;
  const to = idx + dir, last = w.exercises.length - 1;
  if (idx < 0 || idx > last || to < 0 || to > last) return;
  const atBound = dir < 0 ? to === 0 : to === last;
  const keep = atBound ? (dir < 0 ? 'ov-down-' : 'ov-up-') : (dir < 0 ? 'ov-up-' : 'ov-down-');
  context.SORTABLES['session-exercises'].drop(idx, to, keep + to);
}
/* A superset made mid-session: the second exercise moves to just after the
   first, and the pair lasts for this workout only — the routine keeps its plan,
   the same as a superset a reorder ends. Both must still have work in them and
   belong to no pair; the dialog offers nothing else. */
function pairSessionExercises(a, b){
  const w = context.state.activeWorkout; if (!w) return false;
  const first = w.exercises[a], second = w.exercises[b];
  const free = ex => hasWorkLeft(ex) && !ex.eitherOf && !ex.supersetOf;
  if (!first || !second || first === second || !free(first) || !free(second)) return false;
  const cur = w.exercises[currentMemberIndex(w)] || null;
  w.exercises.splice(b, 1);
  w.exercises.splice(w.exercises.indexOf(first) + 1, 0, second);
  first.supersetOf = second.supersetOf = context.uid();
  if (cur) pointAt(w, w.exercises.indexOf(cur));
  context.save();
  return true;
}
function unpairSessionExercises(key){
  const w = context.state.activeWorkout; if (!w || !key) return false;
  const cur = w.exercises[currentMemberIndex(w)] || null;
  let removed = false;
  w.exercises.forEach(ex => { if (ex.supersetOf === key){ delete ex.supersetOf; removed = true; } });
  if (!removed) return false;
  if (cur) pointAt(w, w.exercises.indexOf(cur));
  context.save();
  return true;
}
function finishWorkout(){
  if(context.workoutHandoff.held()){context.toast('Workout held for handoff');return;}
  const w = context.state.activeWorkout; if (!w) return;
  const done = context.workoutSets(w);
  const commit = discard => {
    if (discard){
      context.state.activeWorkout = null; context.save(); context.loadTimer(context.state.settings.defaultRest); context.render();
      context.toast('Workout discarded'); return;
    }
    w.finishedAt = Date.now();
    /* how the plan was performed stays with the session in progress */
    delete w.supersetSide;
    w.exercises.forEach(ex => { delete ex.supersetOf; });
    /* drop rows never touched, then exercises left with nothing to show. A
       load alone does not mark a row as touched: buildWorkoutExercise seeds
       it from the plan or the last session. */
    w.exercises.forEach(ex => {
      ex.sets = ex.sets.filter(s => s.completed || s.reps != null || s.durationSeconds != null);
    });
    w.exercises = w.exercises.filter(ex => ex.sets.length > 0 || ex.skipped);
    context.state.workouts.push(w);
    context.sortWorkouts();
    /* A plan is spent once its session is saved; the workout keeps what it
       prescribed. Discarding the session leaves the plan in place. */
    const plan = w.routineId ? context.routineById(w.routineId) : null;
    const planDone = context.isPlan(plan);
    if (planDone) context.state.routines = context.state.routines.filter(r => r !== plan);
    context.state.activeWorkout = null;
    context.save(); context.loadTimer(context.state.settings.defaultRest);
    /* the finished session opens in its sheet, as the summary of what was
       done; a search left in History would hide its row once it closed */
    context.ui.historyQuery = '';
    context.ui.historyTab = 'sessions';
    context.ui.focus = 'detail-title';
    context.navigate('history', { kind:'workout', id:w.id });
    window.scrollTo(0,0);
    context.toast('Workout saved — ' + context.fmtNum(context.workoutVolume(w)) + ' ' + context.unitLabel() + ' total' + (planDone ? ' · plan done' : ''));
    context.maybeNagBackup();
  };
  if (done === 0){
    context.dialog({ title:'No sets completed', body:'This workout has no completed sets. Do you want to save it anyway?',
      buttons:[
        { label:'Discard', value:'discard', cls:'btn-danger' },
        { label:'Cancel', value:'cancel', cls:'', autofocus:true },
        { label:'Save anyway', value:'save', cls:'btn-primary' }
      ]}).then(v => { if (v === 'save') commit(false); else if (v === 'discard') commit(true); });
  } else commit(false);
}
function discardWorkout(){
  if(context.workoutHandoff.held()){context.toast('Cancel the handoff in Settings before discarding the workout');return;}
  context.confirmDlg('Discard workout?','All sets logged in this session will be lost. This cannot be undone.','Discard workout',true)
    .then(ok => {
      if (!ok) return;
      context.state.activeWorkout = null; context.save(); context.loadTimer(context.state.settings.defaultRest);
      context.render(); context.toast('Workout discarded');
    });
}
    return {newSetFrom,buildWorkoutExercise,beginWorkout,startSession,newWorkout,startRoutine,startEmpty,newRoutineItem,addExerciseToWorkout,supersetRun,currentMemberIndex,pointAt,enterAt,settleSupersets,supersetTurn,currentExercise,allSetsDone,settleEitherOf,fillSetDefaults,toggleWarmup,toggleSet,switchSupersetMember,cascadeSetField,cascadeWeight,setReps,openSetEditor,canSwap,swapExercise,openSwapDialog,openExerciseMenu,warmupPlan,addWarmups,deleteSet,confirmExerciseRemoval,addSet,advanceExercise,goToPreviousExercise,reopenExercise,isSettledRow,hasWorkLeft,moveSessionExercise,nextOpenBlock,overviewStep,pairSessionExercises,unpairSessionExercises,finishWorkout,discardWorkout};
  }
};
