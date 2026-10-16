/* Planned sessions. A plan is an ordered list of steps; expand() turns steps
   into the phases WorkoutCore runs. The built-in Zone 2 and sprint workouts are
   templates that emit the same steps (WorkoutCore.templateSteps), so an
   imported plan and a template take one path through the engine. */
/* exported BikePlans */
const BikePlans = (() => {
  const KINDS = ['warmup', 'primer', 'settle', 'main', 'effort', 'recovery', 'cooldown'];
  const LABELS = {warmup:'Warm-up', primer:'Primer', settle:'Easy', main:'Steady block', effort:'Effort', recovery:'Recovery', cooldown:'Cool-down'};
  const RECORD = ['effortResistance', 'effortWatts5s', 'recovery60', 'timeOfDay', 'hoursSinceLifting', 'fed', 'note'];
  const MAX_STEPS = 40, MAX_PHASES = 200, MAX_EFFORTS = 20, READY_MS = 5000;
  const fail = message => { throw new Error(message); };
  const present = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] != null;
  function text(value, max, label) {
    if (value == null || value === '') return '';
    if (typeof value !== 'string' || value.trim().length > max) fail(`${label} must be text of at most ${max} characters.`);
    return value.trim();
  }
  function whole(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
    return value;
  }
  // A target is a number, a [low, high] pair or a short label such as "easy".
  function target(value, max, label) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') return text(value, 40, label);
    const ok = n => Number.isFinite(n) && n >= 0 && n <= max;
    if (ok(value)) return value;
    if (Array.isArray(value) && value.length === 2 && value.every(ok) && value[0] <= value[1]) return [value[0], value[1]];
    fail(`${label} must be a number from 0 to ${max}, a [low, high] pair or a short label.`);
  }
  function step(raw, where) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${where} must be an object.`);
    if (!KINDS.includes(raw.kind)) fail(`${where}: kind must be one of ${KINDS.join(', ')}.`);
    const s = {kind:raw.kind, title:text(raw.title, 60, `${where} title`) || LABELS[raw.kind]};
    const ends = ['seconds', 'untilHrAtMost', 'untilHrBelow'].filter(key => present(raw, key));
    if (ends.length !== 1) fail(`${where} needs exactly one of seconds, untilHrAtMost or untilHrBelow.`);
    if (ends[0] === 'seconds') s.seconds = whole(raw.seconds, 1, 10800, `${where} seconds`);
    else {
      if (['primer', 'effort'].includes(s.kind)) fail(`${where}: a ${s.kind} needs seconds.`);
      s[ends[0]] = whole(raw[ends[0]], 40, 230, `${where} ${ends[0]}`);
      // An HR-gated step lasts at least a minute unless the plan says otherwise, so the 60-second recovery can be measured.
      s.minSeconds = raw.minSeconds == null ? 60 : whole(raw.minSeconds, 1, 3600, `${where} minSeconds`);
    }
    for (const [key, max] of [['resistance', 100], ['rpm', 250]]) { const value = target(raw[key], max, `${where} ${key}`); if (value !== null) s[key] = value; }
    if (present(raw, 'hr')) s.hr = text(raw.hr, 40, `${where} hr`);
    if (present(raw, 'hrBelow')) s.hrBelow = whole(raw.hrBelow, 40, 230, `${where} hrBelow`);
    const cue = text(raw.cue, 200, `${where} cue`); if (cue) s.cue = cue;
    if (present(raw, 'adjust')) {
      const a = raw.adjust, rule = {};
      if (s.kind !== 'effort' || typeof s.resistance !== 'number') fail(`${where}: adjust needs an effort with a numeric resistance.`);
      if (typeof a !== 'object' || Array.isArray(a)) fail(`${where}: adjust must be an object.`);
      if (present(a, 'cadenceAbove')) { rule.cadenceAbove = whole(a.cadenceAbove, 1, 250, `${where} adjust.cadenceAbove`); rule.add = whole(a.add ?? 1, 1, 20, `${where} adjust.add`); }
      if (present(a, 'cadenceBelow')) {
        rule.cadenceBelow = whole(a.cadenceBelow, 1, 250, `${where} adjust.cadenceBelow`); rule.subtract = whole(a.subtract ?? 1, 1, 20, `${where} adjust.subtract`);
        rule.beforeSeconds = a.beforeSeconds == null ? s.seconds : whole(a.beforeSeconds, 1, s.seconds, `${where} adjust.beforeSeconds`);
      }
      if (!Object.keys(rule).length) fail(`${where}: adjust needs cadenceAbove or cadenceBelow.`);
      s.adjust = rule;
    }
    return s;
  }
  const format = value => value == null ? null : Array.isArray(value) ? `${value[0]}–${value[1]}` : String(value);
  function hrText(s) {
    if (s.hr) return s.hr;
    if (s.hrBelow != null) return `Under ${s.hrBelow}`;
    if (s.untilHrAtMost != null) return `${s.untilHrAtMost} or below`;
    if (s.untilHrBelow != null) return `Below ${s.untilHrBelow}`;
    return s.kind === 'effort' ? 'Judge by feel' : 'No target';
  }
  /* Phases in run order. A 5-second "ready" phase goes before every primer and
     effort. Repeats number their titles; "between" runs between repeats only. */
  function expand(steps) {
    const phases = []; let effort = 0;
    const add = phase => phases.push({id:phases.length, ...phase});
    function emit(s, title) {
      const res = format(s.resistance) ?? '—';
      if (s.kind === 'effort') effort++;
      if (s.kind === 'primer') add({kind:'ready', title:`${title} in`, duration:READY_MS, hr:'No target', rpm:'Pick it up', res:'Add resistance', cue:'A short primer is coming.'});
      if (s.kind === 'effort') add({kind:'ready', title:`Effort ${effort} in`, duration:READY_MS, hr:'No target', rpm:'Pick it up', res, cue:'Resistance up. Stay seated.', effort});
      const phase = {kind:s.kind, title, duration:s.seconds != null ? s.seconds * 1000 : null, hr:hrText(s), rpm:format(s.rpm) ?? '—', res, cue:s.cue || ''};
      if (s.seconds == null) Object.assign(phase, {target:s.minSeconds * 1000, min:s.minSeconds * 1000, gate:s.untilHrBelow != null ? 'cool' : 'recovery', gateBpm:s.untilHrBelow ?? s.untilHrAtMost});
      if (s.kind === 'effort') { phase.effort = effort; if (typeof s.resistance === 'number') phase.base = s.resistance; if (s.adjust) phase.adjust = s.adjust; }
      add(phase);
    }
    const name = (title, i, n, between) => title.includes('{i}') || title.includes('{n}') ? title.replaceAll('{i}', i).replaceAll('{n}', n) : between ? `${title} ${i}` : `${title} ${i} of ${n}`;
    for (const item of steps) {
      if (item.repeat == null) { emit(item, item.title); continue; }
      for (let i = 1; i <= item.repeat; i++) {
        emit(item.step, name(item.step.title, i, item.repeat, false));
        if (item.between && i < item.repeat) emit(item.between, name(item.between.title, i, item.repeat, true));
      }
    }
    return phases;
  }
  // 64-bit FNV-1a over the steps and cue style: names, dates and notes never split a series.
  function hash(plan) {
    const input = JSON.stringify([plan.resistanceCues, plan.steps]);
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < input.length; i++) { const c = input.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0; }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A plan must be a JSON object.');
    const plan = {id:text(raw.id, 80, 'Plan id'), name:text(raw.name, 80, 'Plan name')};
    if (!plan.id) fail('Plan id is required.');
    if (!plan.name) fail('Plan name is required.');
    if (raw.order != null) plan.order = whole(raw.order, 0, 999, 'Plan order');
    if (raw.scheduledFor != null) {
      if (typeof raw.scheduledFor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.scheduledFor) || Number.isNaN(new Date(raw.scheduledFor + 'T00:00:00').getTime())) fail('scheduledFor must be a date such as 2026-10-17.');
      plan.scheduledFor = raw.scheduledFor;
    }
    if (raw.resistanceCues != null && !['levels', 'feel'].includes(raw.resistanceCues)) fail('resistanceCues must be "levels" or "feel".');
    plan.resistanceCues = raw.resistanceCues || 'levels';
    if (raw.conditions != null && (!Array.isArray(raw.conditions) || raw.conditions.length > 10)) fail('conditions must be a list of at most 10 items.');
    plan.conditions = (raw.conditions || []).map((c, i) => {
      if (!c || typeof c !== 'object') fail(`Condition ${i + 1} must be an object with a label.`);
      const label = text(c.label, 40, `Condition ${i + 1} label`); if (!label) fail(`Condition ${i + 1} needs a label.`);
      return {label, value:text(c.value, 60, `Condition ${i + 1} value`)};
    });
    if (raw.record != null && (!Array.isArray(raw.record) || raw.record.some(key => !RECORD.includes(key)))) fail(`record may list only ${RECORD.join(', ')}.`);
    plan.record = raw.record == null ? RECORD.slice() : RECORD.filter(key => raw.record.includes(key));
    const notes = text(raw.notes, 1000, 'Plan notes'); if (notes) plan.notes = notes;
    if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > MAX_STEPS) fail(`steps must list 1 to ${MAX_STEPS} steps.`);
    plan.steps = raw.steps.map((item, i) => {
      const where = `Step ${i + 1}`;
      if (!item || typeof item !== 'object' || item.repeat == null) return step(item, where);
      const block = {repeat:whole(item.repeat, 2, MAX_EFFORTS, `${where} repeat`), step:step(item.step, `${where} step`)};
      if (item.between != null) block.between = step(item.between, `${where} between`);
      return block;
    });
    const phases = expand(plan.steps);
    if (phases.length > MAX_PHASES) fail(`A plan may expand to at most ${MAX_PHASES} phases.`);
    if (phases.filter(p => p.kind === 'effort').length > MAX_EFFORTS) fail(`A plan may hold at most ${MAX_EFFORTS} efforts.`);
    plan.hash = hash(plan);
    return plan;
  }
  const mode = plan => expand(plan.steps).some(p => p.kind === 'effort') ? 'sprint' : 'zone2';
  const effortCount = plan => expand(plan.steps).filter(p => p.kind === 'effort').length;
  // Shortest possible ride: timed phases plus each HR-gated phase's minimum.
  const minimumMs = phases => phases.reduce((sum, p) => sum + (p.duration ?? p.min ?? 0), 0);
  /* Accepts one plan, a list of plans, or {plans:[...]}, as pasted from a chat or a file.
     A plan without an id gets one, so a coach's reply can leave it out. */
  function parse(input, makeId = () => 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)) {
    let raw;
    try { raw = typeof input === 'string' ? JSON.parse(input.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) : input; }
    catch { fail('This is not valid JSON. Copy the whole plan, including the outer braces.'); }
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.plans) ? raw.plans : [raw?.plan ?? raw];
    if (!list.length || list.length > 50) fail('Paste 1 to 50 plans.');
    return list.map(item => normalize(item && typeof item === 'object' && !item.id ? {...item, id:makeId()} : item));
  }
  const FORMAT = `Bike Cardio plan format. Reply with one JSON object, no comments:
{"name": "Sprint baseline", "scheduledFor": "2026-10-17", "order": 2,
 "resistanceCues": "levels",
 "conditions": [{"label": "Incline", "value": "0%"}],
 "notes": "What this session is for",
 "steps": [STEP, {"repeat": 4, "step": STEP, "between": STEP}, ...]}
STEP: {"kind": "warmup" | "primer" | "settle" | "main" | "effort" | "recovery" | "cooldown",
 "title": "Easy warm-up",
 "seconds": 480  OR  "untilHrAtMost": 122  OR  "untilHrBelow": 105  (with "minSeconds": 60),
 "resistance": 16 | [6, 8] | "easy", "rpm": [80, 90], "hrBelow": 120, "cue": "short text",
 "adjust": {"cadenceAbove": 110, "add": 2, "cadenceBelow": 70, "beforeSeconds": 20, "subtract": 2}}
"main" is a steady block with HR checks. "between" runs between repeats, not after the last.
"adjust" is for efforts: it changes the next effort's resistance from this effort's cadence.
scheduledFor, order, conditions, notes and adjust are optional.`;
  return {KINDS, RECORD, READY_MS, normalize, expand, hash, mode, effortCount, minimumMs, parse, format, FORMAT};
})();
