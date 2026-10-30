/* Settings templates receive fresh state and helpers on every render. */
/* exported LiftlogSettings */
const LiftlogSettings = (() => {
  function templates(context){
    const {
      state,ui,IC,THEMES,REST_MIN,REST_MAX,LOAD_STEP_BOUNDS,WARMUP_PERCENT_BOUNDS,WARMUP_MAX_STEPS,esc,unitLabel,fmtNum,fmtDate,convertWeight,toLocalInput,
      cloudSummaryText,storageAttention,workoutHandoff,systemBarDiagnostics,historyExerciseIdentities,exerciseById,unresolvedHistoryExercises,
      historyImportSummaryHTML,shortcutTable
    }=context;
    function bodyweightSettingsHTML(){
      const entries = state.bodyweights || [];
      const latest = entries[0];
      return '<div class="setting-block">' +
        '<h3>Bodyweight</h3>' +
        '<p class="desc">Used with optional added load to calculate bodyweight-exercise volume and progression. Each workout uses the latest entry recorded on or before that date.</p>' +
        (latest ? '<p class="hint">Latest: ' + fmtNum(convertWeight(latest.weight, latest.unit, unitLabel())) + ' ' + unitLabel() +
          ' · ' + fmtDate(latest.loggedAt) + '</p>' : '<p class="hint">No bodyweight recorded yet.</p>') +
        '<form data-form="bodyweight-add" class="form-row mt-3">' +
          '<label class="field"><span class="cap">Date</span><input type="datetime-local" name="bodyweight-date" required value="' + toLocalInput(Date.now()) + '"></label>' +
          '<label class="field"><span class="cap">Bodyweight (' + unitLabel() + ')</span><input type="number" name="bodyweight-value" min="1" step="0.1" inputmode="decimal" required placeholder="0"></label>' +
          '<button type="submit" class="btn btn-primary">Add entry</button>' +
        '</form>' +
        (entries.length ? '<div class="bodyweight-list mt-3">' + entries.map(entry =>
          '<div class="bodyweight-row"><span>' + fmtDate(entry.loggedAt) + '</span><strong>' +
            fmtNum(convertWeight(entry.weight, entry.unit, unitLabel())) + ' ' + unitLabel() + '</strong>' +
            '<button type="button" class="btn btn-sm btn-danger" data-action="bodyweight-del" data-id="' + esc(entry.id) + '" aria-label="Delete bodyweight entry from ' + esc(fmtDate(entry.loggedAt)) + '">' + IC.trash + '<span class="sr-only">Delete</span></button></div>').join('') + '</div>' : '') +
      '</div>';
    }

    /* The steps are checked together (each heavier than the one before), so
       the block is a form with its own Save and status line. Add and Remove
       edit a draft that only Save commits. */
    function warmupSettingsHTML(){
      const steps = ui.warmupDraft || state.settings.warmupSteps;
      const row = (step, i) => '<div class="form-row warmup-step">' +
        '<label class="field"><span class="cap">Warm-up ' + (i + 1) + ' (% load)</span>' +
          '<input type="number" name="wu-percent" min="' + WARMUP_PERCENT_BOUNDS[0] + '" max="' + WARMUP_PERCENT_BOUNDS[1] + '" step="1" inputmode="numeric" required value="' + esc(String(step.percent)) + '"></label>' +
        '<label class="field"><span class="cap">Rest after (s)</span>' +
          '<input type="number" name="wu-rest" min="' + REST_MIN + '" max="' + REST_MAX + '" step="15" inputmode="numeric" required value="' + esc(String(step.rest)) + '"></label>' +
        (steps.length > 1 ? '<button type="button" class="btn btn-sm btn-quiet" data-action="warmup-step-remove" data-idx="' + i + '" aria-label="Remove warm-up ' + (i + 1) + '">' + IC.trash + '<span class="sr-only">Remove</span></button>' : '') +
      '</div>';
      return '<div class="setting-block">' +
        '<h3>Warm-up sets</h3>' +
        '<p class="desc">What the warm-up button on the current exercise adds before the first working set. Each warm-up uses the working set’s reps and a share of its load, rounded to the load step. After the last warm-up, sets rest for the normal time.</p>' +
        '<form data-form="warmup-save" id="warmup-form">' + steps.map(row).join('') +
          '<div class="form-actions">' +
            (steps.length < WARMUP_MAX_STEPS ? '<button type="button" class="btn btn-sm" data-action="warmup-step-add">' + IC.plus + '<span>Add warm-up</span></button>' : '') +
            '<button type="submit" class="btn btn-primary">Save warm-ups</button>' +
          '</div>' +
          '<p class="hint" id="warmup-status" role="status">' + esc(ui.warmupStatus || '') + '</p>' +
        '</form>' +
      '</div>';
    }

    /* options.open forces the state; options.defaultOpen applies until the
       person toggles the section; options.nested marks a section inside another. */
    function settingsDisclosure(id, title, summary, body, options = {}){
      const remembered = ui.settingsSections[id];
      const compact = window.matchMedia && window.matchMedia('(max-width:600px)').matches;
      const fallback = options.defaultOpen != null ? options.defaultOpen : id!=='storage'&&!compact;
      const open = options.open != null ? options.open : remembered == null ? fallback : remembered;
      return '<details class="settings-disclosure' + (options.nested ? ' is-nested' : '') + '" data-settings-section="' + esc(id) + '"' + (open ? ' open' : '') + '>' +
        '<summary><span class="settings-summary">' + esc(title) + '<small>' + esc(summary) + '</small></span></summary>' +
        body + '</details>';
    }

    function viewSettings(){
      const s = state.settings;
      return '<div class="view-head"><div><h1>Settings</h1><p class="view-sub">Preferences, data<span class="keyboard-only">, shortcuts</span></p></div></div>' +
      '<div id="storage-summary"></div>' +
      '<section class="panel" aria-label="Preferences">' +
        '<div class="setting-block">' +
          '<h3>Weight unit</h3><p class="desc">Planned weights and the active workout are converted; logged history keeps the unit it was logged in.</p>' +
          '<div class="radio-row" role="radiogroup" aria-label="Unit">' +
            ['kg','lb'].map(u =>
              '<label class="radio-pill"><input type="radio" name="unit" value="' + u + '" data-change="unit"' + (s.unit === u ? ' checked' : '') + '><span>' + u + '</span></label>').join('') +
          '</div>' +
        '</div>' +
        bodyweightSettingsHTML() +
        '<div class="setting-block">' +
          '<h3>Effort tracking</h3><p class="desc">Adds an optional column when logging sets: Rate of Perceived Exertion (1–10) ' +
            'or Reps In Reserve (how many more you could have done). Choose one, or turn it off.</p>' +
          '<div class="radio-row" role="radiogroup" aria-label="Effort metric">' +
            [['none','None'], ['rpe','RPE'], ['rir','RIR']].map(([v,label]) =>
              '<label class="radio-pill"><input type="radio" name="effort-metric" value="' + v + '" data-change="effort-metric"' + (s.effortMetric === v ? ' checked' : '') + '><span>' + label + '</span></label>').join('') +
          '</div>' +
        '</div>' +
        '<div class="setting-block">' +
          '<h3>Rest timer</h3>' +
          '<div class="form-row">' +
            '<label class="field rest-field"><span class="cap">Rest between sets (seconds)</span>' +
            '<input type="number" min="' + REST_MIN + '" max="' + REST_MAX + '" step="15" inputmode="numeric" ' +
            'data-change="default-rest" value="' + s.defaultRest + '"></label>' +
            '<label class="field rest-field"><span class="cap">Load increase step (' + unitLabel() + ')</span>' +
            '<input type="number" id="load-step" min="' + LOAD_STEP_BOUNDS[0] + '" max="' + LOAD_STEP_BOUNDS[1] + '" step="0.25" inputmode="decimal" ' +
            'data-change="load-step" value="' + s.loadStep + '">' +
            '<span class="hint">Added to the last load when a target is met</span></label>' +
          '</div>' +
          '<div class="switch-row">' +
            '<label for="sw-autorest"><strong>Auto-start after each set</strong><br><span class="hint">Starts the rest above the moment a set is logged</span></label>' +
            '<span class="switch"><input type="checkbox" id="sw-autorest" data-change="setting" data-field="autoRest"' + (s.autoRest ? ' checked' : '') + '><span class="track" aria-hidden="true"></span></span>' +
          '</div>' +
          '<div class="switch-row">' +
            '<label for="sw-sound"><strong>Sound when rest ends</strong><br><span class="hint">A rising four-tone alarm; completion is always announced to screen readers</span></label>' +
            '<span class="switch"><input type="checkbox" id="sw-sound" data-change="setting" data-field="sound"' + (s.sound ? ' checked' : '') + '><span class="track" aria-hidden="true"></span></span>' +
          '</div>' +
          '<div class="switch-row">' +
            '<label for="sw-vibrate"><strong>Vibrate when rest ends</strong><br><span class="hint">' +
              (navigator.vibrate ? 'Alongside the sound, for when you are not looking at the screen'
                                 : 'This browser cannot vibrate — iOS has no vibration API for web apps') + '</span></label>' +
            '<span class="switch"><input type="checkbox" id="sw-vibrate" data-change="setting" data-field="vibrate"' +
              (s.vibrate ? ' checked' : '') + (navigator.vibrate ? '' : ' disabled') + '><span class="track" aria-hidden="true"></span></span>' +
          '</div>' +
        '</div>' +
        warmupSettingsHTML() +
        '<div class="setting-block">' +
          '<h3>Appearance</h3><p class="desc">Theme follows your system by default. Color themes apply instantly and are remembered on this device.</p>' +
          '<label class="field theme-field"><span class="cap">Theme</span><select id="themeChoice" data-change="theme">' +
            THEMES.map(t => '<option value="' + t.id + '"' + (s.theme === t.id ? ' selected' : '') + '>' + t.label + '</option>').join('') +
          '</select></label>' +
        '</div>' +
      '</section>' +
      '<section class="panel mt-4" aria-label="Data">' +
        /* The shared Backups & cloud storage panel mounts here after render.
           It opens by itself when a recovery copy needs attention. */
        settingsDisclosure('storage', 'Backups & cloud storage', cloudSummaryText(), '<div id="storage-panel" class="setting-block"></div>',
          {defaultOpen:storageAttention()}) +
        settingsDisclosure('transfer', 'Transfer routines & history', 'Import or export either data set',
        '<div class="setting-block">' +
          '<div class="block-head">' +
            '<h3>Transfer routines &amp; history</h3>' +
            '<button type="button" class="icon-btn" data-action="schema-open" ' +
              'aria-label="File format and sample files" title="File format and sample files">' + IC.help + '</button>' +
          '</div>' +
          '<p class="desc">Imports merge into this browser. Routine imports add missing exercises. History reports new workouts, existing copies, invalid entries and ID conflicts separately; local workouts win conflicts.</p>' +
          '<div class="transfer-grid">' +
            '<div class="transfer-group" role="group" aria-labelledby="transfer-routines-title">' +
              '<h4 id="transfer-routines-title">Routines</h4>' +
              '<div class="transfer-actions">' +
                '<button type="button" class="btn" data-action="export-routines" aria-label="Export routines">' + IC.down + '<span>Export</span></button>' +
                '<label class="file-btn"><span>' + IC.up + ' Import</span><input type="file" accept=".json,application/json" data-change="import-routines" aria-label="Import routines from a JSON file"></label>' +
              '</div>' +
            '</div>' +
            '<div class="transfer-group" role="group" aria-labelledby="transfer-history-title">' +
              '<h4 id="transfer-history-title">Workout history</h4>' +
              '<div class="transfer-actions">' +
                '<button type="button" class="btn" data-action="export-history" aria-label="Export workout history">' + IC.down + '<span>Export</span></button>' +
                '<label class="file-btn"><span>' + IC.up + ' Import</span><input type="file" accept=".json,application/json" data-change="import-history" aria-label="Import workout history from a JSON file"></label>' +
              '</div>' +
              (historyExerciseIdentities().some(x => !exerciseById(x.id))
                ? '<button type="button" class="btn btn-sm mt-2" data-action="history-links-open">Review progression series' +
                    (unresolvedHistoryExercises().length ? ' (' + unresolvedHistoryExercises().length + ')' : '') + '</button>'
                : '') +
            '</div>' +
          '</div>' +
          historyImportSummaryHTML() +
        '</div>') +
        settingsDisclosure('handoff', 'Move workout to another device', 'Continue a paused workout elsewhere',
          '<div id="handoff-tools" class="setting-block handoff-tools"></div>',
          {defaultOpen:!!state.activeWorkout || !!workoutHandoff.held()}) +
        settingsDisclosure('app-updates', 'App updates', 'Loaded version and safe update controls',
          '<div id="app-update-controls"></div><div class="setting-block">' + systemBarDiagnostics() + '</div>') +
        settingsDisclosure('danger', 'Advanced & destructive actions', 'Clear workout history',
        '<div class="setting-block">' +
          '<h3 class="danger-heading">Workout data</h3>' +
          '<p class="desc">Removes finished workouts after saving a recovery copy. Bodyweight entries, exercises, routines and settings are kept. Finish or discard any saved workout first; cloud uploads stay paused for review.</p>' +
          '<button type="button" class="btn btn-danger" data-action="clear-workouts">' + IC.trash + '<span>Clear workout data…</span></button>' +
        '</div>') +
      '</section>' +
      '<section class="panel mt-4 keyboard-only" aria-label="Keyboard shortcuts">' +
        '<div class="setting-block">' +
          '<h3>Keyboard shortcuts</h3><p class="desc">Disabled while typing in a field.</p>' +
          shortcutTable() +
        '</div>' +
      '</section>';
    }
    return {viewSettings};
  }
  return {render:context=>templates(context).viewSettings()};
})();
