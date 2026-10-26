/* Settings templates receive fresh state and helpers on every render. */
/* exported LiftlogSettings */
const LiftlogSettings = (() => {
  function templates(context){
    const {
      state,ui,IC,THEMES,REST_MIN,
      REST_MAX,LOAD_STEP_BOUNDS,REMOTE_OBJECT_KEY_DEFAULT,storageState,storageIsBrave,
      storageEstimate,esc,installedAsApp,fmtBytes,storageSize,
      rescuedDataRaw,remoteRestoreRescueInfo,unitLabel,fmtNum,fmtDate,
      convertWeight,toLocalInput,loadRemoteConfig,remoteCryptoAvailable,remoteSyncPaused,
      cloudSummaryText,workoutHandoff,remoteEngine,remoteDraftFromConfig,lastBackupInfo,backupIsStale,
      sinceLabel,systemBarDiagnostics,historyExerciseIdentities,exerciseById,unresolvedHistoryExercises,
      historyImportSummaryHTML,shortcutTable
    }=context;
    function deviceStorageHTML(){
      /* One line per state, and a button only where pressing it can change the
         answer. Download backup sits in Backup & restore just above. */
      const installed = installedAsApp();
      const ios = ' iOS also clears it after about 7 days without a visit.';
      let line, cls = 'warning-text', btn = '';
      if (storageState === 'persistent'){
        line = 'Persistent: this browser will not clear Liftlog’s data to free space.'; cls = 'hint';
      } else if (storageState === 'declined'){
        line = (storageIsBrave ? 'Brave does not grant persistent storage' : 'This browser refused persistent storage') +
          ', so it may clear Liftlog’s data when space runs low or site data is cleared.' + ios +
          (installed ? ' The installed app is the most durable option here.' : ' Installing Liftlog to the home screen helps.') +
          ' Keep an off-device backup.';
      } else if (storageState === 'best-effort'){
        line = 'Best-effort: this browser may clear Liftlog’s data when space runs low.' + ios +
          ' Persistent storage or installing Liftlog to the home screen prevents this.';
        btn = '<div class="form-actions"><button type="button" class="btn" data-action="request-persist">Request persistent storage</button></div>';
      } else if (storageState === 'unavailable'){
        line = 'This page is not a secure context (file:// or http://), so the browser cannot say whether it may clear Liftlog’s data. Keep an off-device backup.';
      } else {
        line = 'Checking whether this browser may clear Liftlog’s data…'; cls = 'hint';
      }
      // The site-wide estimate includes caches, so it only appears when the quota is nearly used.
      const full = storageEstimate && storageEstimate.quota && storageEstimate.usage / storageEstimate.quota >= 0.8
        ? ' This site has used ' + Math.round(100 * storageEstimate.usage / storageEstimate.quota) + '% of its storage quota.' : '';
      return '<div class="setting-block">' +
        '<h3>Device storage</h3>' +
        '<p class="desc">Liftlog’s data takes ' + storageSize() + ' in this browser.' + full + '</p>' +
        '<p class="' + cls + '">' + line + '</p>' + btn +
      '</div>';
    }

    function rescuedDataHTML(){
      const raw = rescuedDataRaw();
      if (raw == null) return '';
      return '<div class="setting-block" role="status">' +
        '<h3 class="danger-heading">Recovered unreadable data</h3>' +
        '<p class="desc">Liftlog preserved ' + fmtBytes(new Blob([raw]).size) +
          ' that it could not load. Download the untouched copy before discarding it.</p>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn" data-action="rescue-download">' + IC.down + '<span>Download rescued data</span></button>' +
          '<button type="button" class="btn btn-danger" data-action="rescue-discard">Discard rescued data…</button>' +
        '</div></div>';
    }

    function remoteRestoreRescueHTML(){
      const copy = remoteRestoreRescueInfo();
      if (!copy) return '';
      const held = copy.workouts == null ? '' : ' It holds ' + copy.workouts + ' finished workout' + (copy.workouts === 1 ? '' : 's') + '.';
      return '<div class="setting-block" role="status">' +
        '<h3>Previous local copy</h3>' +
        '<p class="desc">Saved automatically' + (copy.at ? ' on ' + esc(new Date(copy.at).toLocaleString()) : '') +
          ', just before a restore, workout clear or received handoff replaced this device’s data.' + held +
          ' The next replacement overwrites this copy.</p>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn" data-action="remote-rescue-download">' + IC.down + '<span>Download</span></button>' +
          '<button type="button" class="btn" data-action="remote-rescue-restore">Restore this copy…</button>' +
          '<button type="button" class="btn btn-danger" data-action="remote-rescue-discard">Discard</button>' +
        '</div></div>';
    }

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

    function remoteStorageHTML(){
      const cfg = loadRemoteConfig(),separate = remoteEngine.syncMode(cfg) === 'immutable';
      if (!remoteCryptoAvailable())
        return '<div class="setting-block"><p class="error-text">Cloud backup needs the Web Crypto API, only available in a secure context (https:// or localhost). It is unavailable here.</p></div>';
      const busy = ui.remoteBusy ? ' disabled' : '', CLOUD_ICONS = {backup:IC.up, restore:IC.down};
      const paused = remoteSyncPaused();
      let html = '<div class="setting-block">';
      if (!cfg){
        html += '<p class="desc">Back up automatically to S3-compatible storage you control. Requests go straight from this browser to your storage; Liftlog has no server. One connection serves every app on this site.</p>';
      } else {
        html += '<p class="desc"><strong>' + esc(cfg.bucket) + '</strong> · ' + (separate
          ? 'Separate backup files. Every backup is a new file; other devices change only when you restore one there.'
          : 'Conditional sync. One shared file; sync can replace this device’s data with a newer cloud copy.') + '</p>' +
          '<div class="form-actions">' +
          /* Shared with every app: separate mode resumes with one upload and
             restores through the earlier-backups list below. */
          WorkoutStorage.cloudActions(separate ? 'immutable' : 'conditional', paused).map(item =>
            '<button type="button" class="btn' + (item.primary ? ' btn-primary' : '') + '" data-action="remote-' + item.id + '"' + (item.id === 'pause' ? '' : busy) + '>' +
              (CLOUD_ICONS[item.id] ? CLOUD_ICONS[item.id] + '<span>' + item.label + '</span>' : item.label) + '</button>').join('') +
          '</div>' +
          '<div id="remote-snapshots" class="remote-tools mt-3"></div>';
      }
      html += '</div>';
      /* Populated once from the saved config (or blank); after that every
         keystroke writes straight into this object (see the "remote" binder)
         so the fields survive a re-render triggered by anything else on this
         page — they don't reset to the last-saved value until a real save. */
      if (!ui.remoteDraft) ui.remoteDraft = remoteDraftFromConfig(cfg);
      const d = ui.remoteDraft, scope = WorkoutStorage.describeConnection(remoteEngine);
      const form = '<div class="setting-block"><p class="hint" id="connection-scope">' + esc(scope.text) + '</p>' +
          (scope.canSwitch ? '<div class="form-actions mt-2"><button type="button" class="btn" data-action="remote-use-shared">Use the shared connection…</button></div>' : '') +
          '<form data-form="remote-config" class="mt-2">' +
          '<label class="field"><span class="cap">Backup mode</span><select data-bind="remote" data-field="syncMode">' +
            [['immutable','Separate backup files (recommended)'],['conditional','Conditional sync (one shared file)']].map(([value,label])=>'<option value="'+value+'"'+(d.syncMode===value?' selected':'')+'>'+label+'</option>').join('') + '</select></label>' +
          '<p class="hint mt-1">Separate files never replace another device’s data. Conditional sync needs a provider that enforces overwrite protection.</p>' +
          '<div class="form-row mt-2">' +
            '<label class="field flex-2"><span class="cap">Endpoint URL</span><input type="url" data-bind="remote" data-field="endpoint" required placeholder="https://storage.example.com" value="' + esc(d.endpoint) + '"></label>' +
            '<label class="field"><span class="cap">Region</span><input type="text" data-bind="remote" data-field="region" required placeholder="us-east-1" value="' + esc(d.region) + '"></label>' +
            '<label class="field"><span class="cap">Bucket</span><input type="text" data-bind="remote" data-field="bucket" required value="' + esc(d.bucket) + '"></label>' +
          '</div>' +
          '<p class="hint mt-1">HTTPS address with no path or query. Plain HTTP works only from a local file or localhost.</p>' +
          '<div class="form-row mt-2">' +
            '<label class="field flex-2"><span class="cap">Backup path · this app</span><input type="text" data-bind="remote" data-field="objectKey" placeholder="' + REMOTE_OBJECT_KEY_DEFAULT + '" value="' + esc(d.objectKey) + '"></label>' +
            '<label class="field"><span class="cap">Access key ID</span><input type="text" data-bind="remote" data-field="accessKeyId" required value="' + esc(d.accessKeyId) + '"></label>' +
            '<label class="field"><span class="cap">Secret access key</span><input type="password" data-bind="remote" data-field="secretAccessKey" placeholder="' + (cfg ? '•••••••• (leave blank to keep)' : '') + '" value="' + esc(d.secretAccessKey) + '"' + (!cfg ? ' required' : '') + '></label>' +
          '</div>' +
          '<p class="hint mt-1">Keys are stored unencrypted in this browser and shared by every app on this site. Use a key limited to this bucket.</p>' +
          '<div class="switch-row mt-2">' +
            '<label for="sw-pathstyle"><strong>Path-style addressing</strong><br><span class="hint">Some S3-compatible services require it. Check your provider’s documentation.</span></label>' +
            '<span class="switch"><input type="checkbox" id="sw-pathstyle" data-change="remote-pathstyle"' + (d.pathStyle ? ' checked' : '') + '><span class="track" aria-hidden="true"></span></span>' +
          '</div>' +
          (ui.remoteError ? '<p class="error-text mt-2" role="alert">' + esc(ui.remoteError) + '</p>' : '') +
          '<div class="form-actions mt-3">' +
            '<button type="submit" class="btn btn-primary"' + busy + '>' + (ui.remoteBusy ? 'Testing connection…' : 'Check &amp; save connection') + '</button>' +
            '<label class="file-btn"><span>' + IC.up + ' Load config file</span><input type="file" accept=".json,application/json" data-change="load-remote-config" aria-label="Load cloud backup connection from a JSON file"></label>' +
            /* the counterpart to Load, so setting up a second device does not mean retyping the form */
            (cfg ? '<button type="button" class="btn" data-action="remote-export-config">' + IC.down + '<span>Save config file</span></button>' : '') +
          '</div>' +
          '<p class="hint mt-2">' + (cfg
            ? 'A config file sets up another device without retyping, with or without the secret key.'
            : 'Have a config file from another device? <strong>Load config file</strong> fills this form.') + '</p>' +
        '</form>' +
        (cfg ? '<div class="form-actions mt-3">' +
          '<button type="button" class="btn" data-action="remote-test"' + busy + '>Test read access</button>' +
          '<button type="button" class="btn btn-danger" data-action="remote-forget">Forget connection…</button>' +
        '</div>' : '') +
      '</div>';
      html += settingsDisclosure('cloud-connection', 'Connection', cfg ? 'Endpoint, bucket, keys and config file' : 'Required before the first backup', form,
        {open:!cfg || ui.remoteFormOpen, nested:true});
      if (cfg) html += settingsDisclosure('cloud-troubleshooting', 'Troubleshooting',
        remoteEngine.diagnosticsPayload().lastError ? 'Last connection failed; details inside' : 'Provider check and diagnostics',
        '<div id="remote-troubleshooting" class="setting-block remote-tools"></div>', {defaultOpen:false, nested:true});
      return html;
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
      const storage = storageSize();
      const backup = lastBackupInfo();
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
        '<div class="setting-block">' +
          '<h3>Appearance</h3><p class="desc">Theme follows your system by default. Color themes apply instantly and are remembered on this device.</p>' +
          '<label class="field theme-field"><span class="cap">Theme</span><select id="themeChoice" data-change="theme">' +
            THEMES.map(t => '<option value="' + t.id + '"' + (s.theme === t.id ? ' selected' : '') + '>' + t.label + '</option>').join('') +
          '</select></label>' +
        '</div>' +
      '</section>' +
      '<section class="panel mt-4" aria-label="Data">' +
        /* Whole-state backup first, in both the places it can be written — a file
           here, the same file in a bucket below — then the partial transfer files,
           which are a different job and not a second way to do this one. */
        rescuedDataHTML() +
        remoteRestoreRescueHTML() +
        '<div class="setting-block">' +
          '<h3>Backup &amp; restore</h3>' +
          '<p class="desc">Everything in one file: exercises, routines, history and preferences. ' +
            'Restoring replaces what is in this browser (' + storage + ')' +
            (loadRemoteConfig() ? '' : '. Nothing leaves this device unless you set up cloud backup below') + '.</p>' +
          '<p class="' + (backupIsStale() ? 'error-text' : 'hint') + '">Last backup: ' + sinceLabel(backup.at) +
            (backup.where ? ', to ' + (backup.where === 'remote storage' ? 'the cloud' : backup.where) : '') + '.</p>' +
          '<div class="form-actions mt-2">' +
            '<button type="button" class="btn" data-action="export">' + IC.down + '<span>Download full backup</span></button>' +
            '<label class="file-btn"><span>' + IC.up + ' Restore from file</span><input type="file" accept=".json,application/json" data-change="import-all" aria-label="Restore from a backup file"></label>' +
          '</div>' +
        '</div>' +
        deviceStorageHTML() +
        settingsDisclosure('storage', 'Cloud backup', cloudSummaryText(), remoteStorageHTML()) +
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
    return {viewSettings,remoteStorageHTML};
  }
  return {render:context=>templates(context).viewSettings(),remoteStorage:context=>templates(context).remoteStorageHTML()};
})();
