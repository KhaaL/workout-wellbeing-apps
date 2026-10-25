/* Planned sessions on the Workout screen: a list sorted by date and order, a
   dialog to paste or load plans from a coaching chat, and a details view that
   shows a plan as its phase table. Choosing a plan only sets up the next ride. */
/* exported BikePlanUI */
const BikePlanUI = {
  mount(host, options) {
    const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null)); return node; };
    const clock = ms => { const s = Math.round(ms / 1000); return s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`; };
    const span = ms => ms < 60000 ? `${Math.round(ms / 1000)} s` : clock(ms);
    const dateLabel = day => new Date(day + 'T00:00:00').toLocaleDateString(undefined, {weekday:'short', day:'numeric', month:'short'});
    const sorted = () => options.get().slice().sort((a, b) => (a.scheduledFor || '9999').localeCompare(b.scheduledFor || '9999') || (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
    function summary(plan) {
      const phases = BikePlans.expand(plan.steps), efforts = phases.filter(p => p.kind === 'effort').length, last = options.lastRidden(plan.id);
      return [plan.scheduledFor && dateLabel(plan.scheduledFor), `${clock(BikePlans.minimumMs(phases))} minimum`, efforts && `${efforts} efforts`, last && `last ridden ${new Date(last).toLocaleDateString()}`].filter(Boolean).join(' · ');
    }
    // The coach's table: one row per phase, without the 5-second countdowns.
    function table(plan) {
      const rows = BikePlans.expand(plan.steps).filter(p => p.kind !== 'ready');
      const head = el('tr', {}, ...['Phase', 'Time', 'Resistance', 'Target and cue'].map(text => el('th', {scope:'col', textContent:text})));
      const body = rows.map(p => el('tr', {},
        el('td', {textContent:p.title}),
        el('td', {textContent:p.duration != null ? span(p.duration) : `HR ${p.gate === 'cool' ? 'below' : '≤'} ${p.gateBpm}, at least ${span(p.min)}`}),
        el('td', {textContent:p.res}),
        el('td', {textContent:[p.hr !== 'No target' && p.hr, p.rpm !== '—' && `${p.rpm} rpm`, p.cue, p.adjust && rule(p.adjust)].filter(Boolean).join(' · ')})));
      return el('div', {className:'plan-table'}, el('table', {}, el('thead', {}, head), el('tbody', {}, ...body)));
    }
    const rule = a => ['Next effort', a.cadenceAbove != null && `+${a.add} if cadence goes above ${a.cadenceAbove}`, a.cadenceBelow != null && `−${a.subtract} if it falls below ${a.cadenceBelow} before ${a.beforeSeconds} s`].filter(Boolean).join(' ');
    function preview(plan) {
      const phases = BikePlans.expand(plan.steps), parts = [el('h3', {textContent:plan.name}), el('p', {className:'small', textContent:summary(plan) + '. HR-gated phases run until HR is low enough.'})];
      if (plan.notes) parts.push(el('div', {className:'small', innerHTML:WorkoutMarkdown.render(plan.notes, {links:true})}));
      if (plan.conditions.length) parts.push(el('p', {className:'small', textContent:'Conditions: ' + plan.conditions.map(c => c.value ? `${c.label} ${c.value}` : c.label).join(', ') + '.'}));
      parts.push(table(plan));
      if (phases.some(p => p.adjust)) parts.push(el('p', {className:'small', textContent:'During each recovery the app asks for the resistance you used and how cadence went, then sets the next effort.'}));
      return el('div', {className:'plan-preview'}, ...parts);
    }
    function dialog(title) {
      const dlg = el('dialog', {className:'plan-dialog'}), heading = el('h2', {textContent:title});
      dlg.setAttribute('aria-label', title); dlg.append(heading); document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove(), {once:true});
      return dlg;
    }
    async function copyFormat(status) {
      try { await navigator.clipboard.writeText(BikePlans.FORMAT); status.textContent = 'Plan format copied. Paste it into the chat and ask for the plan in this format.'; }
      catch { status.textContent = 'Copying is blocked here. Select the format text below and copy it.'; }
    }
    function openAdd() {
      const dlg = dialog('Add planned sessions');
      const help = el('p', {className:'small', textContent:'Paste a plan in JSON from your coaching chat, or load a .json file. Check it, then save.'});
      const input = el('textarea', {id:'planInput', rows:8, spellcheck:false, placeholder:'{"name": "...", "steps": [...]}'});
      const file = el('input', {type:'file', accept:'.json,application/json'});
      const status = el('p', {className:'save-status', role:'status'}), result = el('div');
      const format = el('details', {}, el('summary', {textContent:'Plan format'}), el('pre', {className:'plan-format', textContent:BikePlans.FORMAT}));
      let parsed = null;
      const check = () => {
        parsed = null; result.replaceChildren(); save.disabled = true;
        try { parsed = BikePlans.parse(input.value); }
        catch (error) { status.textContent = error.message; return; }
        const clash = parsed.filter(p => options.get().some(row => row.id === p.id)).length;
        status.textContent = `${parsed.length} plan${parsed.length === 1 ? '' : 's'} ready to save.` + (clash ? ` ${clash} with an existing id will replace the saved one.` : '');
        result.append(...parsed.map(preview)); save.disabled = false;
      };
      const button = (text, cls, fn) => { const b = el('button', {type:'button', className:'btn ' + cls, textContent:text}); b.addEventListener('click', fn); return b; };
      const save = button('Save', 'btn-primary', () => {
        if (!parsed) return;
        const ids = new Set(parsed.map(p => p.id)), rows = [...options.get().filter(row => !ids.has(row.id)), ...parsed];
        if (rows.length > 50) { status.textContent = 'Keep at most 50 planned sessions. Delete old ones first.'; return; }
        if (!options.save(rows)) { status.textContent = 'Could not save. Your existing plans were kept.'; return; }
        dlg.close(); render(); options.notify(parsed.length === 1 ? `Saved ${parsed[0].name}.` : `Saved ${parsed.length} plans.`);
      });
      save.disabled = true;
      file.addEventListener('change', async () => { const chosen = file.files?.[0]; if (!chosen) return; input.value = await chosen.text(); file.value = ''; check(); });
      input.addEventListener('input', () => { parsed = null; save.disabled = true; });
      const actions = el('div', {className:'shared-actions'}, button('Check plan', '', check), save, button('Copy plan format', '', () => copyFormat(status)), button('Cancel', '', () => dlg.close()));
      dlg.append(help, el('label', {className:'field', textContent:'Plan JSON'}, input), el('label', {className:'field', textContent:'Or load a file'}, file), actions, status, result, format);
      dlg.showModal(); input.focus();
    }
    function openDetails(plan) {
      const dlg = dialog(plan.name), status = el('p', {className:'save-status', role:'status'});
      const name = el('input', {id:'planName', maxLength:80, value:plan.name}), date = el('input', {id:'planDate', type:'date', value:plan.scheduledFor || ''});
      const button = (text, cls, fn) => { const b = el('button', {type:'button', className:'btn ' + cls, textContent:text}); b.addEventListener('click', fn); return b; };
      const replace = updated => { if (!options.save(options.get().map(row => row.id === plan.id ? updated : row))) { status.textContent = 'Could not save. The plan was kept as it was.'; return false; } return true; };
      const actions = el('div', {className:'shared-actions'},
        button('Use for next ride', 'btn-primary', () => { dlg.close(); options.select(plan); }),
        button('Save name and date', '', () => {
          let updated; try { updated = BikePlans.normalize({...plan, name:name.value, scheduledFor:date.value || null}); } catch (error) { status.textContent = error.message; return; }
          if (replace(updated)) { dlg.close(); render(); options.notify('Plan updated.'); }
        }),
        button('Delete plan…', 'btn-danger', async () => {
          dlg.close();
          if (!await options.confirm(`Delete ${plan.name}?`, 'Rides already done with this plan keep their copy of it.', 'Delete', true)) return;
          if (!options.save(options.get().filter(row => row.id !== plan.id))) { options.notify('Could not delete the plan.'); return; }
          if (options.selected()?.id === plan.id) options.select(null);
          render(); options.notify('Plan deleted.');
        }),
        button('Close', '', () => dlg.close()));
      dlg.append(preview(plan), el('div', {className:'grid'}, el('label', {className:'field', textContent:'Name'}, name), el('label', {className:'field', textContent:'Date'}, date)), actions, status);
      dlg.showModal();
    }
    function render() {
      const plans = sorted(), current = options.selected();
      const add = el('button', {type:'button', className:'text-button', id:'addPlan', textContent:'Add'}); add.addEventListener('click', openAdd);
      const card = el('section', {className:'card', id:'plansCard'}, el('div', {className:'row'}, el('h2', {textContent:'Planned sessions'}), add));
      if (!plans.length) card.append(el('p', {className:'small', textContent:'Paste a plan from a coaching chat. Add → Copy plan format gives the chat the format to answer in.'}));
      const list = el('ul', {className:'plan-list'});
      for (const plan of plans) {
        const chosen = current?.id === plan.id && current.hash === plan.hash;
        const use = el('button', {type:'button', className:'btn' + (chosen ? ' btn-primary' : ''), textContent:chosen ? 'Selected' : 'Use'});
        use.setAttribute('aria-pressed', String(chosen)); use.setAttribute('aria-label', `${chosen ? 'Stop using' : 'Use'} ${plan.name}`);
        use.addEventListener('click', () => options.select(chosen ? null : plan));
        const info = el('button', {type:'button', className:'plan-info'}, el('strong', {textContent:plan.name}), el('span', {className:'small', textContent:summary(plan)}));
        info.setAttribute('aria-label', `Details for ${plan.name}`); info.addEventListener('click', () => openDetails(plan));
        list.append(el('li', {className:'plan-item' + (chosen ? ' is-selected' : '')}, info, use));
      }
      if (plans.length) card.append(list);
      host.replaceChildren(card);
    }
    render();
    return {render, preview, table};
  }
};
