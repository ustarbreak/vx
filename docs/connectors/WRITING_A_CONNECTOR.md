# Writing an Infracentra connector

## Contract

A connector adapts a real external service or an existing native Infracentra
engine. It must not invent operational data. If a feature is unavailable,
report an explicit unsupported or not-configured state.

Each provider exposes:
- probe(): bounded liveness check; never expose credentials in errors.
- fetch_detections(limit): normalized Detection records with org_id, catalog
  service_id, source, severity, timestamp, and raw evidence.
- execute(action, params, dry_run): only actions genuinely implemented;
  return JobState.unsupported otherwise.

## Registering a provider

1. Add a module under backend/app/platform/connectors/providers/.
2. Subclass ConnectorProvider and implement the read methods.
3. Declare a stable Manifest and decorate the class with @register.
4. Add a matching module.manifest.yaml. Its id, service_id, and module must
   match the Python manifest.
5. Add offline tests for healthy, unavailable, unsupported, and tenant-scoped
   behavior.
6. Resolve providers through app.platform.connectors.registry.registry.
   Discovery imports modules but does not call external services.

## Security requirements

- org_id is the tenant/client key. Scope every database query and job lookup
  to the authenticated user's org_id; never accept caller-selected ownership.
- Use guardrails.check() before actions. Dangerous operations require platform
  administrator authorization, a distinct second platform administrator,
  and explicit confirmation.
- Dry-run must be side-effect free.
- Use the shared transport helper and honor TLS settings.
- Redact tokens, passwords, and sensitive payloads from logs and errors.
- Never turn an unavailable connector into fabricated detections or success.

## Testing

From backend/, run pytest tests/test_connector_registry.py -q, then the full
backend suite and frontend CI. A connector is not production verified until
its external service passes its own verify.sh first-success check on a target
host.
