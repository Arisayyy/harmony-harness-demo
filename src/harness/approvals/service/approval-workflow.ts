import { Effect, Layer, Schema } from "effect"
import { Activity, DurableDeferred, Workflow } from "effect/unstable/workflow"
import { ApprovalDecision, ApprovalRecord } from "../model/approval"
import { ApprovalRepository } from "./approval-repository"

export class ApprovalWorkflowError extends Schema.Error<ApprovalWorkflowError>("ApprovalWorkflowError")({
  _tag: Schema.tag("ApprovalWorkflowError"),
  message: Schema.String
}) {}

export const ApprovalDecisionSignal = DurableDeferred.make("PlanApprovalV1/decision", {
  success: ApprovalDecision
})

export const ApprovalWorkflow = Workflow.make("PlanApprovalV1", {
  payload: {
    approvalId: Schema.String,
    runId: Schema.String,
    effectiveUserId: Schema.String,
    requestedApproverId: Schema.String,
    assignedApproverId: Schema.String,
    planHash: Schema.String,
    planJson: Schema.String,
    policyReason: Schema.String,
    createdAt: Schema.String
  },
  success: ApprovalDecision,
  error: ApprovalWorkflowError,
  idempotencyKey: ({ approvalId }) => approvalId
})

export const layer = ApprovalWorkflow.toLayer(Effect.fn("ApprovalWorkflow.run")(function*(payload) {
  const repository = yield* ApprovalRepository

  yield* Activity.make({
    name: "approval.persist",
    error: ApprovalWorkflowError,
    execute: repository.create(new ApprovalRecord({
      ...payload,
      status: "pending"
    })).pipe(Effect.mapError((error) => new ApprovalWorkflowError({ message: String(error) })))
  })

  const decision = yield* DurableDeferred.await(ApprovalDecisionSignal)

  yield* Activity.make({
    name: "approval.resolve",
    error: ApprovalWorkflowError,
    execute: repository.resolve(payload.approvalId, decision.decision, decision.reviewerId, decision.reason, decision.decidedAt)
      .pipe(Effect.mapError((error) => new ApprovalWorkflowError({ message: String(error) })))
  })

  return decision
}))
