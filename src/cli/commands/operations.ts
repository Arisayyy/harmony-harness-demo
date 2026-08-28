import { Console, Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { AgentHarness } from "../../harness/agent/execution/agent-harness"
import { ApprovalService } from "../../harness/approvals/service/approval-service"
import { AuditRepository } from "../../harness/audit/repository/audit-repository"
import { BusinessClock } from "../../harness/scheduling/model/business-clock"

const approvalList = Command.make("list", {}, () => Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<any>`SELECT approval_id, run_id, assigned_approver_id, status, policy_reason FROM approvals ORDER BY created_at DESC`
  for (const row of rows) yield* Console.log(`${row.approval_id}  ${row.status.padEnd(10)}  approver=${row.assigned_approver_id}  run=${row.run_id}`)
}))

const approvalApprove = Command.make("approve", {
  approvalId: Argument.string("approval-id"),
  reviewer: Flag.string("reviewer")
}, ({ approvalId, reviewer }) => Effect.gen(function*() {
  const service = yield* ApprovalService
  yield* service.decide(approvalId, reviewer, "approved", "Approved from CLI")
  yield* Console.log(`approved ${approvalId} as ${reviewer}`)
}))

const approvalReject = Command.make("reject", {
  approvalId: Argument.string("approval-id"),
  reviewer: Flag.string("reviewer"),
  reason: Flag.string("reason").pipe(Flag.withDefault("Rejected from CLI"))
}, ({ approvalId, reviewer, reason }) => Effect.gen(function*() {
  const service = yield* ApprovalService
  yield* service.decide(approvalId, reviewer, "rejected", reason)
  yield* Console.log(`rejected ${approvalId} as ${reviewer}`)
}))

export const approval = Command.make("approval").pipe(Command.withSubcommands([approvalList, approvalApprove, approvalReject]))

const runExecute = Command.make("execute", { runId: Argument.string("run-id") }, ({ runId }) => Effect.gen(function*() {
  const harness = yield* AgentHarness
  const outcome = yield* harness.executeApproved(runId)
  yield* Console.log(JSON.stringify(outcome, null, 2))
}))

export const run = Command.make("run").pipe(Command.withSubcommands([runExecute]))

const auditShow = Command.make("show", { runId: Argument.string("run-id") }, ({ runId }) => Effect.gen(function*() {
  const repository = yield* AuditRepository
  const events = yield* repository.listRun(runId)
  for (const event of events) yield* Console.log(JSON.stringify(event))
}))

export const audit = Command.make("audit").pipe(Command.withSubcommands([auditShow]))

const clockAdvance = Command.make("advance", { instant: Argument.string("iso-instant") }, ({ instant }) => Effect.gen(function*() {
  const clock = yield* BusinessClock
  yield* clock.advanceTo(instant)
  yield* Console.log(`business clock → ${instant}`)
}))

export const clock = Command.make("clock").pipe(Command.withSubcommands([clockAdvance]))
