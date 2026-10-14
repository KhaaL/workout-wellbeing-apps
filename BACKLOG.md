# Backlog

Audit follow-ups completed on 2026-10-13. Live bucket configuration and app
deployment are separate operational steps documented in `STORAGE.md`.

## 3. Generic S3 CORS helper and storage guide — completed

- `scripts/s3-cors.py` explicitly allows signed-request headers, requires the
  app origins as input, preserves unrelated rules and saves rollback XML.
- `STORAGE.md` covers generic S3-compatible configuration and verification using
  reserved example domains. No instance-specific infrastructure notes belong here.
- Generated rules are verified through both apps' signed browser requests and
  CORS responses in isolated tests.

## 6. Incremental module extraction — first pass completed

- Bike targets, workout timing, HR interpretation and Bluetooth connection
  lifecycle now have canonical source modules.
- Liftlog's storage policy adapter and Settings templates now have separate
  modules. Settings receives fresh state and explicit helpers on every render.
- The build embeds modules into the existing standalone outputs and checks
  marker integrity. CSP generation and offline versioning still cover all code.
- Lint covers extracted code; migration, storage, recovery and mobile checks
  retain their existing coverage. Old migrations and recovery paths remain.

## Controller and storage-summary pass — completed

- Liftlog workout/set actions, routine/plan editing and exercise-library actions
  have separate controllers. Live context getters follow restored state and UI.
- Bike storage controls, recovery copies and device diagnostics are extracted.
- Both apps share a storage summary and next-action model. Detailed controls
  remain expandable. Local failures take priority over successful cloud writes.
- Build, lint, state-replacement and browser checks cover the new modules.

## Future extraction candidates

- Liftlog workout, history, exercise and routine templates remain inline, along
  with history actions and event routing. Extract those in bounded passes.
- Bike workout UI orchestration and history editing still live in the HTML;
  timing, data validation and Bluetooth already have separate modules.
- Keep schema migrations beside their validation contract until a dedicated
  schema-module extraction can be reviewed independently.
