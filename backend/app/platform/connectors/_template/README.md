# Connector provider template

Copy this directory or the flat-module example to create a provider.

- Implement probe() and fetch_detections(limit) without fabricating live data.
- Return JobState.unsupported for actions that are not implemented.
- Use org_id as the tenant/client key; never introduce tenant_id.
- Declare a stable Manifest and matching YAML manifest.
- Guard destructive actions with guardrails.check() and explicit confirmation.
- Route outbound HTTP through the shared connector transport helper.
- Add offline tests for unavailable, malformed, and cross-tenant cases.
- Never register a mock provider as a fallback for a real connector.

See docs/connectors/WRITING_A_CONNECTOR.md.
