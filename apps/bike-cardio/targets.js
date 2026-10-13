/* exported BikeTargets */
const BikeTargets = (() => {
  const defaults={zoneMin:105,zoneMax:122,targetMin:110,targetMax:120,adjustBelow:108,comparisonHR:115};
  function normalize(input={}){
    const result={...defaults,...input};
    for(const name of Object.keys(defaults))if(!Number.isInteger(result[name])||result[name]<1||result[name]>300)throw new Error('Heart-rate targets must be whole numbers from 1 to 300.');
    if(!(result.zoneMin<=result.adjustBelow&&result.adjustBelow<=result.targetMin&&result.targetMin<=result.comparisonHR&&result.comparisonHR<=result.targetMax&&result.targetMax<=result.zoneMax))throw new Error('Use ascending targets: zone minimum, add-below, working minimum, comparison HR, working maximum, zone maximum.');
    return Object.fromEntries(Object.keys(defaults).map(name=>[name,result[name]]));
  }
  return {defaults,normalize};
})();
