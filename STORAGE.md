# S3-compatible remote backups

## App configuration

Enter the connection once, in any app's Settings → cloud storage. Apps served
from one site share it; each app backs up to its own object path.

| Field | Example / requirement |
|---|---|
| Endpoint | `https://storage.example.org` — HTTPS origin, no bucket/path/query |
| Region | Provider's signing region |
| Bucket | A private bucket you have permission to access |
| Object path: Liftlog | `liftlog-backup.json` |
| Object path: Bike Cardio | `bike-cardio-backup.json` |
| Object path: Tabata | `tabata-backup.json` |
| Object path: Foodlog | `foodlog-backup.json` |
| Access key ID / secret | A matching pair authorized for the bucket |
| Addressing | Path-style or virtual-hosted style, as required by the provider |
| Backup mode | Automatic uses separate files; conditional sync is an explicit choice |

All apps share the bucket using distinct object paths. The key must allow
object read/write and bucket listing for snapshot browsing. Provider-check probe
cleanup additionally needs object deletion. Manage permissions using the
provider's administration tools; use a management credential for CORS updates.

Browsers send signed requests directly to the configured endpoint. Network and
TLS access must work on every device. Credentials remain in the browser profile
and are excluded from workout backups.

## CORS configuration

Allow each app's exact origin with GET, PUT and DELETE; expose `ETag`; explicitly
allow `authorization`, `content-type`, `x-amz-content-sha256`, `x-amz-date`,
`if-match` and `if-none-match`. Origins have no path or trailing slash. When the
apps are served from one site (`https://apps.example.org/liftlog/` and so on),
that site's single origin covers all three; the example below lists separate
origins for apps on separate hosts.

The helper requires explicit origins, preserves unrelated rules and saves
rollback XML. Examples below use reserved domains and a placeholder bucket;
replace them with your own configuration before running commands.

With Python 3, `uv` and an existing s3cmd profile:

```sh
task_bucket='your-backup-bucket'
task_profile="$HOME/.config/s3cmd/storage.s3cfg"
task_cors_dir=$(mktemp -d /tmp/s3-cors.XXXXXX)
uvx s3cmd@2.4.0 -c "$task_profile" info "s3://$task_bucket" > "$task_cors_dir/info.txt"
python3 scripts/s3-cors.py "$task_cors_dir/info.txt" "$task_cors_dir/cors.xml" \
  --origin https://liftlog.example.org \
  --origin https://bike.example.org \
  --origin https://tabata.example.org
cat "$task_cors_dir/cors.xml"
```

Apply the reviewed file and inspect the result:

```sh
uvx s3cmd@2.4.0 -c "$task_profile" setcors "$task_cors_dir/cors.xml" "s3://$task_bucket"
uvx s3cmd@2.4.0 -c "$task_profile" info "s3://$task_bucket"
```

Verify each configured origin with the browser's request headers:

```sh
task_endpoint='https://storage.example.org'
curl --silent --show-error --include --request OPTIONS \
  "$task_endpoint/$task_bucket/liftlog-backup.json" \
  --header 'Origin: https://liftlog.example.org' \
  --header 'Access-Control-Request-Method: PUT' \
  --header 'Access-Control-Request-Headers: authorization,content-type,x-amz-content-sha256,x-amz-date,if-match,if-none-match'
```

This example uses path-style addressing. Adapt the URL for virtual-hosted
addressing. Repeat with each app's origin/path. Expect a successful
preflight, the requesting origin, allowed headers/methods and exposed `ETag`.

Rollback:

```sh
uvx s3cmd@2.4.0 -c "$task_profile" setcors "$task_cors_dir/cors.before.xml" "s3://$task_bucket"
```

If the saved information originally reported `CORS: none`, use `delcors` instead
of applying an empty rule set.

## Verify and use backups

1. Save the connection in each app with its own object path.
2. Test the connection with **Test read access** under Connection. It checks
   reading and listing only; it does not verify writes.
3. Run the provider check under Troubleshooting for upload, read-back and
   compatibility results.
4. Review local data, resume backups if paused, then use Back up now.
5. Browse earlier cloud backups and confirm the uploaded backup exists.

Separate backups use `<object-path>.snapshots/<timestamp>-<UUID>.json`. The base
object may be absent. Devices retain local data until you explicitly restore a
chosen backup. Restores and history clearing leave uploads paused for review.
Finish any saved workout before restoring. Liftlog's resume dialog can restore
the newest backup file directly. No app restores a legacy base object; browse
earlier cloud backups instead.

Conditional sync updates one shared object and requires enforced write
conditions. Verify provider compatibility before selecting it. Retain downloaded
backups; snapshots accumulate without automatic retention/deletion.

## Explicit workout handoff

1. On the source, open Settings → Move workout to another device → Prepare.
   Preparation pauses the workout and uploads. Confirm to hold it here.
2. Download the handoff file and transfer it, or choose Save handoff to cloud.
   Cloud codes need the same endpoint, bucket and app object path on both devices.
3. On the recipient, finish/discard any saved workout first. Receive the file or
   enter the code; review and confirm. Existing finished history is retained and
   a recovery copy is saved. Liftlog requires matching weight units and compatible
   referenced exercises/routines; bodyweight baselines must also agree when used.
4. Review the paused workout, reconnect any sensor and resume manually. Transfer
   time does not advance the Bike timer or restart a Liftlog rest timer.
5. After finishing elsewhere, cancel the source hold and discard its stale paused
   workout. Do not finish it a second time. Use history import/merge to bring the
   finished record back if needed. Review cloud backup controls on the recipient
   and explicitly resume backups; receipt keeps them paused.

Handoff files contain workout data and referenced definitions, never credentials.
Cloud handoffs use `<object-path>.handoffs/<UUID>.json`, require GET/PUT on that
prefix, and are read back before upload success is reported. Files accumulate;
there is no automatic expiration. A hold protects the source browser profile;
it is not a global lease. Keep the source paused and receive on one device only.
Cancel does not revoke previously shared files or cloud codes.

## Troubleshooting

| Symptom | Check |
|---|---|
| Network/CORS failure | Network access, HTTPS, exact origin, allowed headers and browser permissions |
| Signature rejected | Matching key/secret, region, endpoint, addressing and device clock |
| Key rejected | Key validity and bucket authorization |
| Listing/upload denied | Bucket read/write permissions |
| Missing ETag | CORS exposure and endpoint response headers |
| Empty snapshot listing | Object path, paused state and last completed backup |
