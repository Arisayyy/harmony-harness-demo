import { Context, Data, Effect, Exit, Layer } from "effect"
import { DurableDeferred } from "effect/unstable/workflow"
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine"
import type { Recommendation } from "../../agent/planning/recommendation"
import type { GateApproval } from "../../authorization/policy/gate"
import type { Principal } from "../../authorization/permissions/principal"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { ApprovalDecision, ApprovalRecord } from "../model/approval"
import { ApprovalRepository } from "./approval-repository"
import { ApprovalDecisionSignal, ApprovalWorkflow } from "./approval-workflow"

export class ApprovalReviewerMismatch extends Data.TaggedError("ApprovalReviewerMismatch")<{ readonly approvalId: string; readonly expectedReviewerId: string; readonly actualReviewerId: string }> {}

export class ApprovalService extends Context.Service<ApprovalService, {
  readonly request: (options: { readonly approvalId: string; readonly runId: string; readonly principal: Principal; readonly gate: GateApproval; readonly recommendation: Recommendation }) => Effect.Effect<string, unknown>
  readonly decide: (approvalId: string, reviewerId: string, decision: "approved" | "rejected", reason?: string) => Effect.Effect<void, unknown>
}>()("harmony/approvals/ApprovalService") {}

export const layer = Layer.effect(
  ApprovalService,
  Effect.gen(function*() {
    const repository = yield* ApprovalRepository
    const clock = yield* BusinessClock
    const engine = yield* WorkflowEngine

    return ApprovalService.of({
      request: Effect.fn("ApprovalService.request")(function*({ approvalId, runId, principal, gate, recommendation }) {
        const createdAt = yield* clock.now
        const payload = { approvalId, runId, effectiveUserId: principal.userId, requestedApproverId: gate.assignedApproverId, assignedApproverId: gate.assignedApproverId, planHash: gate.planHash, planJson: JSON.stringify(recommendation), policyReason: gate.policyReason, createdAt }
        yield* repository.create(new ApprovalRecord({ ...payload, status: "pending" }))
        return yield* ApprovalWorkflow.execute(payload, { discard: true }).pipe(Effect.provideService(WorkflowEngine, engine))
      }),
      decide: Effect.fn("ApprovalService.decide")(function*(approvalId, reviewerId, decision, reason) {
        const approval = yield* repository.get(approvalId)
        if (approval.assignedApproverId !== reviewerId) return yield* new ApprovalReviewerMismatch({ approvalId, expectedReviewerId: approval.assignedApproverId, actualReviewerId: reviewerId })
        const executionId = yield* ApprovalWorkflow.executionId({ approvalId: approval.approvalId, runId: approval.runId, effectiveUserId: approval.effectiveUserId, requestedApproverId: approval.requestedApproverId, assignedApproverId: approval.requestedApproverId, planHash: approval.planHash, planJson: approval.planJson, policyReason: approval.policyReason, createdAt: approval.createdAt })
        const decidedAt = yield* clock.now
        const token = DurableDeferred.tokenFromExecutionId(ApprovalDecisionSignal, { workflow: ApprovalWorkflow, executionId })
        yield* DurableDeferred.done(ApprovalDecisionSignal, { token, exit: Exit.succeed(new ApprovalDecision({ decision, reviewerId, reason, decidedAt })) }).pipe(Effect.provideService(WorkflowEngine, engine))
      })
    })
  })
)
