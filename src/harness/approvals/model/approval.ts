import { Schema } from "effect"

export class ApprovalDecision extends Schema.Class<ApprovalDecision>("ApprovalDecision")({
  decision: Schema.Literals(["approved", "rejected"]),
  reviewerId: Schema.String,
  reason: Schema.optional(Schema.String),
  decidedAt: Schema.String
}) {}

export class ApprovalRecord extends Schema.Class<ApprovalRecord>("ApprovalRecord")({
  approvalId: Schema.String,
  runId: Schema.String,
  effectiveUserId: Schema.String,
  requestedApproverId: Schema.String,
  assignedApproverId: Schema.String,
  planHash: Schema.String,
  planJson: Schema.String,
  policyReason: Schema.String,
  status: Schema.Literals(["pending", "approved", "rejected"]),
  decision: Schema.optional(Schema.Literals(["approved", "rejected"])),
  reviewerId: Schema.optional(Schema.String),
  reviewerReason: Schema.optional(Schema.String),
  createdAt: Schema.String,
  resolvedAt: Schema.optional(Schema.String)
}) {}
