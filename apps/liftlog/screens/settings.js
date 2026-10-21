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
      remoteStatusDetail,remoteEngine,remoteDraftFromConfig,lastBackupInfo,backupIsStale,
      sinceLabel,systemBarDiagnostics,historyExerciseIdentities,exerciseById,unresolvedHistoryExercises,
      historyImportSummaryHTML,shortcutTable
    }=context;
    function storageHTML(){
      /* One line per state, and a button only where pressing it can change the
         answer. Where it cannot, the way out is a backup — so that is the button. */
      const installed = installedAsApp();
      const backupBtn = '<div class="form-actions"><button type="button" class="btn" data-action="export">' +
        IC.down + '<span>Download backup</span></button></div>';
      let line, cls = 'hint', btn = '';
      if (storageState === 'persistent'){
        line = 'Persistent — this browser has agreed not to clear Liftlog’s data to reclaim space.';
      } else if (storageState === 'declined'){
        line = (storageIsBrave ? 'Brave does not grant persistent storage' : 'This browser has refused persistent storage') +
          ', so asking again cannot help. The data is saved here and stays put in normal use, but the browser is free to clear it when space runs low, when you clear site data, and on iOS after about a week without a visit.' +
          (installed ? ' Liftlog is running as an installed app here, which is the most durable this browser offers.'
                     : ' Installing Liftlog to the home screen is the one thing that still improves on that.') +
          ' Either way, keep an off-device backup — that is the only real guarantee.';
        cls = 'error-text';
        btn = backupBtn;
      } else if (storageState === 'best-effort'){
        line = 'Best-effort — this browser may clear the data when space runs low, and iOS clears it after about a week without a visit. Granting persistence, or installing Liftlog to the home screen, prevents that.';
        cls = 'error-text';
        btn = '<div class="form-actions"><button type="button" class="btn" data-action="request-persist">Request persistent storage</button></div>';
      } else if (storageState === 'unavailable'){
        line = 'This browser will not say whether it may evict the data: the API that reports it needs a secure context, and this page is not one (it is open over file:// or plain http://). Treat the data as evictable and keep a backup.';
        cls = 'error-text';
        btn = backupBtn;
      } else {
        line = 'Checking whether this browser may evict the data…';
      }
      const est = storageEstimate
        ? ' This site is using ' + fmtBytes(storageEstimate.usage) + ' of roughly ' + fmtBytes(storageEstimate.quota) + ' available to it.'
        : '';
      return '<div class="setting-block">' +
        '<h3>Storage</h3>' +
        '<p class="desc">Liftlog’s data takes ' + storageSize() + ' in this browser.' + est + '</p>' +
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
      const cfg = loadRemoteConfig(),separate=remoteEngine.syncMode(cfg)==='immutable';
      const cryptoOk = remoteCryptoAvailable();
      let html = '<div class="setting-block">' +
        '<h3>Remote storage <span class="hint">(optional, S3-compatible)</span></h3>' +
        '<p class="desc">Changes upload automatically. Separate backup mode keeps every upload in a new file and requires explicit restores between devices. Conditional sync can adopt a newer cloud copy and requires enforced overwrite protection. Local restores pause sync until you choose which copy to keep. ' +
        'Active workouts and edits during remote checks defer replacement. Requests go straight from this device to your storage provider using your own credentials — ' +
        'this app has no server to relay them through. Credentials are stored in this browser’s local storage in plain text.</p>';
      if (!cryptoOk){
        html += '<p class="error-text">Remote storage needs the Web Crypto API, only available in a secure context (https:// or localhost). It is unavailable here.</p></div>';
        return html;
      }
      const paused = remoteSyncPaused();
      html += '<p id="remote-status" class="desc" role="status">Status: ' + (cfg ? 'Configured — <strong>' + esc(cfg.bucket) + '</strong>' : 'Not configured') +
        esc(remoteStatusDetail(cfg)) + '</p>';
      if (cfg){
        html += '<div class="form-actions">' +
          '<button type="button" class="btn" data-action="remote-test"' + (ui.remoteBusy ? ' disabled' : '') + '>Test connection</button>' +
          /* In separate mode both resume paths upload a new file, so one button. */
          (paused
            ? '<button type="button" class="btn btn-primary" data-action="remote-publish-local"' + (ui.remoteBusy ? ' disabled' : '') + '>' + (separate ? 'Back up & resume…' : 'Keep local copy & update cloud…') + '</button>' +
              (separate ? '' : '<button type="button" class="btn" data-action="remote-resume"' + (ui.remoteBusy ? ' disabled' : '') + '>Resume automatic sync…</button>')
            : '<button type="button" class="btn btn-primary" data-action="remote-backup"' + (ui.remoteBusy ? ' disabled' : '') + '>' + IC.up + '<span>' + (separate ? 'Back up now' : 'Sync now') + '</span></button>' +
              '<button type="button" class="btn" data-action="remote-pause">' + (separate ? 'Pause cloud backups' : 'Pause cloud sync') + '</button>') +
          '<button type="button" class="btn" data-action="remote-restore"' + (ui.remoteBusy ? ' disabled' : '') + '>' + IC.down + '<span>'+(remoteEngine.syncMode(cfg)==='immutable'?'Restore legacy backup locally…':'Use cloud copy…')+'</span></button>' +
          '<button type="button" class="btn" data-action="remote-form-toggle">' + (ui.remoteFormOpen ? 'Hide configuration' : 'Edit configuration') + '</button>' +
          '<button type="button" class="btn btn-danger" data-action="remote-forget">Forget configuration</button>' +
        '</div>' + (separate ? '<p class="hint">Each upload saves a separate backup file. Other devices keep their local data until you restore a chosen backup. ' + (paused ? 'Nothing uploads until you choose Back up & resume.' : 'Browse cloud snapshots to restore an earlier backup.') + '</p>' : paused ? '<p class="hint">Local edits stay on this device. Choose which copy to keep before resuming. Pause survives reloads and configuration changes.</p>' : '<p class="hint">Sync now reconciles both copies; a newer cloud copy can replace local data. Pause cloud sync before recovery.</p>');
      }
      if (!cfg || ui.remoteFormOpen){
        /* Populated once from the saved config (or blank); after that every
           keystroke writes straight into this object (see the "remote" binder)
           so the fields survive a re-render triggered by anything else on this
           page — they don't reset to the last-saved value until a real save. */
        if (!ui.remoteDraft) ui.remoteDraft = remoteDraftFromConfig(cfg);
        const d = ui.remoteDraft;
        html += '<form data-form="remote-config" class="mt-3">' +
          '<label class="field"><span class="cap">Backup mode</span><select data-bind="remote" data-field="syncMode">'+[['auto','Automatic (separate backup files)'],['immutable','Separate backup files — explicit restore'],['conditional','Conditional sync — overwrite protection required']].map(([value,label])=>'<option value="'+value+'"'+(d.syncMode===value?' selected':'')+'>'+label+'</option>').join('')+'</select></label>' +
          '<div class="form-row">' +
            '<label class="field flex-2"><span class="cap">Endpoint URL</span><input type="url" data-bind="remote" data-field="endpoint" required placeholder="https://s3.us-east-1.amazonaws.com" value="' + esc(d.endpoint) + '"></label>' +
            '<label class="field"><span class="cap">Region</span><input type="text" data-bind="remote" data-field="region" required placeholder="us-east-1" value="' + esc(d.region) + '"></label>' +
            '<label class="field"><span class="cap">Bucket</span><input type="text" data-bind="remote" data-field="bucket" required value="' + esc(d.bucket) + '"></label>' +
          '</div>' +
          '<p class="hint mt-1">Use an HTTPS endpoint without credentials, paths, query strings or fragments. HTTP is only allowed when Liftlog runs from a local file or localhost.</p>' +
          '<div class="form-row mt-2">' +
            '<label class="field flex-2"><span class="cap">Object key / path</span><input type="text" data-bind="remote" data-field="objectKey" placeholder="' + REMOTE_OBJECT_KEY_DEFAULT + '" value="' + esc(d.objectKey) + '"></label>' +
            '<label class="field"><span class="cap">Access key ID</span><input type="text" data-bind="remote" data-field="accessKeyId" required value="' + esc(d.accessKeyId) + '"></label>' +
            '<label class="field"><span class="cap">Secret access key</span><input type="password" data-bind="remote" data-field="secretAccessKey" placeholder="' + (cfg ? '•••••••• (leave blank to keep)' : '') + '" value="' + esc(d.secretAccessKey) + '"' + (!cfg ? ' required' : '') + '></label>' +
          '</div>' +
          '<div class="switch-row mt-2">' +
            '<label for="sw-pathstyle"><strong>Path-style addressing</strong><br><span class="hint">Turn on for MinIO and R2 (R2 region: auto); consult provider guidance for other endpoints</span></label>' +
            '<span class="switch"><input type="checkbox" id="sw-pathstyle" data-change="remote-pathstyle"' + (d.pathStyle ? ' checked' : '') + '><span class="track" aria-hidden="true"></span></span>' +
          '</div>' +
          (ui.remoteError ? '<p class="error-text mt-2" role="alert">' + esc(ui.remoteError) + '</p>' : '') +
          '<div class="form-actions mt-3">' +
            '<button type="submit" class="btn btn-primary"' + (ui.remoteBusy ? ' disabled' : '') + '>' + (ui.remoteBusy ? 'Testing connection…' : 'Save configuration') + '</button>' +
            '<label class="file-btn"><span>' + IC.up + ' Load config file</span><input type="file" accept=".json,application/json" data-change="load-remote-config" aria-label="Load remote storage configuration from a JSON file"></label>' +
            /* the counterpart to Load, so setting up a second device does not mean retyping the form */
            (cfg ? '<button type="button" class="btn" data-action="remote-export-config">' + IC.down + '<span>Save config file</span></button>' : '') +
          '</div>' +
          '<p class="hint mt-2">' + (cfg
            ? 'A config file sets up another device without retyping this form, and can be written with or without the secret key.'
            : 'Have a config file from another device? <strong>Load config file</strong> fills this form from it.') + '</p>' +
        '</form>';
      }
      html += (cfg?'<div id="remote-tools" class="setting-block"></div>':'')+'</div>';
      return html;
    }

    function settingsDisclosure(id, title, summary, body){
      const remembered = ui.settingsSections[id];
      const compact = window.matchMedia && window.matchMedia('(max-width:600px)').matches;
      const open = remembered == null ? id!=='storage'&&!compact : remembered;
      return '<details class="settings-disclosure" data-settings-section="' + esc(id) + '"' + (open ? ' open' : '') + '>' +
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
          '<h3>Appearance</h3><p class="desc">Theme follows your system by default. Color themes apply instantly and are remembered on this device.</p>' +
          '<div class="radio-row" role="radiogroup" aria-label="Theme">' +
            THEMES.map(t =>
              '<label class="radio-pill"><input type="radio" name="theme" value="' + t.id + '" data-change="theme"' + (s.theme === t.id ? ' checked' : '') + '><span>' + t.label + '</span></label>').join('') +
          '</div>' +
          systemBarDiagnostics() +
        '</div>' +
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
            (loadRemoteConfig() ? '' : '. Nothing leaves this device unless you configure remote storage below') + '.</p>' +
          '<p class="' + (backupIsStale() ? 'error-text' : 'hint') + '">Last full backup: ' + sinceLabel(backup.at) +
            (backup.where ? ' (to ' + backup.where + ')' : '') + '.</p>' +
          '<div class="form-actions mt-2">' +
            '<button type="button" class="btn" data-action="export">' + IC.down + '<span>Download backup</span></button>' +
            '<label class="file-btn"><span>' + IC.up + ' Restore from file</span><input type="file" accept=".json,application/json" data-change="import-all" aria-label="Restore from a backup file"></label>' +
          '</div>' +
        '</div>' +
        settingsDisclosure('storage', 'Cloud backup & device storage',
          loadRemoteConfig() ? 'Automatic S3 backup is configured' : 'Storage durability and optional automatic S3 backup',
          storageHTML() + remoteStorageHTML()) +
        '<div id="handoff-tools" class="setting-block handoff-tools"></div>' +
    settingsDisclosure('app-updates','App updates','Loaded version and safe update controls','<div id="app-update-controls"></div>')+
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
