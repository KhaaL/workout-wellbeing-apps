/* liftlog exercises controller. Context getters always read current app state. */
/* exported LiftlogExerciseController */
const LiftlogExerciseController = {
  create(context){
function saveNewExercise(form){
  const name = form.name.trim();
  if (!name){ context.ui.exerciseFormError = 'Name is required.'; context.render(); return; }
  if (context.exerciseNameTaken(name)){
    context.ui.exerciseFormError = 'An exercise with this name already exists.'; context.render(); return;
  }
  /* A link that cannot be made into an http(s) one is dropped rather than
     failing the save: the exercise is the thing being created, and a typo in
     an optional field should not cost the name and the unit too. The toast
     says so, so it is not silent. */
  const url = context.safeUrl(form.url);
  const badUrl = !url && String(form.url || '').trim() !== '';
  context.state.exercises.push({
    id:context.uid(), name,
    category: context.normalizeCategory(form.category, name),
    unit: context.normalizedExerciseUnit(form.unit, context.state.settings.unit),
    loadMode: context.normalizeLoadMode(form.loadMode, form.unit),
    equipmentKey: String(form.equipmentKey || '').trim(),
    movementFamily: String(form.movementFamily || '').trim() || context.inferMovementFamily(name, form.category),
    archived:false,
    notes: form.notes.trim(),
    instructions: String(form.instructions || '').trimEnd(),
    url,
    ...(context.normalizeRestSeconds(form.restSeconds) != null ? { restSeconds:context.normalizeRestSeconds(form.restSeconds) } : {})
  });
  context.ui.showExerciseForm = false; context.ui.exerciseFormError = '';
  context.save(); context.render();
  context.toast(badUrl ? 'Exercise added — ' + name + ' (the link was not a valid web address)'
               : 'Exercise added — ' + name);
}
/* An active workout is not history yet. Keep its exercise identity metadata in
   step with Exercises so a correction made mid-session is visible at once.
   Changing between reps, bodyweight, and time would reinterpret fields that
   may already contain work, so that unit change begins with the next workout;
   kg/lb remain the same weighted measurement kind and are safe to refresh. */
function syncExerciseDefinitionToActiveWorkout(previous, updated){
  if(context.workoutHandoff.held())return;
  if(context.workoutHandoff.held())return;
  const w = context.state.activeWorkout;
  if (!w) return { updated:0, unitDeferred:false, loadDeferred:false };
  const sameMeasure = context.exerciseMeasureKind(previous.unit) === context.exerciseMeasureKind(updated.unit);
  const sameLoadIdentity = context.normalizeLoadMode(previous.loadMode, previous.unit) === context.normalizeLoadMode(updated.loadMode, updated.unit) &&
    String(previous.equipmentKey || '').trim().toLowerCase() === String(updated.equipmentKey || '').trim().toLowerCase();
  let count = 0, unitDeferred = false, loadDeferred = false;
  w.exercises.forEach(ex => {
    if (ex.exerciseId !== updated.id) return;
    ex.name = updated.name;
    ex.category = updated.category;
    ex.notes = updated.notes;
    ex.movementFamily = updated.movementFamily;
    if (sameMeasure) ex.unit = updated.unit;
    else unitDeferred = true;
    const hasEnteredLoad = ex.sets.some(set => set.completed || context.toNum(set.weight) != null || context.toNum(set.addedWeight) != null);
    if (sameLoadIdentity || !hasEnteredLoad){ ex.loadMode = updated.loadMode; ex.equipmentKey = updated.equipmentKey; }
    else loadDeferred = true;
    count++;
  });
  return { updated:count, unitDeferred, loadDeferred };
}
function saveExerciseDraft(){
  const d = context.ui.exerciseDraft; if (!d) return;
  if (!d.name.trim()){ context.toast('Name is required'); return; }
  const i = context.state.exercises.findIndex(e => e.id === d.id);
  if (i === -1) return;
  const previous = context.state.exercises[i];
  if (context.normalizedExerciseName(d.name) !== context.normalizedExerciseName(previous.name) && context.exerciseNameTaken(d.name, d.id)){
    context.toast('Another exercise is already named “' + d.name.trim() + '” — use Merge to combine them'); return;
  }
  const url = context.safeUrl(d.url);
  const badUrl = !url && String(d.url || '').trim() !== '';
  const updated = { id:d.id, name:d.name.trim(), category:context.normalizeCategory(d.category, d.name),
                    unit:context.normalizedExerciseUnit(d.unit, context.state.settings.unit),
                    loadMode:context.normalizeLoadMode(d.loadMode, d.unit), equipmentKey:String(d.equipmentKey || '').trim(),
                    movementFamily:String(d.movementFamily || '').trim() || context.inferMovementFamily(d.name, d.category),
                    archived:!!d.archived, notes:d.notes.trim(), instructions:String(d.instructions || '').trimEnd(), url,
                    ...(context.normalizeRestSeconds(d.restSeconds) != null ? { restSeconds:context.normalizeRestSeconds(d.restSeconds) } : {}) };
  const broken = context.linksBrokenBy(d.id, updated);
  if (!broken.length) return applyExerciseDraft(updated, badUrl ? ['the link was not a valid web address'] : []);
  return confirmHistorySplit(previous, updated, broken).then(choice => {
    if (!choice || !context.exerciseById(d.id) || context.ui.exerciseDraft !== d) return;
    const notes = badUrl ? ['the link was not a valid web address'] : [];
    if (choice === 'keep'){
      notes.push('load convention kept so its history stays in one series');
      applyExerciseDraft({ ...updated, unit:previous.unit, loadMode:previous.loadMode, equipmentKey:previous.equipmentKey }, notes);
      return;
    }
    const gone = new Set(broken.map(link => link.sourceId));
    context.state.exerciseLinks = context.state.exerciseLinks.filter(link => !(link.targetId === d.id && gone.has(link.sourceId)));
    context.state.settings.historyLinksDismissedKey = '';
    notes.push(context.plural(gone.size, 'earlier exercise') + ' separated — review them in History');
    applyExerciseDraft(updated, notes);
  });
}
/* Editing the definition of a linked exercise can change the contract its
   links were accepted under. The next load would drop them without a word, so
   the user chooses now: keep the convention, or separate them knowingly. */
function confirmHistorySplit(previous, updated, broken){
  const describe = ex => context.LOAD_MODE_TEXT[context.normalizeLoadMode(ex.loadMode, ex.unit)] +
    (String(ex.equipmentKey || '').trim() ? ' · ' + ex.equipmentKey.trim() : ', no equipment key');
  const ids = new Set(broken.map(link => link.sourceId));
  const sessions = context.state.workouts.filter(w => w.exercises.some(ex => ids.has(ex.exerciseId))).length;
  return context.dialog({ title:'Keep this exercise’s history together?',
    body:'“' + previous.name + '” is joined with ' + context.plural(ids.size, 'earlier exercise') + ' (' + context.plural(sessions, 'session') +
      ') recorded as ' + describe(previous) + '. Recording it as ' + describe(updated) +
      ' separates them from its progress chart.',
    buttons:[{ label:'Cancel', value:null },
      { label:'Change anyway', value:'change' },
      { label:'Keep history together', value:'keep', cls:'btn-primary', autofocus:true }] });
}
function applyExerciseDraft(updated, notes){
  const i = context.state.exercises.findIndex(e => e.id === updated.id);
  if (i === -1) return;
  const previous = context.state.exercises[i];
  context.state.exercises[i] = updated;
  const activeSync = syncExerciseDefinitionToActiveWorkout(previous, updated);
  context.ui.exerciseDraft = null;
  context.save(); context.render();
  if (activeSync.unitDeferred) notes.push('the new unit starts next workout');
  if (activeSync.loadDeferred) notes.push('the new load convention starts next workout');
  context.toast('Exercise updated' + (notes.length ? ' — ' + notes.join('; ') : ''));
}
function setExerciseArchived(id, archived){
  const ex = context.exerciseById(id); if (!ex) return;
  ex.archived = !!archived;
  if (context.ui.exerciseDraft && context.ui.exerciseDraft.id === id) context.ui.exerciseDraft = null;
  context.save(); context.render(); context.toast(ex.archived ? 'Exercise archived' : 'Exercise restored');
}
/* The same contract, or a source with nothing logged under it and not in the
   ongoing workout: with no sets there is no series whose meaning a different
   load convention could change. */
function canMergeExercises(source, target){
  if (context.exerciseMeasureKind(source.unit) !== context.exerciseMeasureKind(target.unit)) return false;
  return context.sameProgressionContract(source, target) || (!context.exerciseHasHistory(source.id) &&
    !(context.state.activeWorkout && context.state.activeWorkout.exercises.some(ex => ex.exerciseId === source.id)));
}
/* Writes state only; mergeExercises() is the Library action around it. */
function mergeExerciseInto(sourceId, targetId){
  const source = context.exerciseById(sourceId), target = context.exerciseById(targetId);
  if (!source || !target || sourceId === targetId) return 'Choose a different surviving exercise.';
  if (!canMergeExercises(source, target)) return '“' + source.name + '” has logged history under a different load convention or equipment, so it can only merge into an exercise recorded the same way.';
  const collision = context.state.routines.find(r => r.items.some(it => it.exerciseId === sourceId) && r.items.some(it => it.exerciseId === targetId));
  if (collision) return '“' + collision.name + '” contains both exercises. Remove or reconcile one routine item first.';
  if (context.state.activeWorkout && context.state.activeWorkout.exercises.some(ex => ex.exerciseId === sourceId) &&
      context.state.activeWorkout.exercises.some(ex => ex.exerciseId === targetId))
    return 'The ongoing workout contains both exercises. Finish it or remove one exercise before merging.';
  const keepWeight = context.sameLoadNumbers(source, target);
  /* the survivor keeps its own instructions; the source's fill an empty field */
  if (!String(target.instructions || '').trim() && String(source.instructions || '').trim()) target.instructions = source.instructions;
  context.state.routines.forEach(r => r.items.forEach(it => {
    if (it.exerciseId !== sourceId) return;
    it.exerciseId = targetId;
    if (!keepWeight) it.weight = null;
  }));
  if (context.state.activeWorkout) context.state.activeWorkout.exercises.forEach(ex => {
    if (ex.exerciseId !== sourceId) return;
    ex.exerciseId = targetId; ex.name = target.name; ex.category = target.category; ex.unit = target.unit;
    ex.loadMode = target.loadMode; ex.equipmentKey = target.equipmentKey; ex.movementFamily = target.movementFamily;
    ex.notes = target.notes;
  });
  const links = (context.state.exerciseLinks || []).filter(link => link.sourceId !== sourceId && link.sourceId !== targetId)
    .map(link => link.targetId === sourceId ? { sourceId:link.sourceId, targetId } : link);
  /* Normalization drops a link with no logged sets behind it anyway. */
  if (context.state.workouts.some(w => w.exercises.some(ex => ex.exerciseId === sourceId))) links.push({ sourceId, targetId });
  const seen = new Set();
  context.state.exerciseLinks = links.filter(link => !seen.has(link.sourceId) && seen.add(link.sourceId));
  context.combineProgressionPreferences(sourceId, targetId);
  context.state.historySeparateIds = (context.state.historySeparateIds || []).filter(id => id !== sourceId);
  context.state.exercises = context.state.exercises.filter(ex => ex.id !== sourceId);
  context.state.settings.historyLinksDismissedKey = '';
  return '';
}
function mergeExercises(sourceId, targetId){
  const source = context.exerciseById(sourceId), target = context.exerciseById(targetId);
  const error = mergeExerciseInto(sourceId, targetId);
  if (error) return error;
  context.ui.mergeExerciseId = null; context.ui.mergeExerciseError = ''; context.ui.exerciseDraft = null;
  context.save(); context.render(); context.toast('Merged “' + source.name + '” into “' + target.name + '”');
  return '';
}
function deleteExercise(id){
  const ex = context.exerciseById(id); if (!ex) return;
  const usedBy = context.state.routines.filter(r => r.items.some(it => it.exerciseId === id)).length;
  const extra = usedBy ? ' It is used by ' + usedBy + ' routine' + (usedBy > 1 ? 's' : '') + ', which will show it as removed.' : '';
  context.confirmDlg('Delete exercise?','“' + ex.name + '” will be removed from your exercises.' + extra,'Delete exercise',true)
    .then(ok => {
      if (!ok) return;
      context.state.exercises = context.state.exercises.filter(e => e.id !== id);
      context.state.exerciseLinks = (context.state.exerciseLinks || []).filter(link => link.targetId !== id);
      context.state.settings.historyLinksDismissedKey = '';
      if (context.ui.exerciseDraft && context.ui.exerciseDraft.id === id) context.ui.exerciseDraft = null;
      context.save(); context.render(); context.toast('Exercise deleted');
    });
}
    return {saveNewExercise,syncExerciseDefinitionToActiveWorkout,saveExerciseDraft,confirmHistorySplit,applyExerciseDraft,setExerciseArchived,canMergeExercises,mergeExerciseInto,mergeExercises,deleteExercise};
  }
};
