import { Context, Crypto, Effect, Layer } from "effect"
import { AttentionItem } from "../../agent/context/attention-item"
import { AttentionRepository } from "../../agent/context/attention-repository"
import { AgentHarness } from "../../agent/execution/agent-harness"
import type { RunRecord } from "../../memory/durable/run-record"
import { BackupRouting } from "../../approvals/routing/backup-routing"
import { AuditLog } from "../../audit/service/audit-log"
import { PrincipalDirectory } from "../../authorization/permissions/principal-directory"
import { ErpProvider } from "../../../integrations/erp/erp-provider"
import { ScheduledWorkService } from "./scheduled-work"

export class FollowupDispatcher extends Context.Service<FollowupDispatcher, {
  readonly runDue: Effect.Effect<{
    readonly attentionItems: ReadonlyArray<AttentionItem>
    readonly agentRuns: ReadonlyArray<RunRecord>
    readonly routedApprovalIds: ReadonlyArray<string>
    readonly schedulerRunIds: ReadonlyArray<string>
  }, unknown>
}>()("harmony/scheduling/FollowupDispatcher") {}

export const layer = Layer.effect(
  FollowupDispatcher,
  Effect.gen(function*() {
    const scheduled = yield* ScheduledWorkService
    const attentions = yield* AttentionRepository
    const directory = yield* PrincipalDirectory
    const erp = yield* ErpProvider
    const audit = yield* AuditLog
    const crypto = yield* Crypto.Crypto
    const harness = yield* AgentHarness
    const backupRouting = yield* BackupRouting

    return FollowupDispatcher.of({
      runDue: Effect.gen(function*() {
        const due = yield* scheduled.due
        const created: Array<AttentionItem> = []
        const runs: Array<RunRecord> = []
        const routedApprovalIds: Array<string> = []
        const schedulerRunIds: Array<string> = []
        for (const work of due) {
          if (work.kind === "approval.end-of-day-routing") {
            const payload = work.payload as { approvalId: string }
            if (yield* backupRouting.routeIfOutTomorrow(payload.approvalId)) routedApprovalIds.push(payload.approvalId)
            yield* scheduled.complete(work.workId)
            continue
          }
          if (work.kind !== "purchase-order.arrival-check") {
            yield* scheduled.complete(work.workId)
            continue
          }
          const payload = work.payload as { poId: string; partId: string; productionOrderId: string; principalId: string }
          const principal = yield* directory.get(payload.principalId)
          const po = yield* erp.getPurchaseOrder(principal, payload.poId)
          if (po.status !== "received") {
            schedulerRunIds.push(`followup:${work.workId}`)
            const item = new AttentionItem({ attentionId: yield* crypto.randomUUIDv4, detector: "purchasing.arrival-followup/v1", dedupeKey: `arrival-missing:${payload.poId}:${work.runAt}`, principalId: payload.principalId, kind: "purchasing.supply-risk", payload: { ...payload, poId: payload.poId, followUp: true, delayMessageId: "followup" }, status: "open", createdAt: work.runAt })
            const inserted = yield* attentions.putIfAbsent(item)
            yield* audit.append({ runId: `followup:${work.workId}`, traceId: `followup:${work.workId}`, eventType: "scheduled.arrival-check", actor: "scheduler", effectiveUserId: payload.principalId, evidence: [], data: { workId: work.workId, poId: po.poId, poStatus: po.status, reenteredAttentionId: inserted ? item.attentionId : null } })
            if (inserted) {
              created.push(item)
              runs.push(yield* harness.propose(item.attentionId))
            }
          }
          yield* scheduled.complete(work.workId)
        }
        return { attentionItems: created, agentRuns: runs, routedApprovalIds, schedulerRunIds }
      })
    })
  })
)
