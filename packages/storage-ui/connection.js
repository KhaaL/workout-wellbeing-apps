/* Wording for the site-wide cloud connection, used by every app's Settings.
   One connection serves all apps on the site; each app keeps its backup path. */
WorkoutStorage.describeConnection = function(remote) {
  const scope = remote.connectionScope(), shared = remote.sharedConnection(), cfg = remote.loadRemoteConfig();
  const where = c => { let host = c.endpoint; try { host = new URL(c.endpoint).host; } catch(e) {} return c.bucket + ' on ' + host; };
  const path = cfg?.objectKey || remote.defaultObjectKey;
  if (scope === 'shared') return {scope, canSwitch:false,
    text:'Shared connection: ' + where(shared) + '. Every app on this site uses it, so saving it here changes it for all of them. This app backs up to ' + path + '.'};
  if (scope === 'own') return {scope, canSwitch:!!shared,
    text:'This app still uses its own connection, saved before connections were shared: ' + where(cfg) + '.' + (shared ? ' The other apps use ' + where(shared) + '.' : '')};
  return {scope, canSwitch:false, text:'No connection yet. The connection you save here is shared by every app on this site; each app backs up to its own path.'};
};
WorkoutStorage.forgetConnectionText = function(remote) {
  return remote.connectionScope() === 'own'
    ? {title:'Forget this app’s own connection?', body:'This app then uses the shared connection' + (remote.sharedConnection() ? '' : ' once one is saved') + '. Nothing in your bucket is deleted.'}
    : {title:'Forget the shared connection?', body:'This removes the endpoint and keys from this browser for every app on this site, so cloud backups stop until a connection is saved again. Nothing in your bucket is deleted.'};
};
WorkoutStorage.useSharedConnectionText = {title:'Use the shared connection?', body:'This app then backs up through the connection the other apps use. Its own connection is removed from this browser; nothing in your bucket is deleted.', label:'Use shared connection'};
// Renders the description, plus a switch button for an app that kept its own connection.
WorkoutStorage.renderConnectionScope = function(container, remote, options = {}) {
  if (!container) return;
  const info = WorkoutStorage.describeConnection(remote), text = document.createElement('p');
  text.className = options.className || 'hint'; text.textContent = info.text; container.replaceChildren(text);
  if (!info.canSwitch) return;
  const button = document.createElement('button'), copy = WorkoutStorage.useSharedConnectionText;
  button.type = 'button'; button.className = options.buttonClass || 'btn'; button.textContent = 'Use the shared connection…';
  button.addEventListener('click', async () => {
    if (!await options.confirm(copy.title, copy.body, copy.label)) return;
    remote.useSharedConnection(); options.onChange?.();
  });
  container.append(button);
};
