import { Context, Crypto, Data, Effect, Layer, Option, Schema } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine"
import { QualityHoldContext } from "../../../domain/quality/context/quality-hold-context"
import { ReroutePurchaseOrder, ReroutePurchaseOrderWorkflow } from "../../../domain/purchasing/workflows/reroute-purchase-order"
import { SupplyRiskContext } from "../../../domain/purchasing/context/supply-risk-context"
import { ApprovalRepository } from "../../approvals/service/approval-repository"
import { ApprovalService } from "../../approvals/service/approval-service"
import { AuditLog } from "../../audit/service/audit-log"
import { Gate } from "../../authorization/policy/gate"
import { PrincipalDirectory } from "../../authorization/permissions/principal-directory"
import { RunRecord } from "../../memory/durable/run-record"
import { RunRepository } from "../../memory/durable/run-repository"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { ToolRuntime } from "../../tools/runtime/tool-runtime"
import { AttentionRepository } from "../context/attention-repository"
import { Planner } from "../planning/planner"
import { Recommendation } from "../planning/recommendation"

export class AttentionMissing extends Data.TaggedError("AttentionMissing")<{ readonly attentionId: string }> {}
export class ApprovalPending extends Data.TaggedError("ApprovalPending")<{ readonly runId: string }> {}
export class ApprovalRejected extends Data.TaggedError("ApprovalRejected")<{ readonly runId: string }> {}
export class ApprovalStale extends Data.TaggedError("ApprovalStale")<{ readonly runId: string; readonly reason: string }> {}

const decodeRecommendation = Schema.decodeUnknownEffect(Recommendation)

export class AgentHarness extends Context.Service<AgentHarness, {
  readonly propose: (attentionId: string) => Effect.Effect<RunRecord, unknown>
  readonly executeApproved: (runId: string) => Effect.Effect<unknown, unknown>
}>()("harmony/agent/AgentHarness") {}

export const layer = Layer.effect(
  AgentHarness,
  Effect.gen(function*() {
    const attentions = yield* AttentionRepository
    const directory = yield* PrincipalDirectory
    const supplyContext = yield* SupplyRiskContext
    const qualityContext = yield* QualityHoldContext
    const planner = yield* Planner
    const gate = yield* Gate
    const approvals = yield* ApprovalRepository
    const approvalService = yield* ApprovalService
    const audit = yield* AuditLog
    const runs = yield* RunRepository
    const runtime = yield* ToolRuntime
    const clock = yield* BusinessClock
    const crypto = yield* Crypto.Crypto
    const engine = yield* WorkflowEngine

    return AgentHarness.of({
      propose: Effect.fn("AgentHarness.propose")(function*(attentionId) {
        const maybeAttention = yield* attentions.get(attentionId)
        if (Option.isNone(maybeAttention)) return yield* new AttentionMissing({ attentionId })
        const attention = maybeAttention.value
        const principal = yield* directory.get(attention.principalId)
        const [runId, traceId, now] = yield* Effect.all([crypto.randomUUIDv4, crypto.randomUUIDv4, clock.now])
        const evidence = attention.kind === "purchasing.supply-risk" ? yield* supplyContext.gather(principal, attention) : yield* qualityContext.gather(principal, attention)

        yield* audit.append({ runId, traceId, eventType: "context.gathered", actor: "agent", effectiveUserId: principal.userId, evidence, data: { attentionId, providers: [...new Set(evidence.map((item) => item.provider))] } })
        const plannerResult = yield* planner.plan({ attentionKind: attention.kind, attention: attention.payload, evidence })
        const recommendation = plannerResult.recommendation
        yield* audit.append({ runId, traceId, eventType: "planner.recommendation", actor: `model:${plannerResult.model}`, effectiveUserId: principal.userId, evidence: evidence.filter((item) => recommendation.evidenceRefs.includes(item.sourceId)), data: plannerResult })
        const gateResult = yield* gate.evaluate(principal, recommendation)
        yield* audit.append({ runId, traceId, eventType: "gate.evaluated", actor: "policy", effectiveUserId: principal.userId, evidence: [], data: gateResult ?? { write: false } })

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
        yield* audit.append({ runId, traceId, eventType: "approval.requested", actor: "policy", effectiveUserId: principal.userId, evidence: [], data: { approvalId, assignedApproverId: gateResult.assignedApproverId, policyReason: gateResult.policyReason, planHash: gateResult.planHash } })
        return record
      }),
      executeApproved: Effect.fn("AgentHarness.executeApproved")(function*(runId) {
        const run = yield* runs.get(runId)
        if (run.approvalId === undefined) return JSON.parse(run.outcomeJson ?? "null")
        const approval = yield* approvals.get(run.approvalId)
        if (approval.status === "pending") return yield* new ApprovalPending({ runId })
        if (approval.status === "rejected") return yield* new ApprovalRejected({ runId })
        const principal = yield* directory.get(run.principalId)
        const recommendation = yield* decodeRecommendation(JSON.parse(run.recommendationJson))
        const currentGate = yield* gate.evaluate(principal, recommendation)
        if (currentGate === null || currentGate.planHash !== approval.planHash) return yield* new ApprovalStale({ runId, reason: "The approved plan no longer matches current policy." })
        if (approval.reviewerId !== currentGate.assignedApproverId) return yield* new ApprovalStale({ runId, reason: `Current policy requires ${currentGate.assignedApproverId}, but ${approval.reviewerId} approved the plan.` })

        yield* runs.setStatus(runId, "executing", yield* clock.now)
        yield* audit.append({ runId, traceId: run.traceId, eventType: "execution.started", actor: "agent", effectiveUserId: principal.userId, evidence: [], data: { approvalId: approval.approvalId, reviewerId: approval.reviewerId } })

        const outcome = recommendation._tag === "EnterWorkflow"
          ? yield* ReroutePurchaseOrderWorkflow.execute({ runId, principalId: principal.userId, partId: recommendation.parameters.partId, originalPoId: recommendation.parameters.originalPoId, productionOrderId: recommendation.parameters.productionOrderId, alternateSupplierId: recommendation.parameters.alternateSupplierId, quantity: recommendation.parameters.quantity }).pipe(Effect.provideService(WorkflowEngine, engine))
          : recommendation._tag === "ProposedActions"
            ? yield* Effect.forEach(recommendation.actions, (action, index) => {
                const suffix = runId.replace(/-/g, "").slice(0, 10)
                const input = action._tag === "production.notify" || action._tag === "purchasing.flag-shortage" ? { ...action, messageId: `M-${suffix}-${index}` } : action
                return runtime.execute({ tool: action._tag, principal, input, idempotencyKey: `${runId}:action:${index}` })
              }, { concurrency: 1 })
            : yield* new ApprovalStale({ runId, reason: "A no-action recommendation cannot have an executable approval." })

        const completedAt = yield* clock.now
        yield* runs.setStatus(runId, "completed", completedAt, outcome)
        yield* attentions.setStatus(run.attentionId, "closed")
        yield* audit.append({ runId, traceId: run.traceId, eventType: "execution.completed", actor: recommendation._tag === "EnterWorkflow" ? `workflow:${ReroutePurchaseOrder.name}@${ReroutePurchaseOrder.version}` : "agent:bounded-actions", effectiveUserId: principal.userId, evidence: [], data: outcome })
        return outcome
      })
    })
  })
)
