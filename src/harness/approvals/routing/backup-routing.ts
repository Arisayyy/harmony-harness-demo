import { Context, Data, Effect, Layer, Option } from "effect"
import { AuditLog } from "../../audit/service/audit-log"
import { PrincipalDirectory } from "../../authorization/permissions/principal-directory"
import { RunRepository } from "../../memory/durable/run-repository"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { CalendarProvider } from "../../../integrations/calendar/calendar-provider"
import { ApprovalRepository } from "../service/approval-repository"

export class BackupUnavailable extends Data.TaggedError("BackupUnavailable")<{ readonly approverId: string }> {}

export class BackupRouting extends Context.Service<BackupRouting, {
  readonly routeIfOutTomorrow: (approvalId: string) => Effect.Effect<boolean, unknown>
}>()("harmony/approvals/BackupRouting") {}

const nextDate = (instant: string) => {
  const date = new Date(`${instant.slice(0, 10)}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export const layer = Layer.effect(
  BackupRouting,
  Effect.gen(function*() {
    const approvals = yield* ApprovalRepository
    const directory = yield* PrincipalDirectory
    const calendar = yield* CalendarProvider
    const clock = yield* BusinessClock
    const runs = yield* RunRepository
    const audit = yield* AuditLog

    return BackupRouting.of({
      routeIfOutTomorrow: Effect.fn("BackupRouting.routeIfOutTomorrow")(function*(approvalId) {
        const approval = yield* approvals.get(approvalId)
        if (approval.status !== "pending") return false
        const approver = yield* directory.get(approval.assignedApproverId)
        if (approver.backupApproverId === undefined) return yield* new BackupUnavailable({ approverId: approver.userId })
        const now = yield* clock.now
        const tomorrow = nextDate(now)
        const events = yield* calendar.listRange(approver, approver.userId, `${tomorrow}T00:00:00-06:00`, `${tomorrow}T23:59:59-06:00`)
        if (!events.some((event) => event.outOfOffice)) return false
        const reason = "Primary approver is out of office tomorrow at the end-of-day approval deadline."
        yield* approvals.route(approval.approvalId, approver.userId, approver.backupApproverId, reason, now)
        const run = yield* runs.get(approval.runId).pipe(Effect.option)
        yield* audit.append({ runId: approval.runId, traceId: Option.isSome(run) ? run.value.traceId : approval.runId, eventType: "approval.routed", actor: "policy", effectiveUserId: approval.effectiveUserId, evidence: [], data: { approvalId, fromApproverId: approver.userId, toApproverId: approver.backupApproverId, reason } })
        return true
      })
    })
  })
)
