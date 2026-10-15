/* exported PowerCore */
/* Bike power and cadence from two standard Bluetooth services: Fitness
   Machine Indoor Bike Data (0x2AD2) and Cycling Power Measurement (0x2A63).
   Cycling power reports crank revolutions rather than cadence, so cadence comes
   from the change between two packets. Readings are kept like heart rate:
   adjacent readings at most 5 seconds apart fill 5-second bins of active time. */
const PowerCore = (() => {
  const FITNESS_MACHINE = 0x1826, INDOOR_BIKE_DATA = 0x2AD2, CYCLING_POWER = 0x1818, CYCLING_POWER_MEASUREMENT = 0x2A63;
  const FRESH_MS = 5000, MAX_GAP_MS = 5000, MAX_WATTS = 2500, MAX_RPM = 250;
  const watts = n => Number.isFinite(n) && n >= 0 && n <= MAX_WATTS ? n : null;
  const rpm = n => Number.isFinite(n) && n >= 0 && n <= MAX_RPM ? Math.round(n * 10) / 10 : null;
  // Fields in Indoor Bike Data order; bit 0 set means instantaneous speed is absent.
  function parseIndoorBike(value) {
    if (!value || typeof value.getUint16 !== 'function' || value.byteLength < 2) return null;
    const flags = value.getUint16(0, true);
    let offset = 2, cadence = null, power = null;
    const skip = n => { offset += n; return offset <= value.byteLength; };
    if (!(flags & 1) && !skip(2)) return null;
    if (flags & 2 && !skip(2)) return null;
    if (flags & 4) { if (!skip(2)) return null; cadence = value.getUint16(offset - 2, true) / 2; }
    if (flags & 8 && !skip(2)) return null;
    if (flags & 16 && !skip(3)) return null;
    if (flags & 32 && !skip(2)) return null;
    if (flags & 64) { if (!skip(2)) return null; power = value.getInt16(offset - 2, true); }
    if (power === null && cadence === null) return null;
    return {watts:power === null ? null : watts(power), cadence:cadence === null ? null : rpm(cadence), valid:true};
  }
  function parseCyclingPower(value, previous) {
    if (!value || typeof value.getUint16 !== 'function' || value.byteLength < 4) return null;
    const flags = value.getUint16(0, true), power = value.getInt16(2, true);
    let offset = 4, crank = null, cadence = null;
    const skip = n => { offset += n; return offset <= value.byteLength; };
    if (flags & 1 && !skip(1)) return null;
    if (flags & 4 && !skip(2)) return null;
    if (flags & 16 && !skip(6)) return null;
    if (flags & 32) {
      if (!skip(4)) return null;
      crank = {revs:value.getUint16(offset - 4, true), time:value.getUint16(offset - 2, true)};
      const last = previous?.crank;
      if (last) {
        const revs = (crank.revs - last.revs + 65536) % 65536, ticks = (crank.time - last.time + 65536) % 65536;
        // No new crank event since the last packet: keep the last cadence.
        cadence = ticks > 0 && revs < 20 ? rpm(revs * 60 * 1024 / ticks) : ticks === 0 ? previous.cadence ?? null : null;
      }
    }
    return {watts:watts(power), cadence, crank, valid:true};
  }
  const fresh = (reading, now) => Boolean(reading?.valid && Number.isFinite(reading.at) && now >= reading.at && now - reading.at <= FRESH_MS);
  const createStats = () => ({version:1, measuredMs:0, samples:0, last:null, watts:BikeTrace.create(), rpm:BikeTrace.create()});
  function breakSeries(stats) { if (stats) stats.last = null; }
  function sample(stats, reading, now, activeMs, eligible = true) {
    if (!stats) return;
    if (!eligible || !fresh(reading, now) || !Number.isFinite(activeMs)) { breakSeries(stats); return; }
    const previous = stats.last, wall = previous ? now - previous.at : 0, active = previous ? activeMs - previous.activeMs : 0;
    if (previous && wall > 0 && wall <= MAX_GAP_MS && active > 0 && active <= wall + 1) {
      if (previous.watts !== null) { stats.measuredMs += active; BikeTrace.add(stats.watts, previous.activeMs, activeMs, previous.watts); }
      if (previous.cadence !== null) BikeTrace.add(stats.rpm, previous.activeMs, activeMs, previous.cadence);
    }
    stats.samples++; stats.last = {at:now, activeMs, watts:reading.watts ?? null, cadence:reading.cadence ?? null};
  }
  function restoreStats(raw) {
    const stats = createStats();
    if (raw?.version === 1 && Number.isFinite(raw.measuredMs) && raw.measuredMs >= 0 && Number.isFinite(raw.samples) && raw.samples >= 0) {
      stats.measuredMs = raw.measuredMs; stats.samples = raw.samples;
      stats.watts = BikeTrace.restore(raw.watts); stats.rpm = BikeTrace.restore(raw.rpm);
    }
    return stats;
  }
  /* Summary for history, given the ride's finished phases and its heart-rate
     stats. Zone 2's main block gets average watts and cadence, watts at the
     comparison HR (5-second bins within 2 bpm of it, at least a minute of them)
     and, when 10 minutes or longer, aerobic decoupling: watts per beat in the
     first half against the second, as a percentage loss. */
  function analyze(raw, phases, hrStats, targets) {
    const s = restoreStats(raw), wattsTrace = BikeTrace.encode(s.watts), rpmTrace = BikeTrace.encode(s.rpm);
    if (!/\d/.test(wattsTrace + rpmTrace)) return null;
    const round = n => Math.round(n * 10) / 10, activeMs = (phases || []).reduce((sum, p) => sum + p.ms, 0);
    const result = {source:'Bluetooth bike sensor', measuredMs:Math.round(s.measuredMs), coverage:activeMs > 0 ? round(Math.min(100, s.measuredMs / activeMs * 100)) : 0,
      trace:{binSeconds:BikeTrace.BIN_MS / 1000, watts:wattsTrace, rpm:rpmTrace}};
    const whole = BikeTrace.range(s.watts, 0, activeMs);
    if (whole.average !== null) result.averageWatts = round(whole.average);
    const bins = s.watts.ms.map((ms, i) => ms >= BikeTrace.BIN_MS / 2 ? s.watts.sum[i] / ms : null).filter(n => n !== null);
    if (bins.length) result.peak5sWatts = Math.round(Math.max(...bins));
    let at = 0; const main = (phases || []).map(p => { const span = {kind:p.kind, from:at, to:at + p.ms}; at += p.ms; return span; }).find(p => p.kind === 'main' && p.to > p.from);
    if (!main) return result;
    const w = BikeTrace.range(s.watts, main.from, main.to), c = BikeTrace.range(s.rpm, main.from, main.to);
    if (w.coverage < 0.5) return result;
    result.main = {averageWatts:round(w.average), cadence:c.coverage >= 0.5 ? round(c.average) : null, coverage:round(w.coverage * 100), decouplingPct:null, fixedHRWatts:null};
    const hr = hrStats ? HeartRateCore.restoreStats(hrStats).trace : null;
    if (!hr) return result;
    const mid = (main.from + main.to) / 2, half = (from, to) => ({w:BikeTrace.range(s.watts, from, to), h:BikeTrace.range(hr, from, to)});
    const a = half(main.from, mid), b = half(mid, main.to);
    if (main.to - main.from >= 600000 && [a.w, a.h, b.w, b.h].every(x => x.coverage >= 0.5))
      result.main.decouplingPct = round((a.w.average / a.h.average - b.w.average / b.h.average) / (a.w.average / a.h.average) * 100);
    const near = [];
    for (let bin = Math.floor(main.from / BikeTrace.BIN_MS); bin * BikeTrace.BIN_MS < main.to; bin++) {
      const hrMs = hr.ms[bin], wMs = s.watts.ms[bin];
      if (hrMs >= BikeTrace.BIN_MS / 2 && wMs >= BikeTrace.BIN_MS / 2 && Math.abs(hr.sum[bin] / hrMs - targets.comparisonHR) <= 2) near.push(s.watts.sum[bin] / wMs);
    }
    if (near.length >= 12) result.main.fixedHRWatts = round(near.reduce((sum, n) => sum + n, 0) / near.length);
    return result;
  }
  return {FITNESS_MACHINE, INDOOR_BIKE_DATA, CYCLING_POWER, CYCLING_POWER_MEASUREMENT, FRESH_MS, parseIndoorBike, parseCyclingPower, fresh, createStats, breakSeries, sample, restoreStats, analyze};
})();
