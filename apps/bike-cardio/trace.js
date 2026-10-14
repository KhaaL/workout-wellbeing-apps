/* exported BikeTrace */
/* Readings spread over 5-second bins of active riding time, so an average over
   any part of a ride (the main block, its halves, the minute after an effort)
   comes from what was measured. Paused time is not active time and never
   enters a bin; a gap in readings leaves a bin partly or wholly unmeasured. */
const BikeTrace = (() => {
  const BIN_MS = 5000, MAX_BINS = 8640; // 12 hours of riding
  const create = () => ({ms:[], sum:[]});
  function valid(raw) {
    return Boolean(raw && Array.isArray(raw.ms) && Array.isArray(raw.sum) && raw.ms.length === raw.sum.length && raw.ms.length <= MAX_BINS &&
      raw.ms.every((ms, i) => Number.isFinite(ms) && ms >= 0 && ms <= BIN_MS + 1 && Number.isFinite(raw.sum[i]) && raw.sum[i] >= 0));
  }
  const restore = raw => valid(raw) ? {ms:raw.ms.slice(), sum:raw.sum.slice()} : create();
  // `value` was held from active time `from` to `to` (milliseconds).
  function add(trace, from, to, value) {
    for (let at = Math.max(0, from); at < to;) {
      const bin = Math.floor(at / BIN_MS);
      if (bin >= MAX_BINS) return;
      while (trace.ms.length <= bin) { trace.ms.push(0); trace.sum.push(0); }
      const end = Math.min(to, (bin + 1) * BIN_MS), ms = end - at;
      trace.ms[bin] += ms; trace.sum[bin] += value * ms; at = end;
    }
  }
  // Measured time and average over [from, to), taking readings as spread evenly within a bin.
  function range(trace, from, to) {
    let ms = 0, sum = 0;
    for (let bin = Math.max(0, Math.floor(from / BIN_MS)); bin < trace.ms.length && bin * BIN_MS < to; bin++) {
      const overlap = Math.min(to, (bin + 1) * BIN_MS) - Math.max(from, bin * BIN_MS);
      if (overlap <= 0) continue;
      ms += trace.ms[bin] * overlap / BIN_MS; sum += trace.sum[bin] * overlap / BIN_MS;
    }
    return {ms, average:ms > 0 ? sum / ms : null, coverage:to > from ? Math.min(1, ms / (to - from)) : 0};
  }
  /* History keeps one whole number per bin in a comma-separated string: one
     value for the backup's object-count limit instead of one per bin. A bin
     measured for under half its length is stored empty (unknown). */
  function encode(trace) {
    const values = trace.ms.map((ms, i) => ms >= BIN_MS / 2 ? String(Math.round(trace.sum[i] / ms)) : '');
    while (values.length && values[values.length - 1] === '') values.pop();
    return values.join(',');
  }
  function decode(text, min, max) {
    if (typeof text !== 'string' || !/^\d*(,\d*)*$/.test(text)) return null;
    const values = text === '' ? [] : text.split(',').map(value => value === '' ? null : Number(value));
    return values.length <= MAX_BINS && values.every(value => value === null || (value >= min && value <= max)) ? values : null;
  }
  return {BIN_MS, MAX_BINS, create, restore, add, range, encode, decode};
})();
