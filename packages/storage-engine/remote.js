/* Cloud backup engine extracted from Liftlog, with app-specific rules injected. */
WorkoutStorage.createRemote = function(app) {
  'use strict';
  const {prepare:prepareBackup, validate:validateBackup, backup:backupPayload,
    revision:remoteSnapshotTime, dataKey:backupDataKey, onStatus:setRemoteStatus,
    toast, confirm:confirmDlg} = app;
  const deepCopy = WorkoutStorage.copy;
  const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
  const localRevisionKey = () => JSON.stringify(app.state);
  /* A pristine device holds only the app's starting data: nothing the person
     made. It never uploads, and on first connection it takes the cloud copy. */
  const pristine = () => !!app.isPristine?.(app.state);
  const hasData = () => app.isPristine ? !pristine() : !!app.hasData?.();
  const flushSave = () => app.local.flush();
  const uid = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
/* All apps on one site share one cloud connection (endpoint, region, bucket,
   addressing, credentials and backup mode) under SHARED_KEY. Each app keeps
   its own record under LS_REMOTE_KEY: its backup path and backup history. An
   app whose own record still holds a different connection (saved before the
   connection was shared) keeps using it until the person switches. */
const LS_REMOTE_KEY = app.namespace + ".remote";
const SHARED_KEY = WorkoutStorage.SHARED_CONNECTION_KEY;
const CONNECTION_FIELDS = ['endpoint','region','bucket','pathStyle','accessKeyId','secretAccessKey','syncMode'];
const REMOTE_OBJECT_KEY_DEFAULT = app.objectKey;
const APP_ID = app.namespace.split('.')[0];
const LS_REMOTE_RESTORE_KEY = app.recoveryKey;
const REMOTE_BACKUP_DELAY = 3000;
let remoteBackupTimer = 0;
const REMOTE_WORK_KEY = app.namespace + ".remote-work";
const REMOTE_PAUSE_KEY = app.namespace + ".remote-paused";
let remotePauseBlocked = false;
/* Separate from credentials and workout state: importing a file, changing a
   destination or reconnecting after reload must not undo a recovery choice. */
function remoteSyncPaused(){
  if (remotePauseBlocked) return true;
  try { return localStorage.getItem(REMOTE_PAUSE_KEY) != null; }
  catch(e){ return true; } // unavailable storage fails closed
}
/* `code` names the cause for the storage summary. A review or check started
   while already paused passes `keep`, so the summary still names the cause
   the person saw before opening it. */
function pauseRemoteSync(reason, options = {}){
  invalidateRemote();
  let existing = null;
  if (options.keep && !remotePauseBlocked){ try { existing = localStorage.getItem(REMOTE_PAUSE_KEY); } catch(e){} }
  if (existing == null){
    try { localStorage.setItem(REMOTE_PAUSE_KEY, JSON.stringify({reason:reason || 'Paused by you',code:options.code || null,at:Date.now()})); }
    catch(e){ remotePauseBlocked = true; setRemoteStatus('error','Cloud sync paused in this page; pause could not be saved. Local restore blocked.'); throw new Error('Could not persist cloud sync pause — local restore blocked'); }
  }
  setRemoteStatus('paused', reason || 'Cloud sync paused');
}
/* null when not paused. Code 'storage' means the pause record cannot be read
   or written, which keeps sync paused for safety. */
function remotePauseInfo(){
  if (remotePauseBlocked) return {code:'storage',at:null};
  let raw;
  try { raw = localStorage.getItem(REMOTE_PAUSE_KEY); }
  catch(e){ return {code:'storage',at:null}; }
  if (raw == null) return null;
  let record = null;
  try { record = JSON.parse(raw); } catch(e){}
  return {code:typeof record?.code === 'string' ? record.code : null, at:Number.isFinite(record?.at) ? record.at : null};
}
function pauseRemoteSyncAction(){
  const term = syncMode(loadRemoteConfig()) === 'immutable' ? 'Cloud backups' : 'Cloud sync';
  try { pauseRemoteSync(term + ' paused', {code:'manual'}); toast(term + ' paused. Credentials are kept.'); }
  catch(e){ toast(e.message); }
  app.onRefresh?.();
}
function resumeReviewedSync(ctx){
  assertRemote(ctx);
  if(syncMode(loadRemoteConfig())==='conditional'&&unsafeProvider())throw new Error('The provider failed overwrite protection. Choose separate backup files or recheck compatibility before resuming sync.');
  localStorage.removeItem(REMOTE_PAUSE_KEY);
  remotePauseBlocked = false;
  invalidateRemote();
  ctx.generation = remoteGeneration; ctx.allowPaused = false;
}

const REMOTE_TIMEOUT = 20000;
let remoteGeneration = 0, remoteQueue = Promise.resolve(), remoteControllers = new Set();
let toolsBusy=false, lastDiagnostic=null, snapshotPage=null, snapshotIndex=null, providerMemory=null;
const probeKeys=new Set(),archiveKeys=new Set();
function syncMode(cfg){return cfg?.syncMode==='conditional'?'conditional':'immutable';}
const providerKey=app.namespace+'.provider-check';
const scopeKey=cfg=>JSON.stringify([cfg.endpoint,cfg.region,cfg.bucket,cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT,!!cfg.pathStyle,cfg.accessKeyId,...(syncMode(cfg)==='immutable'?['immutable']:[])]);
function providerReport(){
  const cfg=loadRemoteConfig();if(!cfg)return null;
  // Prefer durable results so a failed check in another tab cannot be masked
  // by this tab's older passing result. Memory is only a failed-write fallback.
  try{const saved=JSON.parse(localStorage.getItem(providerKey));if(saved?.scope===scopeKey(cfg))return saved.report;}catch(e){}
  return providerMemory?.scope===scopeKey(cfg)&&providerMemory.report.persistenceMessage?providerMemory.report:null;
}
function toolsChanged(){if(app.onToolsChange)app.onToolsChange();else app.onRefresh?.();}
function unsafeProvider(){const report=providerReport();return report?.overwriteProtection==='failed'||report?.ifNoneMatch==='failed'||report?.ifMatch==='failed';}
function diagnosticError(category,message,cfg,operation,status){
  const error=new Error(message);error.diagnostic={category,message,operation,httpStatus:status||null,at:new Date().toISOString()};
  const current=loadRemoteConfig();
  const related=current&&scopeKey({...cfg,objectKey:current.objectKey})===scopeKey(current)&&
    (cfg.objectKey?.startsWith((current.objectKey||REMOTE_OBJECT_KEY_DEFAULT)+'.checks/')||cfg.objectKey?.startsWith(snapshotPrefix(current)));
  lastDiagnostic={scope:scopeKey(related?current:cfg),...error.diagnostic};toolsChanged();return error;
}
function responseError(res,raw,cfg,operation){
  const code=(raw.match(/<(?:\w+:)?Code>([A-Za-z0-9_]+)<\/(?:\w+:)?Code>/)||[])[1]||'';
  // Some S3-compatible services report signature failures as AccessDenied. Classify only this
  // known message; never retain or display the provider's raw response.
  const invalidSignature=code==='AccessDenied'&&/<(?:\w+:)?Message>\s*Forbidden:\s*Invalid signature\s*<\/(?:\w+:)?Message>/i.test(raw);
  const invalidAccessKey=code==='AccessDenied'&&/<(?:\w+:)?Message>\s*(?:Forbidden:\s*)?No such key:\s*[^<]+<\/(?:\w+:)?Message>/i.test(raw);
  let category='provider',hint='Check the storage service and its permissions.';
  if(code==='NoSuchBucket'){category='bucket';hint='The bucket does not exist. Check its name on your storage server.';}
  else if(invalidSignature||invalidAccessKey||['InvalidAccessKeyId','InvalidToken','ExpiredToken','SignatureDoesNotMatch'].includes(code)){category='credentials';hint='The S3 credentials or request signature were rejected. Check the access key ID and matching secret, region and endpoint; use a key authorized for this bucket.';}
  else if(code==='AuthorizationHeaderMalformed'){category='region';hint='Check the configured region and S3 endpoint.';}
  else if(['RequestTimeTooSkewed','RequestExpired'].includes(code)){category='clock';hint='Check this device’s date and time.';}
  else if(res.status===403){category='permissions';hint=operation==='list snapshots'?'The key needs permission to list this bucket.':operation==='cleanup probe'?'Allow DELETE in bucket CORS and grant object-delete permission to remove the temporary probe.':'The key needs permission for this operation on the bucket.';}
  else if(res.status===404){category='missing-object';hint='The object is missing or the server did not identify a missing object unambiguously.';}
  else if([409,412].includes(res.status)){category='precondition';hint='The object changed or the provider rejected this write condition.';}
  const knownCode=['NoSuchBucket','NoSuchKey','InvalidAccessKeyId','InvalidToken','ExpiredToken','SignatureDoesNotMatch','AuthorizationHeaderMalformed','RequestTimeTooSkewed','RequestExpired','AccessDenied','PreconditionFailed','InternalError','InvalidRequest'].includes(code)?code:'';
  return diagnosticError(category,`${operation}: HTTP ${res.status}${knownCode?' '+knownCode:''}. ${hint}`,cfg,operation,res.status);
}
function diagnosticsPayload(){
  const cfg=loadRemoteConfig(),diagnostic=cfg&&lastDiagnostic?.scope===scopeKey(cfg)?lastDiagnostic:null;
  return {app:app.namespace.split('.')[0],kind:'storage-diagnostics',exportedAt:new Date().toISOString(),
    connection:cfg?{endpoint:cfg.endpoint,region:cfg.region,bucket:cfg.bucket,objectKey:cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT,pathStyle:cfg.pathStyle,syncMode:syncMode(cfg)}:null,
    paused:remoteSyncPaused(),providerCheck:providerReport(),
    lastError:diagnostic?{category:diagnostic.category,message:diagnostic.message,operation:diagnostic.operation,httpStatus:diagnostic.httpStatus,at:diagnostic.at}:null};
}
function remoteTools(){return {busy:toolsBusy,active:app.isActive(),mode:syncMode(loadRemoteConfig()),report:providerReport(),diagnostic:diagnosticsPayload().lastError,snapshots:snapshotPage&&snapshotPage.scope===scopeKey(loadRemoteConfig()||{})?deepCopy(snapshotPage):null};}
function enforceBackupLimits(obj){ WorkoutStorage.enforceLimits(obj,app.limits); }
/* Where backups land. Credentials are excluded, because a new key for the
   same bucket leaves the backups already verified there in place. */
function remoteDestination(cfg){
  return JSON.stringify([String(cfg.endpoint || '').replace(/\/+$/, ''),cfg.region,cfg.bucket,cfg.objectKey || REMOTE_OBJECT_KEY_DEFAULT,!!cfg.pathStyle,syncMode(cfg)]);
}
function remoteIdentity(cfg){
  return JSON.stringify([cfg.endpoint,cfg.region,cfg.bucket,cfg.objectKey || REMOTE_OBJECT_KEY_DEFAULT,!!cfg.pathStyle,cfg.accessKeyId,cfg.secretAccessKey,...(syncMode(cfg)==='immutable'?['immutable']:[])]);
}
function invalidateRemote(){
  remoteGeneration++;
  remoteControllers.forEach(c => c.abort()); remoteControllers.clear();
  clearTimeout(remoteBackupTimer); remoteBackupTimer = 0;
}
function assertRemote(ctx){
  if (ctx.generation !== remoteGeneration || (!ctx.candidate && remoteIdentity(loadRemoteConfig() || {}) !== ctx.identity))
    throw new Error('Cloud settings or sync mode changed; request cancelled');
  if (!ctx.allowPaused && remoteSyncPaused()) throw new Error('Cloud sync is paused');
}
function coordinateRemote(fn, cfg, candidate, allowPaused){
  const ctx = { generation:remoteGeneration, identity:remoteIdentity(cfg), candidate:!!candidate, allowPaused:!!allowPaused || !!candidate };
  const job = remoteQueue.then(async () => { assertRemote(ctx); return fn(ctx); });
  remoteQueue = job.catch(() => {}); return job;
}
function readRemoteWork(){
  try { const w = JSON.parse(localStorage.getItem(REMOTE_WORK_KEY));
    return w && w.identity === remoteIdentity(loadRemoteConfig() || {}) ? w : null;
  } catch(e){ return null; }
}
function writeRemoteWork(work){
  localStorage.setItem(REMOTE_WORK_KEY, JSON.stringify({ ...work, identity:remoteIdentity(loadRemoteConfig() || {}) }));
}
function validateRemoteConfig(cfg){
  if(cfg.syncMode!=null&&!['auto','immutable','conditional'].includes(cfg.syncMode))throw new Error('Invalid sync mode');
  const raw = cfg.endpoint;
  if (typeof raw !== 'string' || /[?#\\\s]/.test(raw) || raw.split('/').some(x => /^(\.|%2e)(\.|%2e)?$/i.test(x))) throw new Error('Endpoint must not contain query, fragment or dot segments');
  const u = new URL(raw);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || !u.hostname || (u.pathname !== '/' && u.pathname !== '')) throw new Error('Endpoint must be an origin without credentials or a path');
  const localPage = location.protocol === 'file:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if (u.protocol !== 'https:' && !localPage) throw new Error('HTTPS is required for hosted use');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket) || /\.\.|\.-|-\./.test(cfg.bucket) || /^\d+\.\d+\.\d+\.\d+$/.test(cfg.bucket)) throw new Error('Invalid bucket name');
  if (!cfg.pathStyle && (cfg.bucket.includes('.') || u.port || u.hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))) throw new Error('Use path-style for dotted buckets, IP addresses or custom ports');
  if (typeof cfg.pathStyle !== 'boolean' || !/^[a-z0-9-]+$/.test(cfg.region || '')) throw new Error('Addressing style and region are required');
  const key = cfg.objectKey || REMOTE_OBJECT_KEY_DEFAULT;
  if (new TextEncoder().encode(key).length > 1024 || /[\u0000-\u001f\u007f\\]/.test(key) || key.split('/').some(x => !x || ['.','..'].includes(x) || /^(\.|%2e){1,2}$/i.test(x))) throw new Error('Invalid object path (empty or dot segments)');
  return cfg;
}

const complete = cfg => !!(cfg && cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
const pick = cfg => Object.fromEntries(CONNECTION_FIELDS.filter(key => cfg[key] !== undefined).map(key => [key, cfg[key]]));
const omit = cfg => Object.fromEntries(Object.entries(cfg).filter(([key]) => !CONNECTION_FIELDS.includes(key)));
const connectionKey = cfg => JSON.stringify([String(cfg.endpoint || '').replace(/\/+$/, ''),cfg.region,cfg.bucket,!!cfg.pathStyle,cfg.accessKeyId,cfg.secretAccessKey,syncMode(cfg)]);
const HISTORY_FIELDS = ['lastBackupAt','lastUploadedModifiedAt','lastBackupMode'];
/* This app's record, with the destination its backup history belongs to: the
   shared connection can change in another app, and history for one bucket or
   path must not describe another. */
const appRecord = cfg => ({...omit(cfg), historyFor:remoteDestination(cfg)});
function readRecord(key){
  try { const value = JSON.parse(localStorage.getItem(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch(e){ return null; }
}
// Move a connection saved before sharing: it becomes the shared one, or is
// dropped when it matches; a different one stays with this app.
(function adoptSharedConnection(){
  try {
    const own = readRecord(LS_REMOTE_KEY);if (!complete(own)) return;
    const shared = readRecord(SHARED_KEY);
    if (complete(shared) && connectionKey(shared) !== connectionKey(own)) return;
    if (!complete(shared)) localStorage.setItem(SHARED_KEY, JSON.stringify(pick(own)));
    localStorage.setItem(LS_REMOTE_KEY, JSON.stringify(appRecord(own)));
  } catch(e){}
})();
/* 'shared', 'own' (a different connection kept from before sharing) or 'none'. */
function connectionScope(){
  if (complete(readRecord(LS_REMOTE_KEY))) return 'own';
  return complete(readRecord(SHARED_KEY)) ? 'shared' : 'none';
}
function sharedConnection(){
  const shared = readRecord(SHARED_KEY);
  return complete(shared) ? {endpoint:shared.endpoint, region:shared.region, bucket:shared.bucket, pathStyle:!!shared.pathStyle, syncMode:syncMode(shared)} : null;
}
function loadRemoteConfig(){
  const own = readRecord(LS_REMOTE_KEY);
  if (complete(own)) return own;
  const shared = readRecord(SHARED_KEY);
  if (!complete(shared)) return null;
  const cfg = {...pick(shared), ...omit(own || {})};
  if (cfg.historyFor !== undefined && cfg.historyFor !== remoteDestination(cfg)) for (const key of HISTORY_FIELDS) delete cfg[key];
  delete cfg.historyFor;
  return cfg;
}
/* Saving the same connection (after an upload, say) keeps it where it is.
   Saving a different one writes the shared connection for every app. */
function saveRemoteConfig(cfg, ctx){
  if (ctx) assertRemote(ctx);
  const previous = loadRemoteConfig();
  const changed = !previous || remoteIdentity(previous) !== remoteIdentity(cfg);
  if (changed){invalidateRemote();localStorage.removeItem(providerKey);snapshotPage=null;snapshotIndex=null;lastDiagnostic=null;providerMemory=null;}
  if (connectionScope() === 'own' && previous && connectionKey(previous) === connectionKey(cfg)) localStorage.setItem(LS_REMOTE_KEY, JSON.stringify(cfg));
  else {
    // An unchanged value is not rewritten, so other apps see no storage event.
    const shared = JSON.stringify(pick(cfg));
    if (localStorage.getItem(SHARED_KEY) !== shared) localStorage.setItem(SHARED_KEY, shared);
    localStorage.setItem(LS_REMOTE_KEY, JSON.stringify(appRecord(cfg)));
  }
  if (changed) localStorage.removeItem(REMOTE_WORK_KEY);
}
/* Drops this app's own connection. Backup history stays only when the
   shared connection writes to the same destination. */
function useSharedConnection(){
  const own = readRecord(LS_REMOTE_KEY), shared = readRecord(SHARED_KEY);
  if (!complete(own) || !complete(shared)) return false;
  invalidateRemote();
  localStorage.setItem(LS_REMOTE_KEY, JSON.stringify(appRecord(own)));
  localStorage.removeItem(REMOTE_WORK_KEY);localStorage.removeItem(providerKey);snapshotPage=null;snapshotIndex=null;lastDiagnostic=null;providerMemory=null;
  app.onRefresh?.();
  return true;
}
/* Forgetting the shared connection ends cloud backups for every app on the
   site; the other apps keep their backup paths and history. Forgetting an
   app's own connection returns that app to the shared one. */
function clearRemoteConfig(){
  invalidateRemote();
  try{
    if (connectionScope() !== 'own') localStorage.removeItem(SHARED_KEY);
    localStorage.removeItem(LS_REMOTE_KEY);localStorage.removeItem(REMOTE_WORK_KEY);localStorage.removeItem(providerKey);localStorage.removeItem(freshKey);snapshotPage=null;snapshotIndex=null;lastDiagnostic=null;providerMemory=null;
  }
  catch(e){ toast('Could not forget configuration — storage unavailable'); }
  setRemoteStatus('', '');
}
// Another app or tab changed the shared connection: stop requests made for the old one.
globalThis.addEventListener?.('storage', event => {
  if (event.key !== SHARED_KEY && event.key !== null) return;
  invalidateRemote(); app.onRefresh?.();
});
/* The secret is never pre-filled (its input just carries a "leave blank to
   keep" placeholder when one is already stored), so a freshly opened draft
   always starts with an empty secret field. */

function remoteCryptoAvailable(){
  return !!(window.crypto && window.crypto.subtle);
}

/* ---- minimal AWS SigV4 request signer, zero dependencies (Web Crypto only) ----
   Enough to PUT/GET a single object — the whole of what a manual backup needs. */
function toHex(buf){
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function sha256Hex(text){
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
async function hmacRaw(keyBytes, msg){
  const key = await crypto.subtle.importKey('raw', keyBytes, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}
async function signingKey(secret, dateStamp8, region, service){
  let key = new TextEncoder().encode('AWS4' + secret);
  key = await hmacRaw(key, dateStamp8);
  key = await hmacRaw(key, region);
  key = await hmacRaw(key, service);
  return hmacRaw(key, 'aws4_request');
}
function amzNow(){
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); /* YYYYMMDDTHHMMSSZ */
  return { amz, stamp:amz.slice(0,8) };
}
/* RFC 3986 path-segment encoding; S3 wants "/" left alone in the object key. */
function uriEncode(s){
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function remoteUrl(cfg){
  const ep = cfg.endpoint.replace(/\/+$/, '');
  const key = (cfg.objectKey || REMOTE_OBJECT_KEY_DEFAULT).replace(/^\/+/, '').split('/').map(uriEncode).join('/');
  if (cfg.pathStyle) return ep + '/' + cfg.bucket + '/' + key;
  return ep.replace('://', '://' + cfg.bucket + '.') + '/' + key;
}
async function s3Request(cfg, method, bodyText, options = {}, ctx){
  validateRemoteConfig(cfg);
  if (method === 'PUT' && (!options.headers || !(options.headers['if-match'] || options.headers['if-none-match'] === '*'))) throw new Error('Unconditional cloud writes are disabled');
  if(method==='PUT'&&!probeKeys.has(cfg.objectKey)){
    if(syncMode(cfg)==='immutable'&&!archiveKeys.has(cfg.objectKey))throw new Error('Separate backup mode only writes newly generated backup files');
    if(syncMode(cfg)==='conditional'&&unsafeProvider())throw diagnosticError('overwrite-protection','The provider failed overwrite protection. Choose separate backup files or recheck compatibility after fixing the provider.',cfg,'upload');
  }
  if (ctx) assertRemote(ctx);
  else if (remoteSyncPaused()) throw new Error('Cloud sync is paused');
  const url = new URL(remoteUrl(cfg));
  let query='';
  if(options.list){
    if(method!=='GET')throw new Error('Bucket listing only supports GET');
    url.pathname=cfg.pathStyle?'/'+uriEncode(cfg.bucket):'/';
    const params={'list-type':'2','max-keys':String(options.list.max||20),prefix:(cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT)+'.snapshots/'};
    if(options.list.token)params['continuation-token']=options.list.token;
    query=Object.entries(params).map(([key,value])=>[uriEncode(key),uriEncode(value)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(pair=>pair.join('=')).join('&');
    url.search=query;
  }
  const payloadHash = await sha256Hex(bodyText || '');
  const { amz, stamp } = amzNow();
  /* signed only, never sent as-is: the browser sets the real Host header itself */
  const headers = { host:url.host, 'x-amz-content-sha256':payloadHash, 'x-amz-date':amz };
  if (method === 'PUT') headers['content-type'] = 'application/json';
  Object.assign(headers, options.headers || {});
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(h => h + ':' + headers[h] + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, url.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = stamp + '/' + cfg.region + '/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = toHex(await hmacRaw(await signingKey(cfg.secretAccessKey, stamp, cfg.region, 's3'), stringToSign));
  const authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.accessKeyId + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
  if (ctx) assertRemote(ctx);
  const controller = new AbortController(); remoteControllers.add(controller);
  const deadline = setTimeout(() => controller.abort(), REMOTE_TIMEOUT);
  try {
    const sentHeaders = { ...headers, Authorization:authorization }; delete sentHeaders.host;
    const res = await fetch(url.toString(), { method, headers:sentHeaders,
      body:method === 'PUT' ? bodyText : undefined, signal:controller.signal, cache:'no-store', redirect:'error' });
    const maxBytes = res.ok ? BACKUP_MAX_BYTES : 65536;
    if (Number(res.headers.get('content-length')) > maxBytes){ if (res.body) await res.body.cancel(); throw diagnosticError('size','Remote response exceeds size limit. Use an external S3 client for files larger than 8 MiB.',cfg,method); }
    const reader = res.body && res.body.getReader();
    let size = 0, text = ''; const decoder = new TextDecoder();
    if (reader) while (true){
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes){ await reader.cancel(); throw diagnosticError('size','Remote response exceeds size limit. Use an external S3 client for files larger than 8 MiB.',cfg,method); }
      text += decoder.decode(part.value, {stream:true});
    }
    text += decoder.decode();
    if (ctx) assertRemote(ctx);
    return { ok:res.ok, status:res.status, headers:res.headers, text:async () => text };
  } catch(e){
    if (ctx) assertRemote(ctx);
    if (controller.signal.aborted) throw diagnosticError('timeout','Remote request/body timed out. Check storage availability and your connection.',cfg,method);
    if(e instanceof TypeError||e?.name==='TypeError')throw diagnosticError('network-or-cors','The browser could not reach or was blocked from storage. Check network access, the endpoint, HTTPS certificate, local-network permission if prompted, and bucket CORS for this app’s origin.',cfg,method);
    throw e;
  } finally { clearTimeout(deadline); remoteControllers.delete(controller); }
}

async function remoteRunAction(fn){ app.onBusy?.(true); try { return await fn(); } catch(e){ toast(e.message || 'Remote storage request failed'); } finally { app.onBusy?.(false); } }



/* Compare migrated data, not export envelopes, backup dates or recovery cursors. */


function scheduleRemoteBackup(delay){
  if (!loadRemoteConfig() || !remoteCryptoAvailable()) return;
  try { const old = readRemoteWork() || {}; writeRemoteWork({ ...old, pending:true, revision:remoteSnapshotTime(app.state), nextAt:Date.now() + (delay == null ? REMOTE_BACKUP_DELAY : delay) }); }
  catch(e){ setRemoteStatus('error','Cannot persist pending backup; keep this page open'); return; }
  armRemoteRetry();
  setRemoteStatus(remoteSyncPaused() ? 'paused' : 'pending', remoteSyncPaused() ? 'Local changes retained — cloud sync paused' : navigator.onLine === false ? 'Waiting for a connection' : 'Changes waiting to back up');
}
function armRemoteRetry(){
  clearTimeout(remoteBackupTimer); remoteBackupTimer = 0;
  const work = readRemoteWork();
  if (!remoteSyncPaused() && work && work.pending && navigator.onLine !== false)
    remoteBackupTimer = setTimeout(autoRemoteBackup, Math.max(0, (work.nextAt || 0) - Date.now()));
}
function retryRemoteError(e, ctx){
  assertRemote(ctx);
  setRemoteStatus('error',e.message + ' — retry pending');
  const old = readRemoteWork() || {}, attempts = Math.min((old.attempts || 0) + 1, 10);
  try { writeRemoteWork({ pending:true, revision:remoteSnapshotTime(app.state), attempts,
    nextAt:Date.now() + Math.min(300000, 3000 * 2 ** (attempts - 1)), error:e.message }); }
  catch(storageError){ setRemoteStatus('error', e.message + ' — retry could not be saved; retry manually'); return; }
  setRemoteStatus('error',e.message + ' — retry pending'); armRemoteRetry();
}
async function readRemoteBackup(cfg, ctx){
  const res = await s3Request(cfg, 'GET', '', {}, ctx);
  const raw = await res.text();
  if (!res.ok){
    const code = (raw.match(/<Code>([^<]+)<\/Code>/) || [])[1] || (() => { try { return JSON.parse(raw).Code; } catch(e){ return ''; } })();
    if (res.status === 404 && code === 'NoSuchKey') return null;
    throw responseError(res,raw,cfg,'read backup');
  }
  let obj; try { obj = JSON.parse(raw); } catch(e){ throw diagnosticError('backup','Remote file is not valid JSON. Download it separately or choose a different backup path.',cfg,'read backup'); }
  let candidate;
  try { candidate = prepareBackup(obj); } catch(e){
    // Keep useful field-level feedback on screen, but never export provider
    // file contents or arbitrary validation messages in a diagnostic report.
    const error=diagnosticError('backup','Invalid backup — this file does not match the app’s supported backup format.',cfg,'read backup');
    error.message='Invalid backup — '+e.message;throw error;
  }
  const etag = res.headers.get('etag');
  if (!etag || !/^"[^"\r\n]+"$/.test(etag)) throw diagnosticError('etag','Remote ETag missing or invalid; expose ETag in CORS and preserve it through the proxy.',cfg,'read backup');
  return { obj, candidate, etag, raw, at:remoteSnapshotTime(obj) };
}
function preserveBeforeRemoteRestore(){
  try{ localStorage.setItem(LS_REMOTE_RESTORE_KEY, JSON.stringify(backupPayload())); return true; }
  catch(e){ setRemoteStatus('error','Could not preserve local data before restore'); return false; }
}
/* localStorage setItem is atomic: persist the candidate before activating it.
   Failure leaves the old durable key and in-memory state intact. */
function commitSnapshot(candidate){ enforceBackupLimits(candidate); validateBackup(candidate); if (!app.local.commit(candidate,{key:LS_REMOTE_RESTORE_KEY,payload:backupPayload()})){ setRemoteStatus('error','Restore not saved — previous data retained'); return false; } app.onRestore(); return true; }
function installRemoteSnapshot(candidate, remoteAt, expected, ctx, message){
  if (ctx) assertRemote(ctx);
  if (remoteSyncPaused()){ setRemoteStatus('paused','Local copy protected — cloud sync paused'); return false; }
  if (app.isActive() || (expected != null && expected !== localRevisionKey())){
    writeRemoteWork({ ...(readRemoteWork() || {}), pending:true, deferred:true, revision:remoteSnapshotTime(app.state) });
    setRemoteStatus('pending','Remote replacement deferred — workout or local edits; recheck after workout'); return false;
  }
  if (!commitSnapshot(candidate)) return false;
  toast(message || 'Restored newer remote backup'); return true;
}
function markRemoteSuccess(cfg, revision, ctx, message){
  assertRemote(ctx);
  cfg.lastBackupAt = Date.now(); cfg.lastUploadedModifiedAt = revision;cfg.lastBackupMode=syncMode(cfg);
  saveRemoteConfig(cfg, ctx);
  const pending = remoteSnapshotTime(app.state) !== revision;
  writeRemoteWork({ pending, revision:remoteSnapshotTime(app.state), attempts:0, nextAt:Date.now() + REMOTE_BACKUP_DELAY });
  setRemoteStatus(pending ? 'pending' : 'synced', pending ? 'Newer changes waiting to back up' : message || 'Up to date');
  armRemoteRetry();
}
/* A conflict pauses sync, so a later local edit cannot upload over the cloud
   copy before the person chooses one. */
function holdConflict(message, ctx){
  // Called from inside a running request, which finishes normally: only
  // later work is stopped, so the generation is left as it is.
  if (ctx) ctx.allowPaused = true;
  clearTimeout(remoteBackupTimer); remoteBackupTimer = 0;
  try { if (localStorage.getItem(REMOTE_PAUSE_KEY) == null) localStorage.setItem(REMOTE_PAUSE_KEY, JSON.stringify({reason:message,code:'conflict',at:Date.now()})); }
  catch(e){ remotePauseBlocked = true; }
  setRemoteStatus('conflict',message);
  return 'conflict';
}
function reconcileRemote(remote, expected, ctx){
  if (!remote) return pristine() ? 'pristine' : 'upload';
  const same = backupDataKey(remote.candidate) === backupDataKey(app.state);
  const localAt = remoteSnapshotTime(app.state);
  if (same) return 'same';
  if (pristine()){
    if (installRemoteSnapshot(remote.candidate, remote.at, expected, ctx, 'Restored the cloud copy. This device’s starting data is kept as a recovery copy.')) return 'restored';
    return 'deferred';
  }
  const baseline = loadRemoteConfig()?.lastUploadedModifiedAt;
  // A first connection has no shared history: timestamps from two devices
  // say nothing about which copy the person wants.
  if (!Number.isSafeInteger(baseline) || baseline <= 0)
    return holdConflict('This device and the cloud both hold data — choose Keep local copy or Use cloud copy', ctx);
  if (localAt !== baseline && remote.at !== baseline)
    return holdConflict('Both copies changed since the last sync — choose Keep local copy or Use cloud copy', ctx);
  if (!remote.at || (!localAt && app.local.existing) || remote.at === localAt)
    return holdConflict('Conflicting or undated backups — download local data and explicitly restore to choose', ctx);
  if (remote.at > localAt){
    if (installRemoteSnapshot(remote.candidate, remote.at, expected, ctx)) return 'restored';
    return 'deferred';
  }
  return 'upload';
}
async function appendRemoteBackup(cfg,ctx){
  assertRemote(ctx);
  if(app.local.blocked)throw new Error('Restore a valid local backup before uploading');
  if(!flushSave())throw new Error('Backup paused — local changes could not be saved');
  if(cfg.lastBackupMode==='immutable'&&cfg.lastUploadedModifiedAt===remoteSnapshotTime(app.state)&&!readRemoteWork()?.pending){setRemoteStatus('synced','Current revision is already backed up');return 'same';}
  const payload=backupPayload();enforceBackupLimits(payload);validateBackup(payload);
  // No shared "latest" pointer. Random UUIDs prevent independent devices
  // choosing the same destination even when the server ignores conditions.
  if(typeof crypto.randomUUID!=='function')throw new Error('Separate backups require secure random UUID support');
  const key=snapshotPrefix(cfg)+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID()+'.json';
  const target={...cfg,objectKey:key},raw=JSON.stringify(payload);
  validateRemoteConfig(target);archiveKeys.add(key);
  try{
    const res=await s3Request(target,'PUT',raw,{headers:{'if-none-match':'*'}},ctx);
    if(!res.ok)throw responseError(res,await res.text(),cfg,'append backup');
    const verify=await readRemoteBackup(target,ctx);
    if(!verify||verify.raw!==raw)throw diagnosticError('read-back','The uploaded backup could not be verified. Local data is retained; a retry will create another file.',cfg,'append backup');
    markRemoteSuccess(cfg,remoteSnapshotTime(payload),ctx,'Separate cloud backup saved — restores require your choice');
    return 'uploaded';
  }finally{archiveKeys.delete(key);}
}
/* With app.choose (a dialog with buttons), resuming also offers the newest
   cloud backup, so data from another device can be brought here first. */
async function chooseResume(){
  const title='Resume separate cloud backups?';
  if(!app.choose){
    const body='A new backup file will be saved from this device, then changes will create separate files automatically. Existing cloud files are kept. To bring data from another device, browse cloud backups and restore or download a chosen copy first.';
    return await confirmDlg(title,body,'Resume backups')?'resume':null;
  }
  const body='Resuming saves a new backup file from this device, then each change creates another file. Existing cloud files are kept. To continue from another device’s data, restore the latest cloud backup instead.';
  const choice=await app.choose({title,body,buttons:[{label:'Cancel',value:null,autofocus:true},{label:'Restore latest cloud backup…',value:'restore'},{label:'Resume backups',value:'resume',cls:'btn-primary'}]});
  return choice===true?'resume':choice;
}
function resumeImmutableBackups(cfg){
  try{pauseRemoteSync('Separate backups paused for review',{code:'review',keep:true});}catch(error){toast(error.message);return;}
  return remoteRunAction(()=>coordinateRemote(async ctx=>{
    const expected=localRevisionKey(),choice=await chooseResume();
    if(choice!=='resume')return choice;
    assertRemote(ctx);
    if(expected!==localRevisionKey())throw new Error('Local data changed during review — choose again; backups remain paused');
    await appendRemoteBackup(cfg,ctx);
    resumeReviewedSync(ctx);armRemoteRetry();
    setRemoteStatus('synced','Separate backups resumed');toast('Separate cloud backup saved — backups resumed');
  },cfg,false,true)).then(choice=>choice==='restore'?remoteRestoreLatest().catch(()=>false):undefined);
}
function remoteRestoreLegacy(){const cfg=configured();return remoteRestoreSnapshot(cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT,true);}
async function putRemoteBackup(cfg, ctx){
  if(syncMode(cfg)==='immutable')return appendRemoteBackup(cfg,ctx);
  const localSaved = flushSave();
  if (!localSaved) setRemoteStatus('warning','Local saving failed — checking cloud backup');
  for (let attempt = 0; attempt < 3; attempt++){
    assertRemote(ctx);
    const expected = localRevisionKey();
    const remote = await readRemoteBackup(cfg, ctx);
    const result = reconcileRemote(remote, expected, ctx);
    if (['conflict','deferred','pristine'].includes(result)) return result;
    if (result === 'restored' || result === 'same'){
      markRemoteSuccess(cfg, remoteSnapshotTime(app.state), ctx, result === 'restored' ? 'Restored from remote' : 'Up to date'); return result;
    }
    // Any edits during GET require another comparison against that same remote.
    if (expected !== localRevisionKey()) continue;
    const payload = backupPayload(); enforceBackupLimits(payload);
    const revision = remoteSnapshotTime(payload);
    if (remote) await preserveRemoteSnapshot(cfg,remote,ctx);
    const res = await s3Request(cfg, 'PUT', JSON.stringify(payload),
      {headers:remote ? {'if-match':remote.etag} : {'if-none-match':'*'}}, ctx);
    if ([409,412].includes(res.status)) continue; // reread and reconcile; never unconditional
    if (!res.ok) throw responseError(res,await res.text(),cfg,'upload backup');
    markRemoteSuccess(cfg, revision, ctx);
    if (!localSaved || app.local.failed) setRemoteStatus('warning','Cloud backup succeeded; local saving failed' + (readRemoteWork().pending ? ' — newer edits pending' : ''));
    return 'uploaded';
  }
  throw new Error('Cloud changed during backup; retry pending');
}
async function autoRemoteBackup(){
  remoteBackupTimer = 0;
  const cfg = loadRemoteConfig();
  if (remoteSyncPaused()){ setRemoteStatus('paused','Local copy protected — cloud sync paused'); return; }
  if (!cfg || !remoteCryptoAvailable() || navigator.onLine === false) return;
  return coordinateRemote(async ctx => {
    try { await putRemoteBackup(cfg, ctx); }
    catch(e){ retryRemoteError(e, ctx); }
  }, cfg).catch(() => {});
}
function remoteBackup(){
  if (remoteSyncPaused()){ toast('Cloud sync paused — choose Keep local copy & update cloud or Resume automatic sync'); return; }
  const cfg = loadRemoteConfig(); if (!cfg) return;
  clearTimeout(remoteBackupTimer); remoteBackupTimer = 0;
  return remoteRunAction(() => coordinateRemote(async ctx => {
    try { const result = await putRemoteBackup(cfg, ctx); assertRemote(ctx);
      if (result === 'uploaded') toast('Cloud backup complete' + (app.local.failed ? ' — local save failed' : ''));
      else if (result === 'pristine') toast('Nothing to back up yet: this device holds only its starting data');
    } catch(e){ retryRemoteError(e, ctx); throw e; }
  },cfg));
}
/* An explicit recovery choice remains paused throughout review and execution.
   It never falls through to timestamp reconciliation after a failed CAS. */
function reviewedRemoteDirection(mode, remote){
  if (mode === 'cloud'){ if (!remote) throw new Error('No backup found at that location yet'); return 'cloud'; }
  if (!remote) return 'local';
  if (mode === 'local') return backupDataKey(remote.candidate) === backupDataKey(app.state) ? 'same' : 'local';
  if (backupDataKey(remote.candidate) === backupDataKey(app.state)) return 'same';
  const localAt = remoteSnapshotTime(app.state);
  const baseline = loadRemoteConfig()?.lastUploadedModifiedAt;
  if (Number.isSafeInteger(baseline) && baseline > 0 && localAt !== baseline && remote.at !== baseline)
    throw new Error('Both copies changed since the last sync — choose Keep local copy or Use cloud copy');
  if (!remote.at || (!localAt && app.local.existing) || remote.at === localAt)
    throw new Error('Copies conflict or are undated — choose Keep local copy or Use cloud copy');
  return remote.at > localAt ? 'cloud' : 'local';
}
function remoteReviewChoice(mode){
  const cfg = loadRemoteConfig(); if (!cfg) return;
  if(syncMode(cfg)==='immutable')return mode==='cloud'?remoteRunAction(()=>remoteRestoreLegacy()):resumeImmutableBackups(cfg);
  if(unsafeProvider()){toast('The provider failed overwrite protection. Recheck compatibility before resuming sync; local and snapshot recovery remain available.');return;}
  try { pauseRemoteSync('Cloud sync paused for review',{code:'review',keep:true}); }
  catch(e){ toast(e.message); return; }
  return remoteRunAction(() => coordinateRemote(async ctx => {
    try {
      const expected = localRevisionKey();
      const reviewed = await readRemoteBackup(cfg,ctx);
      assertRemote(ctx);
      if (expected !== localRevisionKey()) throw new Error('Local data changed during review — review again; sync remains paused');
      const direction = reviewedRemoteDirection(mode,reviewed);
      if (direction === 'cloud' && app.isActive()) throw new Error('Finish or discard your active workout before choosing the cloud copy; sync remains paused');
      const title = mode === 'automatic' ? 'Resume automatic sync?' : direction === 'cloud' ? 'Use cloud copy?' : 'Keep local copy?';
      const body = direction === 'cloud' ? 'The cloud copy will replace this device’s local data. A local recovery copy will be saved. Automatic cloud sync will resume.'
        : direction === 'local' ? 'This device’s local data will become the current cloud backup, replacing the cloud copy if present. The previous cloud backup will be preserved as a dated snapshot. Automatic cloud sync will resume.'
        : 'Both copies contain the same data. No workout data will be replaced. Automatic cloud sync will resume.';
      const ok = await confirmDlg(title,body,direction === 'cloud' ? 'Use cloud copy & resume' : direction === 'local' ? 'Keep local & update cloud' : 'Resume sync', direction !== 'same');
      assertRemote(ctx);
      if (!ok){ setRemoteStatus('paused','Cloud sync remains paused'); return; }
      if (expected !== localRevisionKey()) throw new Error('Local data changed during confirmation — review again; sync remains paused');
      // Confirm against a fresh revision, including missing -> present transitions.
      const current = await readRemoteBackup(cfg,ctx);
      if (expected !== localRevisionKey()) throw new Error('Local data changed during confirmation — review again; sync remains paused');
      if (!!reviewed !== !!current || (reviewed && (reviewed.etag !== current.etag || reviewed.raw !== current.raw)))
        throw new Error('Cloud changed since review — choose again; sync remains paused');
      let backedUpRevision;
      if (direction === 'cloud'){
        assertRemote(ctx);
        if (app.isActive()) throw new Error('A workout started during review — sync remains paused');
        if (!commitSnapshot(current.candidate)) throw new Error('Restore failed — previous data retained; sync remains paused');
        backedUpRevision = current.at;
      } else if (direction === 'local'){
        if (current) await preserveRemoteSnapshot(cfg,current,ctx);
        assertRemote(ctx);
        if (expected !== localRevisionKey()) throw new Error('Local data changed before publication — review again; sync remains paused');
        // Explicit adoption of local data is a new revision above the observed cloud.
        const payload = backupPayload();
        backedUpRevision = Math.max(Date.now(),remoteSnapshotTime(app.state) + 1,(current ? current.at : 0) + 1);
        app.setRevision(payload,backedUpRevision);
        enforceBackupLimits(payload); validateBackup(payload);
        if (app.local.blocked) throw new Error('Restore a valid local backup before publishing recovered data');
        // Persist the rebased revision without resetting the UI or active timer.
        const local = deepCopy(app.state); app.setRevision(local,backedUpRevision);
        if (!app.local.commit(local)) throw new Error('Publication blocked — local saving failed; sync remains paused');
        const res = await s3Request(cfg,'PUT',JSON.stringify(payload),{headers:current ? {'if-match':current.etag} : {'if-none-match':'*'}},ctx);
        if ([409,412].includes(res.status)){
          await readRemoteBackup(cfg,ctx); // fresh information, never automatic replacement
          throw new Error('Cloud changed during publication — choose again; sync remains paused');
        }
        if (!res.ok) throw responseError(res,await res.text(),cfg,'publish local backup');
      } else backedUpRevision = remoteSnapshotTime(app.state);
      const message = direction === 'cloud' ? 'Cloud copy chosen' : direction === 'local' ? 'Local copy published' : 'Up to date';
      markRemoteSuccess(cfg,backedUpRevision,ctx,message + ' — cloud sync paused');
      resumeReviewedSync(ctx);
      const pending = readRemoteWork().pending;
      setRemoteStatus(pending ? 'pending' : 'synced',pending ? 'Newer local changes pending — sync resumed' : message + ' — sync resumed');
      armRemoteRetry();
      toast(direction === 'cloud' ? 'Cloud copy restored — sync resumed' : direction === 'local' ? 'Local copy published — sync resumed' : 'Cloud sync resumed');
    } catch(e){
      if (ctx.generation === remoteGeneration) setRemoteStatus('error',e.message);
      throw e;
    }
  },cfg,false,true));
}
function remoteRestore(){ return remoteReviewChoice('cloud'); }
function remotePublishLocal(){ return remoteReviewChoice('local'); }
function remoteResumeSync(){ return remoteReviewChoice('automatic'); }
async function preserveRemoteSnapshot(cfg,remote,ctx){
  const key = (cfg.objectKey || REMOTE_OBJECT_KEY_DEFAULT) + '.snapshots/' + new Date().toISOString().replace(/[:.]/g,'-') + '-' + uid() + '.json';
  const snapshot = await s3Request({...cfg,objectKey:key},'PUT',remote.raw,{headers:{'if-none-match':'*'}},ctx);
  if (!snapshot.ok) throw responseError(snapshot,await snapshot.text(),cfg,'preserve snapshot');
}
/* Separate backups on a device with only its starting data: nothing is
   uploaded. If the cloud already holds backups for this app, the person is
   asked once per page load whether to restore the newest, browse them, or
   start fresh here. Without backups, the first change saves the first one. */
let offeredScope=null;
const freshKey=app.namespace+'.remote-fresh';
function startedFresh(cfg){try{return localStorage.getItem(freshKey)===scopeKey(cfg);}catch(e){return false;}}
async function offerCloudBackups(cfg){
  const scope=scopeKey(cfg),ask=app.choose||(typeof WorkoutUI==='undefined'?null:WorkoutUI.dialog);
  const waiting='Separate backups enabled — your first change saves this device’s first backup';
  if(offeredScope===scope||startedFresh(cfg)||!ask||toolsBusy){setRemoteStatus('synced',waiting);return;}
  offeredScope=scope;
  setRemoteStatus('checking','Looking for cloud backups…');
  try{await remoteListSnapshots();}catch(e){setRemoteStatus('synced',waiting);return;}
  const items=snapshotIndex?.scope===scope?snapshotIndex.items:[];
  if(!items.length||!pristine()||loadRemoteConfig()&&scopeKey(loadRemoteConfig())!==scope){setRemoteStatus('synced',waiting);return;}
  setRemoteStatus('synced','Cloud backups found — restore one or start fresh on this device');
  const count=items.length===1?'1 backup file':items.length+' backup files';
  const choice=await ask({title:'Cloud backups found',
    body:`The cloud holds ${count} for this app. The newest was saved ${new Date(items[0].at).toLocaleString()}. This device has only its starting data. Restore the newest backup to continue here, browse them to choose another, or start fresh on this device.`,
    buttons:[{label:'Start fresh on this device',value:'fresh'},{label:'Browse backups',value:'browse'},{label:'Restore latest…',value:'restore',cls:'btn-primary',autofocus:true}]});
  if(choice==='fresh'){
    try{localStorage.setItem(freshKey,scope);}catch(e){}
    setRemoteStatus('synced',waiting);toast('Starting fresh. Your first change saves this device’s first cloud backup.');
  }else if(choice==='browse')app.onBrowse?.();
  else if(choice==='restore'){
    // The restore pauses sync for its review; a cancelled review leaves this
    // device as it was, so the pause it made is lifted again.
    const restored=await remoteRestoreSnapshot(items[0].key,false,{latestAt:items[0].at,resume:true}).catch(()=>false);
    if(!restored&&remotePauseInfo()?.code==='snapshot'){try{localStorage.removeItem(REMOTE_PAUSE_KEY);}catch(e){}setRemoteStatus('synced','Cloud backups found — restore one or start fresh on this device');}
  }
  app.onRefresh?.();
}
async function remoteStartupSync(){
  const cfg = loadRemoteConfig();
  if (remoteSyncPaused()){ setRemoteStatus('paused','Local copy protected — cloud sync paused'); return; }
  if (!cfg || !remoteCryptoAvailable()) return;
  if (navigator.onLine === false){ setRemoteStatus('pending','Waiting for a connection'); return; }
  if(syncMode(cfg)==='immutable'){
    // Each device owns its local state. Never select another device's backup
    // by timestamps or silently restore the former single-object backup.
    if(hasData()&&(readRemoteWork()?.pending||cfg.lastBackupMode!=='immutable'||remoteSnapshotTime(app.state)!==cfg.lastUploadedModifiedAt))scheduleRemoteBackup();
    else if(pristine())return offerCloudBackups(cfg);
    else setRemoteStatus('synced','Separate backups enabled — browse cloud backups to restore another device’s copy');
    return;
  }
  return coordinateRemote(async ctx => {
    setRemoteStatus('checking','Checking remote backup…');
    try {
      const expected = localRevisionKey();
      const remote = await readRemoteBackup(cfg,ctx);
      const result = reconcileRemote(remote,expected,ctx);
      if (result === 'upload') scheduleRemoteBackup(0);
      else if (result === 'pristine') setRemoteStatus('synced','Cloud sync on — the cloud is empty; your first change uploads this device’s data');
      else if (['same','restored'].includes(result)) markRemoteSuccess(cfg,remoteSnapshotTime(app.state),ctx,result === 'restored' ? 'Restored from remote' : 'Up to date');
    } catch(e){ retryRemoteError(e,ctx); }
  },cfg).catch(() => {});
}
/* Saves a connection after one read proves the endpoint, keys and bucket;
   the first real backup proves writing. Backup history belongs to the
   destination: new credentials keep it, another bucket, path or mode clears it. */
async function configure(candidate){
  if(!remoteCryptoAvailable())throw new Error('Cloud storage needs HTTPS and Web Crypto.');
  invalidateRemote();validateRemoteConfig(candidate);
  await coordinateRemote(async ctx=>{
    await readRemoteBackup(candidate,ctx);assertRemote(ctx);
    const previous=loadRemoteConfig(),same=previous&&remoteDestination(previous)===remoteDestination(candidate);
    candidate.lastBackupAt=same?previous.lastBackupAt??null:null;
    candidate.lastUploadedModifiedAt=same?previous.lastUploadedModifiedAt??null:null;
    if(same&&previous.lastBackupMode)candidate.lastBackupMode=previous.lastBackupMode;else delete candidate.lastBackupMode;
    saveRemoteConfig(candidate,ctx);
  },candidate,true);
  remoteStartupSync();
}
/* A connection file sets up another device without retyping. It carries
   the secret only when asked, and names the app whose backup path it holds. */
function configPayload(includeSecret=false){
  const cfg=loadRemoteConfig();if(!cfg)throw new Error('Cloud storage is not configured.');
  const result={app:APP_ID,kind:'remote-config',version:1,exportedAt:new Date().toISOString(),
    endpoint:cfg.endpoint,region:cfg.region,bucket:cfg.bucket,objectKey:cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT,
    syncMode:syncMode(cfg),pathStyle:!!cfg.pathStyle,accessKeyId:cfg.accessKeyId};
  if(includeSecret)result.secretAccessKey=cfg.secretAccessKey;
  return result;
}
/* Any app's connection file loads into a draft for review. Its backup path
   applies only when the file came from this app: another app's path is that
   app's own. */
function configDraft(raw){
  WorkoutStorage.enforceLimits(raw,{},64*1024);
  if(!raw||typeof raw!=='object'||raw.kind!=='remote-config')throw new Error('Expected a connection config file.');
  const draft={};
  for(const name of ['endpoint','bucket','accessKeyId']){
    if(typeof raw[name]!=='string'||!raw[name].trim())throw new Error('Missing configuration field: '+name);
    draft[name]=raw[name].trim();
  }
  draft.endpoint=draft.endpoint.replace(/\/+$/,'');
  if(raw.region!=null&&typeof raw.region!=='string')throw new Error('Invalid region.');
  if(raw.pathStyle!=null&&typeof raw.pathStyle!=='boolean')throw new Error('Path-style addressing must be true or false.');
  if(raw.secretAccessKey!=null&&typeof raw.secretAccessKey!=='string')throw new Error('Invalid secret access key.');
  const own=raw.app===APP_ID&&typeof raw.objectKey==='string'&&raw.objectKey.trim();
  draft.region=(raw.region||'').trim();draft.objectKey=own?raw.objectKey.trim():loadRemoteConfig()?.objectKey||REMOTE_OBJECT_KEY_DEFAULT;
  draft.syncMode=syncMode(raw);draft.pathStyle=raw.pathStyle===true;draft.secretAccessKey=(raw.secretAccessKey||'').trim();
  // A file without a region still loads; Check & save asks for one.
  validateRemoteConfig({...draft,region:draft.region||'unset'});
  return draft;
}
function remoteTestConnection(){
  const cfg = loadRemoteConfig(); if (!cfg) return;
  return remoteRunAction(() => coordinateRemote(async ctx => {
    if(syncMode(cfg)==='immutable'){
      const res=await s3Request(cfg,'GET','',{list:{}},ctx);
      if(!res.ok)throw responseError(res,await res.text(),cfg,'list snapshots');
      let page;
      try{page=parseSnapshotList(await res.text(),cfg);}catch(error){throw diagnosticError('listing','Snapshot listing is invalid. Check the provider’s ListObjectsV2 support.',cfg,'list snapshots');}
      assertRemote(ctx);
      toast(page.items.length?'Backup listing readable — write permission unverified':'Backup listing readable; no separate backups yet — write permission unverified');
      return;
    }
    const remote = await readRemoteBackup(cfg, ctx); assertRemote(ctx);
    toast(remote ? 'Backup readable — write permission unverified' : 'Object missing — write permission unverified');
  },cfg,false,true));
}
async function toolsAction(cfg,action){
  if(toolsBusy)throw new Error('A storage check is already running.');
  toolsBusy=true;app.onBusy?.(true);toolsChanged();
  try{return await coordinateRemote(action,cfg,false,true);}
  catch(error){toast(error.message||'Storage operation failed.');throw error;}
  finally{toolsBusy=false;app.onBusy?.(false);toolsChanged();}
}
function configured(){const cfg=loadRemoteConfig();if(!cfg)throw new Error('Configure storage first.');validateRemoteConfig(cfg);return cfg;}
async function remoteCheckProvider(){
  const cfg=configured(),wasPaused=remoteSyncPaused(),previouslyUnsafe=unsafeProvider();
  if(toolsBusy)throw new Error('A storage check is already running.');
  pauseRemoteSync('Cloud sync paused while checking provider compatibility',{code:'provider',keep:true});
  return toolsAction(cfg,async ctx=>{
    const key=(cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT)+'.checks/'+uid()+'.json',probe={...cfg,objectKey:key};
    validateRemoteConfig(probe);probeKeys.add(key);
    const report={at:new Date().toISOString(),browserAccess:'unknown',read:'unknown',write:'unknown',etag:'unknown',ifNoneMatch:'unknown',ifMatch:'unknown',matchedWrite:'unknown',cleanup:'not-needed',remainingProbeKeys:[]};
    let touched=false;
    const request=(method,body='',headers={})=>s3Request(probe,method,body,{headers},ctx);
    try{
      const missing=await request('GET'),missingText=await missing.text();
      report.browserAccess='passed';
      if(missing.status!==404||!/<(?:\w+:)?Code>NoSuchKey<\/(?:\w+:)?Code>/.test(missingText))throw responseError(missing,missingText,cfg,'read probe');
      const first=JSON.stringify({kind:'storage-compatibility-probe',value:uid()}),second=JSON.stringify({kind:'storage-compatibility-probe',value:uid()});
      touched=true;
      const create=await request('PUT',first,{'if-none-match':'*'});
      if(!create.ok)throw responseError(create,await create.text(),cfg,'create probe');
      report.write='passed';
      const read=await request('GET');if(!read.ok)throw responseError(read,await read.text(),cfg,'read probe');
      if(await read.text()!==first)throw diagnosticError('read-back','The provider did not return the uploaded probe unchanged.',cfg,'read probe');
      report.read='passed';
      let etag=read.headers.get('etag');report.etag=etag&&/^"[^"\r\n]+"$/.test(etag)?'passed':'failed';
      const duplicate=await request('PUT',second,{'if-none-match':'*'});
      report.ifNoneMatch=duplicate.status===412?'passed':duplicate.ok?'failed':'unknown';
      if(!duplicate.ok&&duplicate.status!==412)report.error=responseError(duplicate,await duplicate.text(),cfg,'create-only check').diagnostic;
      const wrong=await request('PUT',second,{'if-match':'"missing-'+uid()+'"'});
      report.ifMatch=wrong.status===412?'passed':wrong.ok?'failed':'unknown';
      if(!wrong.ok&&wrong.status!==412)report.error=responseError(wrong,await wrong.text(),cfg,'stale-version check').diagnostic;
      if(report.etag==='passed'){
        const current=await request('GET');if(!current.ok)throw responseError(current,await current.text(),cfg,'read probe');
        etag=current.headers.get('etag');
        if(!etag||!/^"[^"\r\n]+"$/.test(etag))throw diagnosticError('etag','Expose ETag in bucket CORS before verifying versioned uploads.',cfg,'read probe');
        const updatedBody=await current.text()===first?second:first;
        const update=await request('PUT',updatedBody,{'if-match':etag});
        report.matchedWrite=update.ok?'passed':'failed';
        if(!update.ok)report.error=responseError(update,await update.text(),cfg,'matched-version check').diagnostic;
        if(update.ok){const verify=await request('GET');if(!verify.ok||await verify.text()!==updatedBody)report.matchedWrite='failed';}
      }else report.error=diagnosticError('etag','ETag is not exposed. Add ETag to bucket CORS ExposeHeaders and preserve it in the proxy.',cfg,'provider check').diagnostic;
    }catch(error){
      assertRemote(ctx);
      report.error=error.diagnostic||{category:'check',message:'Provider check could not complete. Check your connection and bucket configuration.'};
    }finally{
      if(touched){
        try{
          // eslint-disable-next-line no-unsafe-finally -- Cleanup errors are caught below; cancellation is preserved.
          assertRemote(ctx);const cleanup=await request('DELETE');if(!cleanup.ok)throw responseError(cleanup,await cleanup.text(),cfg,'cleanup probe');
          const gone=await request('GET');
          // eslint-disable-next-line no-unsafe-finally -- This throw records failed cleanup in the local catch, without replacing a pending error.
          if(gone.status!==404||!/<(?:\w+:)?Code>NoSuchKey<\/(?:\w+:)?Code>/.test(await gone.text()))throw new Error('Probe cleanup could not be verified.');
          report.cleanup='passed';
        }
        catch(error){report.cleanup='failed';report.remainingProbeKeys=[key];report.cleanupMessage='Temporary probe could not be removed. Allow DELETE in CORS and grant object-delete permission, then remove the listed probe key.';}
      }
      probeKeys.delete(key);
    }
    assertRemote(ctx);
    const writeProtectionPassed=['ifNoneMatch','ifMatch','matchedWrite'].every(name=>report[name]==='passed');
    report.overwriteProtection=report.ifNoneMatch==='failed'||report.ifMatch==='failed'||previouslyUnsafe&&!writeProtectionPassed?'failed':writeProtectionPassed?'passed':'unknown';
    if(previouslyUnsafe&&!writeProtectionPassed)report.protectionMessage='Previously failed overwrite protection has not been reverified. Cloud writes remain blocked.';
    report.mode=syncMode(cfg);
    report.compatible=(report.mode==='immutable'?['browserAccess','read','write','etag']:['browserAccess','read','write','etag','ifNoneMatch','ifMatch','matchedWrite']).every(name=>report[name]==='passed');
    if(report.mode==='immutable')report.protectionMessage='Separate backups use new random file names. Failed overwrite checks do not prevent this mode; cloud copies are restored explicitly.';
    providerMemory={scope:scopeKey(cfg),report};
    try{localStorage.setItem(providerKey,JSON.stringify(providerMemory));}catch(error){report.persistenceMessage='This check result could not be saved. Sync remains paused.';}
    if(report.compatible&&!wasPaused&&!report.persistenceMessage){resumeReviewedSync(ctx);armRemoteRetry();}
    setRemoteStatus(remoteSyncPaused()?'paused':'synced',report.compatible?'Provider checks passed'+(remoteSyncPaused()?' — review before resuming sync':''):unsafeProvider()?'Overwrite protection failed or has not been reverified — cloud sync stays paused':'Provider check incomplete — cloud sync stays paused');
    toolsChanged();return deepCopy(report);
  });
}
function handoffConfig(cfg,code){
  if(typeof code!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code))throw new Error('Enter a valid handoff code.');
  return {...cfg,objectKey:(cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT)+'.handoffs/'+code+'.json'};
}
async function remoteUploadHandoff(payload){
  const cfg=configured(),target=handoffConfig(cfg,payload.id),raw=JSON.stringify(payload);
  enforceBackupLimits(payload.backup);
  return toolsAction(cfg,async ctx=>{
    archiveKeys.add(target.objectKey);
    try{
      const res=await s3Request(target,'PUT',raw,{headers:{'if-none-match':'*'}},ctx);
      if(!res.ok&&res.status!==412)throw responseError(res,await res.text(),cfg,'upload handoff');
      const check=await s3Request(target,'GET','',{},ctx);
      if(!check.ok)throw responseError(check,await check.text(),cfg,'verify handoff');
      if(await check.text()!==raw)throw new Error('Handoff could not be verified. Keep the source workout paused and retry.');
      assertRemote(ctx);return payload.id;
    }finally{archiveKeys.delete(target.objectKey);}
  });
}
async function remoteReadHandoff(code){
  const cfg=configured(),target=handoffConfig(cfg,code);
  return toolsAction(cfg,async ctx=>{
    const res=await s3Request(target,'GET','',{},ctx);
    if(!res.ok)throw responseError(res,await res.text(),cfg,'read handoff');
    const raw=await res.text();assertRemote(ctx);
    let payload;try{payload=JSON.parse(raw);}catch(error){throw new Error('Handoff is not valid JSON.');}
    if(payload.id!==code)throw new Error('Handoff code does not match the transferred file.');
    return payload;
  });
}
function snapshotPrefix(cfg){return (cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT)+'.snapshots/';}
function snapshotConfig(cfg,key){
  if(typeof key!=='string'||!key.startsWith(snapshotPrefix(cfg))||key===snapshotPrefix(cfg))throw new Error('Snapshot is outside this app’s backup prefix.');
  const result={...cfg,objectKey:key};validateRemoteConfig(result);return result;
}
function parseSnapshotList(raw,cfg){
  if(typeof DOMParser!=='function'||/<!DOCTYPE|<!ENTITY/i.test(raw))throw new Error('Invalid snapshot listing XML.');
  const doc=new DOMParser().parseFromString(raw,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||doc.documentElement.localName!=='ListBucketResult')throw new Error('Invalid snapshot listing XML.');
  const text=(node,name)=>Array.from(node.children).find(child=>child.localName===name)?.textContent||'';
  const contents=Array.from(doc.getElementsByTagNameNS('*','Contents'));if(contents.length>1000)throw new Error('Snapshot listing exceeds its page limit.');
  const items=contents.map(node=>{
    const key=text(node,'Key');snapshotConfig(cfg,key);
    const size=Number(text(node,'Size')),at=text(node,'LastModified');
    if(!Number.isSafeInteger(size)||size<0||!Number.isFinite(Date.parse(at)))throw new Error('Invalid snapshot metadata.');
    return {key,size,at};
  });
  const truncated=text(doc.documentElement,'IsTruncated');
  if(!['true','false'].includes(truncated))throw new Error('Invalid snapshot pagination.');
  const token=truncated==='true'?text(doc.documentElement,'NextContinuationToken'):null;
  if(truncated==='true'&&(!token||token.length>8192))throw new Error('Snapshot continuation token is missing or invalid.');
  return {items,token};
}
async function remoteListSnapshots(next=false){
  const cfg=configured(),scope=scopeKey(cfg),previous=next&&snapshotPage?.scope===scope?snapshotPage:null;
  if(next&&(!previous||!snapshotIndex||snapshotIndex.scope!==scope))throw new Error('Reload the snapshot list first.');
  if(next===true&&!previous.token)throw new Error('There is no next snapshot page.');
  return toolsAction(cfg,async ctx=>{
    let offset=0;
    if(next){offset=next==='previous'?Math.max(0,previous.offset-20):previous.offset+20;}
    else {
      // S3 lists by key ascending. Read metadata across every provider page
      // before showing the newest backups, without downloading their bodies.
      const items=new Map(),tokens=new Set();let token=null;
      do {
        const res=await s3Request(cfg,'GET','',{list:{token,max:1000}},ctx);
        if(!res.ok)throw responseError(res,await res.text(),cfg,'list snapshots');
        let page;try{page=parseSnapshotList(await res.text(),cfg);}catch(error){throw diagnosticError('listing','Snapshot listing is invalid. Check the provider’s ListObjectsV2 support.',cfg,'list snapshots');}
        for(const item of page.items)items.set(item.key,item);
        if(items.size>100000)throw diagnosticError('listing','Too many snapshots to browse. Reduce retained backup files and reload the list.',cfg,'list snapshots');
        token=page.token;
        if(token&&tokens.has(token))throw diagnosticError('listing','The provider repeated its pagination token. Reload the snapshot list.',cfg,'list snapshots');
        if(token)tokens.add(token);
        if(tokens.size>1000)throw diagnosticError('listing','Snapshot listing did not finish. Check the provider’s pagination and reload.',cfg,'list snapshots');
      }while(token);
      assertRemote(ctx);
      snapshotIndex={scope,items:[...items.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.key.localeCompare(a.key))};
    }
    const total=snapshotIndex.items.length;
    snapshotPage={scope,offset,total,items:snapshotIndex.items.slice(offset,offset+20),token:offset+20<total?String(offset+20):null};
    toolsChanged();return deepCopy(snapshotPage);
  });
}
function snapshotSummary(snapshot){
  return {...(app.summarizeBackup?.(snapshot.candidate)||{records:0,recordLabel:'records',hasActive:false}),revision:snapshot.at,
    exportedAt:typeof snapshot.obj.exportedAt==='string'&&Number.isFinite(Date.parse(snapshot.obj.exportedAt))?snapshot.obj.exportedAt:null};
}
async function remotePreviewSnapshot(key){
  const cfg=configured();snapshotConfig(cfg,key);
  return toolsAction(cfg,async ctx=>{
    const saved=await readRemoteBackup(snapshotConfig(cfg,key),ctx);if(!saved)throw diagnosticError('missing-object','Snapshot no longer exists. Reload the list.',cfg,'preview snapshot');
    const summary=snapshotSummary(saved),item=snapshotPage?.scope===scopeKey(cfg)&&snapshotPage.items.find(row=>row.key===key);
    if(item)item.summary=summary;toolsChanged();return summary;
  });
}
async function remoteDownloadSnapshot(key){
  const cfg=configured(),target=snapshotConfig(cfg,key);
  return toolsAction(cfg,async ctx=>{const res=await s3Request(target,'GET','',{},ctx);if(!res.ok)throw responseError(res,await res.text(),cfg,'download snapshot');return {raw:await res.text(),name:key.slice(snapshotPrefix(cfg).length).split('/').pop()};});
}
/* Lists every backup file, then restores the newest after the usual
   confirmation and resumes backups. Listing and restore errors are toasted
   by toolsAction; the checks here toast their own. */
async function remoteRestoreLatest(){
  const cfg=configured();
  if(syncMode(cfg)!=='immutable'){toast('Latest-backup restore applies to separate backup files.');return false;}
  if(app.isActive()){toast('Finish or end the saved workout before restoring a cloud backup.');return false;}
  await remoteListSnapshots();
  const latest=snapshotIndex?.scope===scopeKey(cfg)?snapshotIndex.items[0]:null;
  if(!latest){toast('No cloud backups found yet. Resume backups to create the first one.');return false;}
  return remoteRestoreSnapshot(latest.key,false,{latestAt:latest.at,resume:true});
}
async function remoteRestoreSnapshot(key,legacy=false,options={}){
  const cfg=configured();
  // Legacy recovery is a separate explicit action; arbitrary keys remain out
  // of scope even when a caller passes the legacy flag.
  if(legacy){if(key!==(cfg.objectKey||REMOTE_OBJECT_KEY_DEFAULT))throw new Error('Invalid legacy backup path');}
  else snapshotConfig(cfg,key);
  if(toolsBusy)throw new Error('A storage check is already running.');
  if(app.isActive())throw new Error('Finish or end the saved workout before restoring a snapshot.');
  pauseRemoteSync('Cloud sync paused for snapshot recovery',{code:'snapshot'});
  return toolsAction(cfg,async ctx=>{
    const expected=localRevisionKey(),target=legacy?cfg:snapshotConfig(cfg,key),saved=await readRemoteBackup(target,ctx);
    if(!saved)throw diagnosticError('missing-object',legacy?'No legacy backup exists at this path. Browse separate cloud backups instead.':'Snapshot no longer exists. Reload the list.',cfg,'restore snapshot');
    const summary=snapshotSummary(saved);
    const confirmed=options.resume
      ?await confirmDlg('Restore latest cloud backup?',`The backup saved ${new Date(options.latestAt).toLocaleString()} holds ${summary.records} ${summary.records===1?summary.recordLabel.replace(/s$/,''):summary.recordLabel}. It replaces this device’s data and settings. A local recovery copy is saved, then backups resume.`,'Restore & resume',true)
      :await confirmDlg('Restore cloud snapshot?',`${summary.records} ${summary.recordLabel} will replace this device’s data and settings. A local recovery copy is saved. The cloud backup is unchanged and sync stays paused until you review the copies.`, 'Restore locally',true);
    if(!confirmed)return false;
    assertRemote(ctx);
    if(expected!==localRevisionKey()||app.isActive())throw new Error('Local data changed during review. Snapshot restore cancelled.');
    const current=await readRemoteBackup(target,ctx);
    if(!current||current.etag!==saved.etag||current.raw!==saved.raw)throw new Error('Snapshot changed during review. Reload and choose again.');
    if(expected!==localRevisionKey()||app.isActive())throw new Error('Local data changed during review. Snapshot restore cancelled.');
    const candidate=deepCopy(saved.candidate);
    app.setRevision(candidate,Math.max(Date.now(),remoteSnapshotTime(app.state)+1,saved.at+1));
    if(!commitSnapshot(candidate))throw new Error('Snapshot restore could not be saved. Previous data retained.');
    scheduleRemoteBackup();
    if(options.resume){
      // The restored data is a new local revision; resumed backups save it as a new file.
      resumeReviewedSync(ctx);armRemoteRetry();
      setRemoteStatus('pending','Latest cloud backup restored — backups resumed');toast('Latest cloud backup restored — backups resumed');
    }else setRemoteStatus('paused','Snapshot restored locally — cloud sync stays paused');
    toolsChanged();return true;
  });
}
return {remoteUploadHandoff,remoteReadHandoff,syncMode,remoteRestoreLegacy,appendRemoteBackup,remoteCheckProvider,remoteListSnapshots,remotePreviewSnapshot,remoteDownloadSnapshot,remoteRestoreSnapshot,remoteRestoreLatest,remoteTools,diagnosticsPayload,remoteSyncPaused,remotePauseInfo,pauseRemoteSync,pauseRemoteSyncAction,resumeReviewedSync,enforceBackupLimits,remoteDestination,remoteIdentity,invalidateRemote,assertRemote,coordinateRemote,readRemoteWork,writeRemoteWork,validateRemoteConfig,loadRemoteConfig,saveRemoteConfig,clearRemoteConfig,connectionScope,sharedConnection,useSharedConnection,get defaultObjectKey(){return REMOTE_OBJECT_KEY_DEFAULT;},remoteCryptoAvailable,toHex,sha256Hex,hmacRaw,signingKey,amzNow,uriEncode,remoteUrl,s3Request,remoteRunAction,scheduleRemoteBackup,armRemoteRetry,retryRemoteError,readRemoteBackup,preserveBeforeRemoteRestore,commitSnapshot,installRemoteSnapshot,markRemoteSuccess,reconcileRemote,putRemoteBackup,autoRemoteBackup,remoteBackup,reviewedRemoteDirection,remoteReviewChoice,remoteRestore,remotePublishLocal,remoteResumeSync,preserveRemoteSnapshot,remoteStartupSync,remoteTestConnection,configure,configPayload,configDraft,get generation(){return remoteGeneration;},get queue(){return remoteQueue;},get controllers(){return remoteControllers;},flushScheduled(){if(remoteBackupTimer){clearTimeout(remoteBackupTimer);remoteBackupTimer=0;return autoRemoteBackup();}}};
};
