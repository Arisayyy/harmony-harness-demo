import { Schema } from "effect"

export class EvidenceSnapshot extends Schema.Class<EvidenceSnapshot>("EvidenceSnapshot")({
  provider: Schema.Literal("erp", "mail", "calendar", "policy", "tool", "workflow"),
  sourceId: Schema.String,
  observedAt: Schema.String,
  payload: Schema.Unknown
}) {}

export class AuditEvent extends Schema.Class<AuditEvent>("AuditEvent")({
  eventId: Schema.String,
  runId: Schema.String,
  traceId: Schema.String,
  eventType: Schema.String,
  actor: Schema.String,
  effectiveUserId: Schema.optional(Schema.String),
  occurredAt: Schema.String,
  evidence: Schema.Array(EvidenceSnapshot),
  data: Schema.Unknown
}) {}
