/* History-only categories do not change runnable workout plans. */
/* exported BikeHistorySchema */
const BikeHistorySchema=(()=>{
  const version=3;
  const externalFields=[
    {name:'peakWatts',label:'Peak power',unit:'W',min:0,max:10000},
    {name:'maxCadence',label:'Maximum cadence',unit:'rpm',min:0,max:250},
    {name:'maxResistance',label:'Maximum resistance',unit:'console level',min:0,max:Number.MAX_SAFE_INTEGER},
    {name:'kcal',label:'Energy',unit:'kcal',min:0,max:Number.MAX_SAFE_INTEGER},
    {name:'distanceKm',label:'Distance',unit:'km',min:0,max:Number.MAX_SAFE_INTEGER},
    {name:'inclineAvgPct',label:'Average incline',unit:'%',min:-100,max:100},
    {name:'inclineMaxPct',label:'Maximum incline',unit:'%',min:-100,max:100}
  ];
  function config(input,sourceVersion=version){
    if(!input||!['zone2','sprint',...(sourceVersion>=3?['external']:[])].includes(input.mode))throw new Error('Invalid workout configuration');
    const result=WorkoutCore.config(input);
    if(sourceVersion>=3){
      const bike=input.bike??'unknown',context=input.context??'unknown';
      if(!['matrix','touchscreen','unknown'].includes(bike))throw new Error('Invalid recorded bike');
      if(!['fresh','post-lifting','unknown'].includes(context))throw new Error('Invalid recorded context');
      result.mode=input.mode;result.bike=bike;result.context=context;
    }
    return result;
  }
  function validateExternal(metrics){
    for(const field of externalFields){const value=metrics[field.name];if(value!=null&&(!Number.isFinite(value)||value<field.min||value>field.max))throw new Error('Invalid '+field.name);}
    for(const name of ['trainingBenefit','externalSource'])if(metrics[name]!=null&&(typeof metrics[name]!=='string'||metrics[name].length>500))throw new Error('Invalid '+name);
    if(metrics.polarZonesMs!=null){
      const zones=metrics.polarZonesMs;
      if(typeof zones!=='object'||Array.isArray(zones))throw new Error('Invalid polarZonesMs');
      for(const [name,value] of Object.entries(zones))if(!/^z[1-5]$/.test(name)||value!=null&&(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER))throw new Error('Invalid Polar zone duration');
    }
  }
  const modeLabel=mode=>({zone2:'Zone 2',sprint:'Sprint intervals',external:'Externally recorded'})[mode]||'Unknown workout';
  return {version,externalFields,config,validateExternal,modeLabel};
})();
