# Usage metering API

Infracentra keeps commercial pricing in `app.services.pricing_engine`. Usage events
are append-only facts and never contain calculated prices.

## Event contract

Authenticated platform operators can post `POST /api/usage/events`. Tenant
agents can post `POST /api/usage/agent-events` with their scoped `icag_`
agent token. The tenant organization is taken from the authenticated principal
or token, never from an agent request body.

Supported metrics and units:

| Metric | Unit | Meaning |
|---|---|---|
| `endpoints` | `endpoint` | Billable endpoint usage quantity |
| `seats` | `seat` | Billable seat usage quantity |
| `siem_gb` | `GB` | SIEM ingestion volume |
| `backup_gb` | `GB` | Backup storage/transfer volume |

Every event must include a source and a stable idempotency key. Replaying the
same key for the same organization returns the original event and does not
double-count it. Events are immutable; corrections should be represented by a
separate adjustment event with a new key and a traceable source.

Partner billing converts the monthly SIEM GB total to an average GB/day for the
existing graduated SIEM rate table. Backup billing uses the highest recorded
backup GB snapshot for the period (not the sum of snapshots). Endpoint and seat
quantities remain additive usage facts for reporting; contractual ceilings are
read from the organization/plan records.

## Reading usage

`GET /api/usage/summary?period=YYYY-MM` returns the current tenant's recorded
usage, contractual ceilings from the existing Organization/plan records, and
the timestamp of the latest event. Platform administrators must specify
`org_id`; tenant users cannot query another organization.

A metric without events is returned as unavailable (not zero). This is
intentional: the endpoint does not invent telemetry when an integration has not
yet been wired to emit that usage type.

## Production rollout

1. Configure each trusted meter (agent, SIEM/OpenSearch, backup platform) to
   send one stable event per billing interval or usage increment.
2. Keep agent tokens scoped to the owning organization and rotate/revoke them
   through the Agent Tokens UI.
3. Reconcile metered totals against source-system usage before enabling any
   automatic overage invoice.
4. Do not calculate or persist prices in this API; quote and invoice amounts
   continue to come from the versioned pricing engine and partner billing APIs.
