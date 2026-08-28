import { Schema } from "effect"

export class ApprovalLimits extends Schema.Class<ApprovalLimits>("ApprovalLimits")({
  poCreateMaxValue: Schema.Number
}) {}

export class Principal extends Schema.Class<Principal>("Principal")({
  userId: Schema.String,
  name: Schema.String,
  role: Schema.String,
  managerId: Schema.optional(Schema.String),
  backupApproverId: Schema.optional(Schema.String),
  scopes: Schema.Array(Schema.String),
  approvalLimits: ApprovalLimits
}) {}

export const hasScope = (principal: Principal, scope: string) => principal.scopes.includes(scope)
