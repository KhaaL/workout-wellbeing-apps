# Public repository policy

- Keep all source, documentation, comments, examples, fixtures and generated
  artifacts free of personal infrastructure details.
- Do not include actual service/vendor choices used by the owner, private host
  names, endpoints, network topology, bucket/account identifiers, key names,
  credentials, machine names or instance-specific operational notes.
- Describe storage through generic S3-compatible interfaces and capabilities.
  Use reserved example domains and synthetic configuration in documentation
  and tests. Require deployment-specific values as explicit user input.
- Keep instance-specific runbooks and configuration outside this repository.
- Provider selection belongs to device-local configuration; public code must
  not infer or advertise the owner's infrastructure.
- Generic setup instructions and capability-based compatibility support are
  appropriate when they do not describe an actual deployment.

# Cross-app consistency

- Shared flows live in `packages/`: storage status, backups and cloud
  storage, the shared connection, earlier backups, troubleshooting, device
  storage, appearance and updates. Apps mount these components and never
  rebuild them. A change to a shared flow lands in every app in the same
  change, with a browser test covering all apps.
- Backups & cloud storage is `WorkoutStorage.createStoragePanel` in
  `packages/storage-ui/panel.js`. Apps pass data and wording (what a backup
  holds, how to restore, the app name), never markup.
- Settings order: storage status; app preferences; Appearance; Backups &
  cloud storage; app data files, if any; Move to another device (apps with
  resumable sessions); App updates; Advanced & destructive actions.
- One vocabulary: "Separate backup files", "Conditional sync", "Back up
  now", "Pause cloud backups" (separate files) or "Pause cloud sync"
  (conditional), "Download full backup", "Restore from file", "Check & save
  connection", "Forget connection…", "App updates".
- A setting with one value saves on change. A form whose fields are
  validated together uses an explicit Save with a status line. Destructive
  actions in Settings confirm first, keep a recovery copy and sit under
  Advanced & destructive actions.
- Markup: one h1 "Settings". Section titles use the names in the order
  above. Developer diagnostics stay collapsed and sit outside preference
  sections.
- Removing a feature in one app removes it in every app.
- Before finishing UI work in one app, check the same flow in the other
  apps. Explain any new deviation from this order or vocabulary in the
  PR description.
