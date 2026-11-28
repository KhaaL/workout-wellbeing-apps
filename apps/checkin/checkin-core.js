/* Check-in model: tracked items, check-ins, validation, days and the merge window. No DOM. */
/* exported CheckinCore */
const CheckinCore = (() => {
  'use strict';
  const LIMITS = {items:200, entries:50000};
  // Today shows scale and symptom items. Number and tag items already validate,
  // so a later phase can show them without a schema change.
  const KINDS = ['scale', 'symptom', 'number', 'tag'];
  // Every scale and symptom score runs 1 to 5. A scale item says which end is
  // good ("better"), so colors mean the same thing on every item.
  const SCORES = 5, MOOD = ['Very low', 'Low', 'Okay', 'Good', 'Very good'];
  // Symptom values: 0 gone (recorded as over), 1 to 5 severity.
  // An item missing from a check-in is not recorded, which is different from 0.
  const SEVERITY = ['1', '2', '3', '4', '5'], LEVELS = ['Gone', ...SEVERITY];
  // A symptom recorded mild or worse within this many days stays ongoing until marked gone.
  const ONGOING_DAYS = 7;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/, ID = /^[A-Za-z0-9._-]{1,100}$/;
  const fail = message => { throw new Error(message); };
  const text = (value, max, label) => {
    if (value == null) return '';
    if (typeof value !== 'string') fail(label + ' must be text.');
    return value.trim().slice(0, max);
  };

  function settings(raw = {}){
    if (!raw || typeof raw !== 'object') fail('Invalid Check-in settings.');
    const dayStart = raw.dayStart ?? '04:00', mergeMinutes = raw.mergeMinutes ?? 30;
    if (typeof dayStart !== 'string' || !TIME.test(dayStart)) fail('Day change time must be HH:MM.');
    if (!Number.isSafeInteger(mergeMinutes) || mergeMinutes < 0 || mergeMinutes > 240) fail('The check-in window must be 0 to 240 minutes.');
    return {dayStart, mergeMinutes};
  }

  function item(raw){
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id)) fail('Invalid tracked item id.');
    if (!KINDS.includes(raw.kind)) fail('Unknown tracked item kind: ' + raw.kind);
    const name = text(raw.name, 60, 'Item name');
    if (!name) fail('Tracked items need a name.');
    const out = {id:raw.id, kind:raw.kind, name, pinned:raw.pinned !== false, archived:raw.archived === true};
    if (raw.kind === 'scale'){
      const better = raw.better ?? 'high';
      if (!['high', 'low'].includes(better)) fail('Invalid scale direction for ' + name + '.');
      Object.assign(out, {better, unit:text(raw.unit, 12, 'Unit')});
      for (const [key, max] of [['options', 8], ['words', 20]]){
        if (raw[key] == null) continue;
        if (!Array.isArray(raw[key]) || raw[key].length !== SCORES) fail('A scale needs ' + SCORES + ' ' + key + ' for ' + name + '.');
        out[key] = raw[key].map(v => text(v, max, 'Scale label') || fail('Empty scale label for ' + name + '.'));
      }
    }
    if (raw.kind === 'number'){
      const unit = text(raw.unit, 12, 'Unit'), min = raw.min ?? 0, max = raw.max ?? 24, step = raw.step ?? 0.5;
      if (![min, max, step].every(Number.isFinite) || min >= max || step <= 0) fail('Invalid number range for ' + name + '.');
      Object.assign(out, {unit, min, max, step});
    }
    return out;
  }

  // A scale 1 to 5, a symptom 0 (gone) to 5, a number in its range, a tag as true.
  function valid(it, value){
    if (it.kind === 'scale') return Number.isSafeInteger(value) && value >= 1 && value <= SCORES;
    if (it.kind === 'symptom') return Number.isSafeInteger(value) && value >= 0 && value <= SCORES;
    if (it.kind === 'number') return Number.isFinite(value) && value >= it.min && value <= it.max;
    return value === true;
  }

  function entry(raw, items){
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id)) fail('Invalid check-in id.');
    if (!Number.isSafeInteger(raw.at) || raw.at < 1 || raw.at > 8640000000000000) fail('Invalid check-in time.');
    if (typeof raw.day !== 'string' || !DATE.test(raw.day)) fail('Invalid check-in day.');
    if (!raw.values || typeof raw.values !== 'object' || Array.isArray(raw.values)) fail('Invalid check-in values.');
    const values = {};
    for (const [id, value] of Object.entries(raw.values)){
      const it = items.get(id);
      if (!it) fail('A check-in refers to an unknown item.');
      if (!valid(it, value)) fail('Invalid value for ' + it.name + '.');
      values[id] = value;
    }
    const note = text(raw.note, 1000, 'Note');
    if (!Object.keys(values).length && !note) fail('A check-in holds no values.');
    return {id:raw.id, at:raw.at, day:raw.day, values, note};
  }

  // Rebuilds state from known fields only, so stray fields never reach storage.
  function state(raw){
    if (!Array.isArray(raw.items) || !Array.isArray(raw.entries)) fail('Not a valid Check-in backup.');
    const items = new Map(), names = new Set();
    for (const row of raw.items){
      const it = item(row);
      if (items.has(it.id)) fail('Duplicate tracked item id.');
      const key = it.kind + ':' + it.name.toLowerCase();
      if (!it.archived && names.has(key)) fail('Two tracked items share the name ' + it.name + '.');
      if (!it.archived) names.add(key);
      items.set(it.id, it);
    }
    const ids = new Set();
    const entries = raw.entries.map(row => {
      const e = entry(row, items);
      if (ids.has(e.id)) fail('Duplicate check-in id.');
      ids.add(e.id);
      return e;
    }).sort((a, b) => a.at - b.at);
    return {settings:settings(raw.settings), items:[...items.values()], entries};
  }

  const LEVEL_WORDS = ['None', 'Mild', 'Moderate', 'High', 'Severe'];
  const DEFAULTS = [
    {id:'sleep-hours', kind:'scale', name:'Sleep hours', better:'high', unit:'h', options:['<4', '4-5', '5-6', '6-7', '>7']},
    {id:'sleep-quality', kind:'scale', name:'Sleep quality', better:'high', words:['Very poor', 'Poor', 'Okay', 'Good', 'Very good']},
    {id:'mood', kind:'scale', name:'Mood', better:'high', words:MOOD},
    {id:'soreness', kind:'scale', name:'Soreness', better:'low', words:LEVEL_WORDS},
    {id:'fatigue', kind:'scale', name:'Fatigue', better:'low', words:LEVEL_WORDS},
    {id:'headache', kind:'symptom', name:'Headache'}, {id:'anxiety', kind:'symptom', name:'Anxiety'},
    {id:'low-mood', kind:'symptom', name:'Low mood'}, {id:'nausea', kind:'symptom', name:'Nausea'}];
  const defaults = () => DEFAULTS.map(d => item({...d, pinned:true, archived:false}));
  /* Color tone 1 (worst, red) to 5 (best, green), whichever end the item calls
     good. Symptoms are worse when higher. Gone and unknown values get no tone. */
  function tone(it, value){
    if (!Number.isSafeInteger(value) || value < 1 || value > SCORES) return 0;
    if (it.kind === 'scale') return it.better === 'low' ? SCORES + 1 - value : value;
    if (it.kind === 'symptom') return SCORES + 1 - value;
    return 0;
  }

  /* Days: before the change time (04:00 by default) a check-in belongs to the previous day. */
  const pad = n => String(n).padStart(2, '0');
  const localDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const localTime = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  function dayFor(now, dayStart = '04:00'){
    const d = new Date(now);
    if (localTime(d) < dayStart) d.setDate(d.getDate() - 1);
    return localDate(d);
  }
  function shiftDate(date, days){ const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return localDate(d); }

  /* The merge window: taps within mergeMinutes of a check-in's start edit that
     check-in, so one sitting is one row without a Start or Save step. */
  function current(s, now){
    const last = s.entries.at(-1), windowMs = s.settings.mergeMinutes * 60000;
    if (!last || last.day !== dayFor(now, s.settings.dayStart)) return null;
    return now >= last.at && now - last.at < windowMs ? last : null;
  }
  // Sets or clears one value on the current check-in, starting one when needed.
  // A check-in left with no values and no note is removed. Returns the entry or null.
  function setValue(s, itemId, value, now, newId){
    const it = s.items.find(i => i.id === itemId);
    if (!it) fail('Unknown tracked item.');
    if (value != null && !valid(it, value)) fail('Invalid value for ' + it.name + '.');
    let e = current(s, now);
    if (!e){
      if (value == null) return null;
      if (s.entries.length >= LIMITS.entries) fail('The log holds the maximum of ' + LIMITS.entries + ' check-ins.');
      e = {id:newId(), at:now, day:dayFor(now, s.settings.dayStart), values:{}, note:''};
      s.entries.push(e);
    }
    if (value == null) delete e.values[itemId]; else e.values[itemId] = value;
    return prune(s, e);
  }
  function setNote(s, note, now, newId){
    const clean = text(note, 1000, 'Note');
    let e = current(s, now);
    if (!e){
      if (!clean) return null;
      e = {id:newId(), at:now, day:dayFor(now, s.settings.dayStart), values:{}, note:''};
      s.entries.push(e);
    }
    e.note = clean;
    return prune(s, e);
  }
  function prune(s, e){
    if (Object.keys(e.values).length || e.note) return e;
    s.entries.splice(s.entries.indexOf(e), 1);
    return null;
  }

  /* Ongoing symptoms: the latest record before the open check-in, within
     ONGOING_DAYS, is mild or worse. "since" is the first day of that run: it
     stops at a gone record or at a gap of ONGOING_DAYS days or more. Derived on
     every read, so no episode record can disagree with the check-ins. */
  function ongoing(s, now){
    const cur = current(s, now), from = shiftDate(dayFor(now, s.settings.dayStart), 1 - ONGOING_DAYS), out = [];
    for (const it of s.items){
      if (it.kind !== 'symptom' || it.archived) continue;
      let index = -1;
      for (let i = s.entries.length - 1; i >= 0; i--){
        const e = s.entries[i];
        if (e.day < from) break;
        if (e !== cur && it.id in e.values){ index = i; break; }
      }
      if (index < 0 || s.entries[index].values[it.id] < 1) continue;
      const last = s.entries[index];
      let since = last.day;
      for (let i = index - 1; i >= 0; i--){
        const e = s.entries[i];
        if (!(it.id in e.values)) continue;
        if (e.values[it.id] < 1 || e.day <= shiftDate(since, -ONGOING_DAYS)) break;
        since = e.day;
      }
      out.push({item:it, last:{value:last.values[it.id], at:last.at, day:last.day}, since, value:cur?.values[it.id]});
    }
    return out;
  }
  /* Symptom rows on Today: every symptom that is ongoing or recorded in the open
     check-in, in list order. A row's levels never remove it; only an explicit
     remove clears its value, so trying levels is safe. */
  function symptomRows(s, now){
    const values = current(s, now)?.values || {}, byId = new Map(ongoing(s, now).map(o => [o.item.id, o]));
    return s.items.filter(it => it.kind === 'symptom' && (byId.has(it.id) || it.id in values))
      .map(it => byId.get(it.id) || {item:it, last:null, since:null, value:values[it.id]});
  }

  /* Items. */
  // Items added from Today are unpinned: they show while recorded or ongoing.
  function addItem(s, {kind, name, pinned = true}, id){
    const clean = text(name, 60, 'Name');
    if (!clean) fail('Enter a name.');
    if (kind !== 'symptom') fail('Only symptoms can be added.');
    if (s.items.length >= LIMITS.items) fail('The list holds the maximum of ' + LIMITS.items + ' items.');
    const same = s.items.find(i => i.kind === kind && i.name.toLowerCase() === clean.toLowerCase());
    if (same && !same.archived) fail(clean + ' is already tracked.');
    if (same){ same.archived = false; same.pinned = pinned; same.name = clean; return same; }
    const it = {id, kind, name:clean, pinned, archived:false};
    s.items.push(it);
    return it;
  }
  function renameItem(s, itemId, name){
    const it = s.items.find(i => i.id === itemId), clean = text(name, 60, 'Name');
    if (!it) fail('Unknown tracked item.');
    if (!clean) fail('Enter a name.');
    if (s.items.some(i => i !== it && !i.archived && i.kind === it.kind && i.name.toLowerCase() === clean.toLowerCase())) fail(clean + ' is already tracked.');
    it.name = clean;
    return it;
  }
  function archiveItem(s, itemId, archived){
    const it = s.items.find(i => i.id === itemId);
    if (!it) fail('Unknown tracked item.');
    if (!archived && s.items.some(i => i !== it && !i.archived && i.kind === it.kind && i.name.toLowerCase() === it.name.toLowerCase())) fail(it.name + ' is already tracked.');
    it.archived = archived;
    return it;
  }
  const visible = (s, kind) => s.items.filter(i => i.kind === kind && i.pinned && !i.archived);
  const findActive = (s, kind, name) => s.items.find(i => i.kind === kind && !i.archived && i.name.toLowerCase() === String(name).trim().toLowerCase()) || null;

  /* Reading. */
  // The text on a scale button: its option, or the score itself.
  const option = (it, value) => it.options ? it.options[value - 1] : String(value);
  function label(it, value){
    if (it.kind === 'scale') return it.options ? option(it, value) + (it.unit ? ' ' + it.unit : '') : value + '/' + SCORES + (it.words ? ' ' + it.words[value - 1] : '');
    if (it.kind === 'symptom') return value === 0 ? 'gone' : value + '/' + SCORES;
    if (it.kind === 'number') return value + (it.unit ? ' ' + it.unit : '');
    return '';
  }
  // Scales first, then symptoms by severity, then the rest, each in list order.
  function parts(s, e){
    const rank = it => ({scale:0, symptom:1, number:2, tag:3})[it.kind];
    return s.items.filter(it => it.id in e.values)
      .sort((a, b) => rank(a) - rank(b) || (a.kind === 'symptom' ? e.values[b.id] - e.values[a.id] : 0) || s.items.indexOf(a) - s.items.indexOf(b))
      .map(it => ({item:it, value:e.values[it.id], text:(it.name + ' ' + label(it, e.values[it.id])).trim()}));
  }
  const describe = (s, e) => parts(s, e).map(p => p.text).join(', ');
  const entriesFor = (s, day) => s.entries.filter(e => e.day === day);
  function days(s){
    const seen = new Set(), out = [];
    for (let i = s.entries.length - 1; i >= 0; i--){ const d = s.entries[i].day; if (!seen.has(d)){ seen.add(d); out.push(d); } }
    return out.sort().reverse();
  }

  /* Today's state: the latest value of each item across a day's check-ins, as
     plain text to paste elsewhere. Items not recorded that day are left out. */
  function dayState(s, day){
    const latest = new Map(), notes = [];
    for (const e of entriesFor(s, day)){
      for (const [id, value] of Object.entries(e.values)) latest.set(id, value);
      if (e.note) notes.push(e.note);
    }
    const recorded = kind => s.items.filter(it => it.kind === kind && latest.has(it.id)).map(it => ({item:it, value:latest.get(it.id)}));
    const symptoms = recorded('symptom').sort((a, b) => b.value - a.value);
    return {day, scales:recorded('scale'), symptoms, notes};
  }
  function dayText(s, day){
    const st = dayState(s, day), lines = [day];
    for (const {item:it, value} of st.scales) lines.push(it.name + ': ' + label(it, value));
    if (st.symptoms.length) lines.push('Symptoms: ' + st.symptoms.map(({item:it, value}) => it.name + ' ' + label(it, value)).join(', '));
    for (const note of st.notes) lines.push('Note: ' + note.replace(/\s+/g, ' '));
    return lines.join('\n');
  }

  return {LIMITS, KINDS, SCORES, MOOD, tone, option, dayState, dayText, SEVERITY, LEVELS, ONGOING_DAYS, ongoing, findActive, settings, item, state, defaults, valid, dayFor, shiftDate, localDate, localTime,
    current, setValue, setNote, symptomRows, addItem, renameItem, archiveItem, visible, label, parts, describe, entriesFor, days};
})();
