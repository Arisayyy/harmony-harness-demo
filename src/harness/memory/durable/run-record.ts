import { Schema } from "effect"

export class RunRecord extends Schema.Class<RunRecord>("RunRecord")({
  runId: Schema.String,
  attentionId: Schema.String,
  traceId: Schema.String,
  principalId: Schema.String,
  plannerResultJson: Schema.String,
  recommendationJson: Schema.String,
  evidenceJson: Schema.String,
  gateJson: Schema.optional(Schema.String),
  approvalId: Schema.optional(Schema.String),
  status: Schema.Literals(["completed", "pending_approval", "executing", "failed"]),
  outcomeJson: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String
}) {}
