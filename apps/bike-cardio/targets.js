/* exported BikeTargets */
const BikeTargets = (() => {
  const defaults={zoneMin:105,zoneMax:122,targetMin:110,targetMax:120,adjustBelow:108,comparisonHR:115};
  function normalize(input={}){
    const result={...defaults,...input};
    for(const name of Object.keys(defaults))if(!Number.isInteger(result[name])||result[name]<1||result[name]>300)throw new Error('Heart-rate targets must be whole numbers from 1 to 300.');
    if(!(result.zoneMin<=result.adjustBelow&&result.adjustBelow<=result.targetMin&&result.targetMin<=result.comparisonHR&&result.comparisonHR<=result.targetMax&&result.targetMax<=result.zoneMax))throw new Error('Use ascending targets: zone minimum, add-below, working minimum, comparison HR, working maximum, zone maximum.');
    return Object.fromEntries(Object.keys(defaults).map(name=>[name,result[name]]));
  }
  /* Five zones from one or two measured numbers, and the six ride targets from
     zone 2. Maximum HR and heart-rate reserve (Karvonen: resting HR plus a
     share of max minus resting) use 50/60/70/80/90/100%; threshold HR uses
     81/90/94/100% bands for zones 2 to 5. Inside zone 2 the working band,
     add-below point and comparison HR keep the proportions of the 105 to 122
     default, so that default comes back from a zone 2 of 105 to 122.
     Percentages stay whole numbers so a half-beat boundary rounds up exactly. */
  const methods={max:'Maximum HR',reserve:'Heart-rate reserve',threshold:'Threshold HR'};
  function fromProfile(profile={}){
    const whole=(value,label,min,max)=>{const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);return n;};
    let bpm,bands;
    if(profile.method==='threshold'){const t=whole(profile.thresholdHR,'Threshold HR',80,220);bpm=p=>Math.round(t*p/100);bands=[[65,81],[81,89],[90,93],[94,99],[100,106]];}
    else if(profile.method==='max'||profile.method==='reserve'){
      const max=whole(profile.maxHR,'Maximum HR',100,230),rest=profile.method==='reserve'?whole(profile.restingHR,'Resting HR',30,120):0;
      if(max-rest<40)throw new Error('Maximum HR must be at least 40 above resting HR.');
      bpm=p=>Math.round(rest+(max-rest)*p/100);bands=[[50,60],[60,70],[70,80],[80,90],[90,100]];
    }else throw new Error('Choose maximum HR, heart-rate reserve or threshold HR.');
    const zones=bands.map(([low,high],i)=>({zone:i+1,min:bpm(low),max:bpm(high)}));
    const low=zones[1].min,high=zones[1].max,w=high-low,at=share=>Math.round(low+w*share);
    const targetMin=at(0.3),targetMax=at(0.88);
    return {zones,targets:normalize({zoneMin:low,zoneMax:high,adjustBelow:at(0.18),targetMin,targetMax,comparisonHR:Math.round((targetMin+targetMax)/2)})};
  }
  return {defaults,normalize,methods,fromProfile};
})();
