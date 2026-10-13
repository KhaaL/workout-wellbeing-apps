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
