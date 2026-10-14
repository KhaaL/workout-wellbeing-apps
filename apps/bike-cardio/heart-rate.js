/* exported HeartRateCore */
const HeartRateCore = (() => {
  const FRESH_MS = 5000, MAX_GAP_MS = 5000;
  // Bluetooth SIG Heart Rate Measurement (0x2A37), little endian.
  function parse(value) {
    if(!value || typeof value.getUint8!=='function' || value.byteLength<2)return null;
    const flags=value.getUint8(0), wide=Boolean(flags&1);
    let offset=wide?3:2;
    if(value.byteLength<offset)return null;
    const bpm=wide?value.getUint16(1,true):value.getUint8(1);
    if(flags&8){offset+=2;if(value.byteLength<offset)return null;}
    const rr=[];
    if(flags&16){if((value.byteLength-offset)%2)return null;for(;offset<value.byteLength;offset+=2)rr.push(value.getUint16(offset,true)*1000/1024);}
    else if(value.byteLength!==offset)return null;
    const contact=(flags&4)?Boolean(flags&2):null;
    return {bpm,contact,rr,valid:bpm>0 && bpm<=300 && contact!==false};
  }
  function fresh(reading,now) {return Boolean(reading?.valid && Number.isFinite(reading.at) && now>=reading.at && now-reading.at<=FRESH_MS);}
  function advice(reading,now,targets) {
    if(!fresh(reading,now))return null;
    const t=BikeTargets.normalize(targets);
    return reading.bpm>t.zoneMax ? {action:'high',text:`Above ${t.zoneMax} · reduce one level`} : reading.bpm<t.adjustBelow ? {action:'low',text:`Below ${t.adjustBelow} · add one level`} : {action:'hold',text:`Hold resistance · aim for ${t.targetMin}–${t.targetMax}`};
  }
  function createStats(targets){return {targets:BikeTargets.normalize(targets),version:1,measuredMs:0,bpmMs:0,zoneMs:0,samples:0,last:null,trace:BikeTrace.create()};}
  function breakSeries(stats){if(stats)stats.last=null;}
  function sample(stats,reading,now,activeMs,eligible=true) {
    if(!stats)return;
    if(!eligible || !fresh(reading,now) || !Number.isFinite(activeMs)){breakSeries(stats);return;}
    const previous=stats.last, wall=previous?now-previous.at:0, active=previous?activeMs-previous.activeMs:0;
    // Only join adjacent, visible, valid samples. Never fill a pause or missing interval.
    if(previous && wall>0 && wall<=MAX_GAP_MS && active>0 && active<=wall+1){
      stats.measuredMs+=active;stats.bpmMs+=previous.bpm*active;BikeTrace.add(stats.trace,previous.activeMs,activeMs,previous.bpm);
      if(previous.bpm>=stats.targets.zoneMin && previous.bpm<=stats.targets.zoneMax)stats.zoneMs+=active;
    }
    stats.samples++;stats.last={at:now,activeMs,bpm:reading.bpm};
  }
  function restoreStats(raw,targets) {
    const stats=createStats(raw?.targets||targets);
    if(raw?.version===1 && ['measuredMs','bpmMs','zoneMs','samples'].every(k=>Number.isFinite(raw[k])&&raw[k]>=0) && raw.zoneMs<=raw.measuredMs && raw.bpmMs<=raw.measuredMs*300){
      for(const k of ['measuredMs','bpmMs','zoneMs','samples'])stats[k]=raw[k];
      stats.trace=BikeTrace.restore(raw.trace);
    }
    return stats;
  }
  function summary(stats,activeMs) {
    const s=restoreStats(stats);
    return {source:'Bluetooth heart-rate strap',targets:s.targets,averageHR:s.measuredMs?Math.round(s.bpmMs/s.measuredMs*10)/10:null,zoneMs:s.zoneMs,measuredMs:s.measuredMs,samples:s.samples,coverage:activeMs>0?Math.min(100,Math.round(s.measuredMs/activeMs*1000)/10):0};
  }
  /* What the trace says about parts of the ride, given its finished phases in
     order (their ms add up along active time). Zone 2's main block gets an
     average and, when 10 minutes or longer, HR drift: the second half's
     average against the first's. Each sprint effort and the Zone 2 main
     block get a 60-second recovery: the last 5 seconds of the phase against
     seconds 55 to 60 after it. Any figure needs half its window measured. */
  function analyze(stats,phases){
    const s=restoreStats(stats),trace=BikeTrace.encode(s.trace),round=n=>Math.round(n*10)/10;
    if(!/\d/.test(trace))return {};
    const result={trace:{binSeconds:BikeTrace.BIN_MS/1000,bpm:trace}},range=(from,to)=>BikeTrace.range(s.trace,from,to);
    let at=0;const spans=(phases||[]).map(p=>{const span={kind:p.kind,from:at,to:at+p.ms};at+=p.ms;return span;});
    const main=spans.find(p=>p.kind==='main'&&p.to>p.from),whole=main&&range(main.from,main.to);
    if(whole&&whole.coverage>=0.5){
      const mid=(main.from+main.to)/2,a=range(main.from,mid),b=range(mid,main.to);
      result.main={averageHR:round(whole.average),coverage:round(whole.coverage*100),
        driftPct:main.to-main.from>=600000&&a.coverage>=0.5&&b.coverage>=0.5?round((b.average-a.average)/a.average*100):null};
    }
    const recovery=spans.filter(p=>p.kind==='effort'||p.kind==='main').map(p=>{
      const end=range(p.to-5000,p.to),later=range(p.to+55000,p.to+60000);
      return end.coverage>=0.5&&later.coverage>=0.5?Math.round(end.average-later.average):null;
    });
    if(recovery.some(n=>n!==null))result.recovery60=recovery;
    return result;
  }
  return {FRESH_MS,MAX_GAP_MS,parse,fresh,advice,createStats,breakSeries,sample,restoreStats,summary,analyze};
})();
