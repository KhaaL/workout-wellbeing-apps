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

## Future extraction candidates

- Liftlog workout, history, exercise and routine templates/controllers remain
  inline. Move these in small passes using the Settings module boundary.
- Keep schema migrations beside their validation contract until a dedicated
  schema-module extraction can be reviewed independently.
