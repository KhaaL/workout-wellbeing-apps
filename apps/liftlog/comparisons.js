/* Pure session comparison. The app supplies its established unit/identity rules. */
/* exported LiftlogComparisons */
const LiftlogComparisons=(()=>{
  const sameRoutine=(a,b)=>a.routineId&&b.routineId?a.routineId===b.routineId:a.routineName===b.routineName;
  function compare(first,second,options){
    const [before,after]=[first,second].sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
    const warnings=[],rows=[],compatible=sameRoutine(before,after);
    const identities=w=>w.exercises.map(ex=>options.canonical(ex.exerciseId));
    const full=compatible&&JSON.stringify(identities(before))===JSON.stringify(identities(after))&&before.exercises.every((ex,i)=>options.sameContract(ex,after.exercises[i]));
    if(!full)warnings.push('Recorded exercises or load conventions differ. Whole-workout differences are withheld; only compatible exercise rows receive differences.');
    const add=(label,unit,a,b,allowed)=>rows.push({label,unit,before:a,after:b,delta:allowed&&a!=null&&b!=null?b-a:null});
    add('Completed working sets','sets',options.sets(before),options.sets(after),full);
    add('Recorded volume',options.unit,options.volume(before),options.volume(after),full);
    const minutes=w=>Number.isFinite(options.duration(w))?options.duration(w)/60000:null;
    add('Workout duration','min',minutes(before),minutes(after),full);
    for(const [index,ex] of before.exercises.entries()){
      const id=options.canonical(ex.exerciseId),occurrence=before.exercises.slice(0,index).filter(row=>options.canonical(row.exerciseId)===id).length;
      const match=after.exercises.filter(row=>options.canonical(row.exerciseId)===id)[occurrence];if(!match)continue;
      const valid=options.sameContract(ex,match),measure=block=>{
        const sets=block.sets.filter(set=>set.completed&&set.countForVolume!==false),timed=block.unit==='time';
        const values=sets.map(set=>timed?set.durationSeconds:set.reps),loads=sets.map(set=>options.load(set,block)).filter(value=>value!=null);
        return {sets:sets.length,total:values.some(value=>value==null)?null:values.reduce((a,b)=>a+b,0),load:loads.length?Math.max(...loads):null};
      },a=measure(ex),b=measure(match);
      add(ex.name+' · working sets','sets',a.sets,b.sets,valid);
      add(ex.name+(ex.unit==='time'?' · time':' · reps'),ex.unit==='time'?'s':'reps',a.total,b.total,valid);
      if(ex.unit!=='time')add(ex.name+(ex.unit==='bw'?' · max added load':' · max logged load'),options.loadLabel?.(ex)||options.unit,a.load,b.load,valid);
    }
    warnings.push('Working sets exclude warm-ups. Differences describe logged work; changed targets or effort can affect interpretation.');
    return {before,after,rows,warnings};
  }
  return {sameRoutine,compare};
})();
