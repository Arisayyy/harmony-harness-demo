import { Context, Crypto, Data, Effect, Layer, Option, Schema } from "effect"
import { ReroutePurchaseOrder, ReroutePurchaseOrderWorkflow } from "../../../domain/purchasing/workflows/reroute-purchase-order"
import { gatherSupplyRiskContext } from "../../../domain/purchasing/context/supply-risk-context"
import { gatherQualityHoldContext } from "../../../domain/quality/context/quality-hold-context"
import { AttentionRepository } from "../context/attention-repository"
import { Planner } from "../planning/planner"
import { Recommendation } from "../planning/recommendation"
import { Gate } from "../../authorization/policy/gate"
import { PrincipalDirectory } from "../../authorization/permissions/principal-directory"
import { ApprovalRepository } from "../../approvals/service/approval-repository"
import { ApprovalService } from "../../approvals/service/approval-service"
import { appendNow } from "../../audit/repository/audit-repository"
import { RunRecord } from "../../memory/durable/run-record"
import { RunRepository } from "../../memory/durable/run-repository"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { ToolRuntime } from "../../tools/runtime/tool-runtime"

export class AttentionMissing extends Data.TaggedError("AttentionMissing")<{ readonly attentionId: string }> {}
export class ApprovalPending extends Data.TaggedError("ApprovalPending")<{ readonly runId: string }> {}
export class ApprovalRejected extends Data.TaggedError("ApprovalRejected")<{ readonly runId: string }> {}
export class ApprovalStale extends Data.TaggedError("ApprovalStale")<{ readonly runId: string; readonly reason: string }> {}

const actionTool = (action: any) => action._tag

export class AgentHarness extends Context.Service<AgentHarness, {
  readonly propose: (attentionId: string) => Effect.Effect<RunRecord, unknown>
  readonly executeApproved: (runId: string) => Effect.Effect<unknown, unknown>
}>()("harmony/agent/AgentHarness") {}

export const layer = Layer.effect(
  AgentHarness,
  Effect.gen(function*() {
    const attentions = yield* AttentionRepository
    const directory = yield* PrincipalDirectory
    const planner = yield* Planner
    const gate = yield* Gate
    const approvals = yield* ApprovalRepository
    const approvalService = yield* ApprovalService
    const runs = yield* RunRepository
    const runtime = yield* ToolRuntime
    const clock = yield* BusinessClock
    const crypto = yield* Crypto.Crypto

    return AgentHarness.of({
      propose: Effect.fn("AgentHarness.propose")(function*(attentionId) {
        const maybeAttention = yield* attentions.get(attentionId)
        if (Option.isNone(maybeAttention)) return yield* new AttentionMissing({ attentionId })
        const attention = maybeAttention.value
        const principal = yield* directory.get(attention.principalId)
        const [runId, traceId, now] = yield* Effect.all([crypto.randomUUIDv4, crypto.randomUUIDv4, clock.now])
        const evidence = attention.kind === "purchasing.supply-risk"
          ? yield* gatherSupplyRiskContext(principal, attention)
          : yield* gatherQualityHoldContext(principal, attention)

        yield* appendNow({ runId, traceId, eventType: "context.gathered", actor: "agent", effectiveUserId: principal.userId, evidence, data: { attentionId, providers: [...new Set(evidence.map((item) => item.provider))] } })

        const plannerResult = yield* planner.plan({ attentionKind: attention.kind, attention: attention.payload, evidence })
        const recommendation = plannerResult.recommendation
        yield* appendNow({ runId, traceId, eventType: "planner.recommendation", actor: `model:${plannerResult.model}`, effectiveUserId: principal.userId, evidence: evidence.filter((item) => recommendation.evidenceRefs.includes(item.sourceId)), data: plannerResult })

        const gateResult = yield* gate.evaluate(principal, recommendation)
        yield* appendNow({ runId, traceId, eventType: "gate.evaluated", actor: "policy", effectiveUserId: principal.userId, evidence: [], data: gateResult ?? { write: false } })

        if (recommendation._tag === "NoAction" || gateResult === null) {
          const record = new RunRecord({ runId, attentionId, traceId, principalId: principal.userId, plannerResultJson: JSON.stringify(plannerResult), recommendationJson: JSON.stringify(recommendation), evidenceJson: JSON.stringify(evidence), status: "completed", outcomeJson: JSON.stringify({ noAction: true }), createdAt: now, updatedAt: now })
          yield* runs.create(record)
          yield* attentions.setStatus(attentionId, "closed")
          return record
        }

        const approvalId = yield* crypto.randomUUIDv4
        const record = new RunRecord({ runId, attentionId, traceId, principalId: principal.userId, plannerResultJson: JSON.stringify(plannerResult), recommendationJson: JSON.stringify(recommendation), evidenceJson: JSON.stringify(evidence), gateJson: JSON.stringify(gateResult), approvalId, status: "pending_approval", createdAt: now, updatedAt: now })
        yield* runs.create(record)
        yield* approvalService.request({ approvalId, runId, principal, gate: gateResult, recommendation })
        yield* attentions.setStatus(attentionId, "planned")
        yield* appendNow({ runId, traceId, eventType: "approval.requested", actor: "policy", effectiveUserId: principal.userId, evidence: [], data: { approvalId, assignedApproverId: gateResult.assignedApproverId, policyReason: gateResult.policyReason, planHash: gateResult.planHash } })
        return record
      }),
      executeApproved: Effect.fn("AgentHarness.executeApproved")(function*(runId) {
        const run = yield* runs.get(runId)
        if (run.approvalId === undefined) return JSON.parse(run.outcomeJson ?? "null")
        const approval = yield* approvals.get(run.approvalId)
        if (approval.status === "pending") return yield* new ApprovalPending({ runId })
        if (approval.status === "rejected") return yield* new ApprovalRejected({ runId })
        const principal = yield* directory.get(run.principalId)
        const recommendation = yield* Schema.decodeUnknown(Recommendation)(JSON.parse(run.recommendationJson))
        const currentGate = yield* gate.evaluate(principal, recommendation)
        if (currentGate === null || currentGate.planHash !== approval.planHash) return yield* new ApprovalStale({ runId, reason: "The approved plan no longer matches current policy." })
        if (approval.reviewerId !== currentGate.assignedApproverId) return yield* new ApprovalStale({ runId, reason: `Current policy requires ${currentGate.assignedApproverId}, but ${approval.reviewerId} approved the plan.` })

        const now = yield* clock.now
        yield* runs.setStatus(runId, "executing", now)
        yield* appendNow({ runId, traceId: run.traceId, eventType: "execution.started", actor: "agent", effectiveUserId: principal.userId, evidence: [], data: { approvalId: approval.approvalId, reviewerId: approval.reviewerId } })

        const outcome = recommendation._tag === "EnterWorkflow"
          ? yield* ReroutePurchaseOrderWorkflow.execute({
              principalId: principal.userId,
              partId: recommendation.parameters.partId,
              originalPoId: recommendation.parameters.originalPoId,
              productionOrderId: recommendation.parameters.productionOrderId,
              alternateSupplierId: recommendation.parameters.alternateSupplierId,
              quantity: recommendation.parameters.quantity
            })
          : yield* Effect.forEach(recommendation.actions, (action, index) => {
              const suffix = runId.replace(/-/g, "").slice(0, 10)
              const input = action._tag === "production.notify"
                ? { ...action, messageId: `M-${suffix}-${index}` }
                : action._tag === "purchasing.flag-shortage"
                  ? { ...action, messageId: `M-${suffix}-${index}` }
                  : action
              return runtime.execute({ tool: actionTool(action), principal, input, idempotencyKey: `${runId}:action:${index}` })
            }, { concurrency: 1 })

        const completedAt = yield* clock.now
        yield* runs.setStatus(runId, "completed", completedAt, outcome)
        yield* attentions.setStatus(run.attentionId, "closed")
        yield* appendNow({ runId, traceId: run.traceId, eventType: "execution.completed", actor: recommendation._tag === "EnterWorkflow" ? `workflow:${ReroutePurchaseOrder.name}@${ReroutePurchaseOrder.version}` : "agent:bounded-actions", effectiveUserId: principal.userId, evidence: [], data: outcome })
        return outcome
      })
    })
  })
)
