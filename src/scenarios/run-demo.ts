import { Console, Crypto, Effect, Schema } from "effect"
import { QualityHoldDetector } from "../domain/quality/detectors/quality-hold-detector"
import { AgentHarness } from "../harness/agent/execution/agent-harness"
import { Recommendation } from "../harness/agent/planning/recommendation"
import { BackupRouting } from "../harness/approvals/routing/backup-routing"
import { ApprovalRecord } from "../harness/approvals/model/approval"
import { ApprovalRepository } from "../harness/approvals/service/approval-repository"
import { ApprovalService } from "../harness/approvals/service/approval-service"
import { AuditExporter } from "../harness/audit/export/audit-exporter"
import { Principal } from "../harness/authorization/permissions/principal"
import { PrincipalDirectory } from "../harness/authorization/permissions/principal-directory"
import { MailIngress } from "../harness/events/runtime/mail-ingress"
import { BusinessClock } from "../harness/scheduling/model/business-clock"
import { FollowupDispatcher } from "../harness/scheduling/service/followup-dispatcher"
import { ToolRuntime } from "../harness/tools/runtime/tool-runtime"
import { migrate } from "../infra/database/migrations/migrate"
import { resetDemo } from "../infra/database/seed/reset-demo"
import { deliverIrrelevantMail, deliverSupplierDelay } from "./scenario-a/events"
import { placeQualityHold } from "./scenario-b/events"
import { runCrashResumeFixture } from "./failures/crash-resume"
import { renderBanner, renderDeclined, renderExecutionComplete, requestApproval, requestHomeAction, waitForHome, type DemoDecision, type HomeEvent, type HomeTask } from "../cli/ui/demo-ui"

const decodeRecommendation = Schema.decodeUnknownEffect(Recommendation)
const pause = Effect.sleep("250 millis")
const countdown = (label: string) => Effect.forEach([3, 2, 1], (value) => Effect.gen(function*() { yield* Console.log(`  ${label} ${value}`); yield* pause }), { discard: true })

const recommendationText = (recommendation: typeof Recommendation.Type) => recommendation._tag === "EnterWorkflow"
  ? `RT-4471 will likely cause production order 4812 to miss its scheduled start. Sierra Motion Components says PO-77812 will not reach Guadalajara until Tuesday. I can move the PO to Bajío Electromech and notify production. Want me to proceed?`
  : recommendation.rationale

export type DemoMode = "interactive" | "auto"

interface PendingTask {
  readonly title: string
  readonly detail: string
  readonly recommendation: typeof Recommendation.Type
  readonly approval: ApprovalRecord
  readonly runId: string
  readonly kind: "workflow" | "actions"
  readonly auditRunIds?: ReadonlyArray<string>
}

const decide = Effect.fnUntraced(function*(options: {
  readonly mode: DemoMode
  readonly title: string
  readonly recommendation: typeof Recommendation.Type
  readonly approval: ApprovalRecord
}) {
  if (options.mode === "auto") {
    yield* countdown("auto approval in")
    return "approved" as const
  }
  return yield* requestApproval(options)
})

export const runDemo = (mode: DemoMode = "interactive") => Effect.gen(function*() {
  yield* migrate
  yield* resetDemo
  const directory = yield* PrincipalDirectory
  const qualityDetector = yield* QualityHoldDetector
  const mailIngress = yield* MailIngress
  const harness = yield* AgentHarness
  const approvals = yield* ApprovalRepository
  const approvalService = yield* ApprovalService
  const backupRouting = yield* BackupRouting
  const clock = yield* BusinessClock
  const followups = yield* FollowupDispatcher
  const exporter = yield* AuditExporter
  const runtime = yield* ToolRuntime
  const crypto = yield* Crypto.Crypto
  const elena = yield* directory.get("u-101")

  const runNoise = Effect.fnUntraced(function*() {
    const noiseMail = yield* deliverIrrelevantMail
    const noiseResult = yield* mailIngress.received(elena.userId, noiseMail)
    if (noiseResult.status !== "processed") return yield* Effect.die("Fresh irrelevant mail was incorrectly treated as duplicate")
    yield* Console.log(`mail AI triage       ${noiseMail.messageId} · ${noiseResult.decision._tag} · no domain agent started`)
  })

  const prepareSupplier = Effect.fnUntraced(function*() {
    const supplierMail = yield* deliverSupplierDelay
    yield* Console.log("mail                 M-001 received · PO-77812 slips to Guadalajara dock Tuesday 9/8")
    const ingress = yield* mailIngress.received(elena.userId, supplierMail)
    if (ingress.status !== "processed") return yield* Effect.die("Fresh supplier mail was incorrectly treated as duplicate")
    yield* Console.log(`mail AI triage       ${ingress.decision._tag}${ingress.decision._tag === "RouteMail" ? ` → ${ingress.decision.route}` : ""}`)
    const run = ingress.runs[0]
    if (run === undefined) return yield* Effect.die("Scenario A mail event did not start an agent run")
    const duplicate = yield* mailIngress.received(elena.userId, supplierMail)
    yield* Console.log(`event dedupe         repeated provider delivery → ${duplicate.status} · ${duplicate.runs.length} duplicate agent runs`)
    const recommendation = yield* decodeRecommendation(JSON.parse(run.recommendationJson))
    if (run.approvalId === undefined) return yield* Effect.die("Scenario A did not request approval")
    const approval = yield* approvals.get(run.approvalId)
    return {
      title: "Supplier reroute",
      detail: "PO-77812 delay threatens production order 4812",
      recommendation,
      approval,
      runId: run.runId,
      kind: "workflow",
      auditRunIds: [`mail:${supplierMail.messageId}`, run.runId]
    } satisfies PendingTask
  })

  const prepareQuality = Effect.fnUntraced(function*() {
    yield* placeQualityHold
    const sofia = yield* directory.get("u-202")
    const items = yield* qualityDetector.scan(sofia)
    const attention = items[0]
    if (attention === undefined) return yield* Effect.die("Scenario B detector did not produce an attention item")
    const run = yield* harness.propose(attention.attentionId)
    const recommendation = yield* decodeRecommendation(JSON.parse(run.recommendationJson))
    if (run.approvalId === undefined) return yield* Effect.die("Scenario B did not request approval")
    const approval = yield* approvals.get(run.approvalId)
    return { title: "Quality hold response", detail: "Held lot L-2093 is allocated to production order 4820", recommendation, approval, runId: run.runId, kind: "actions" } satisfies PendingTask
  })

  const resolveTask = Effect.fnUntraced(function*(task: PendingTask) {
    const decision: DemoDecision = yield* decide({ mode, title: task.title, recommendation: task.recommendation, approval: task.approval })
    if (decision === "cancelled") return "cancelled" as const
    yield* approvalService.decide(task.approval.approvalId, task.approval.assignedApproverId, decision, decision === "approved" ? "Approved in demo" : "Declined in demo")
    if (decision === "approved") {
      const outcome = yield* harness.executeApproved(task.runId)
      yield* Console.log(renderExecutionComplete({ title: task.title, kind: task.kind, outcome }))
    } else {
      yield* Console.log(renderDeclined({ title: task.title, recommendation: task.recommendation, reviewerId: task.approval.assignedApproverId }))
    }
    if (task.auditRunIds !== undefined) yield* exporter.exportRuns(task.auditRunIds, "artifacts/scenario-a.ndjson")
    return "completed" as const
  })

  const runTimeAdvance = Effect.fnUntraced(function*() {
    yield* clock.advanceTo("2026-09-08T09:00:00-06:00")
    const items = yield* followups.runDue
    yield* Console.log(`time advanced        Tuesday 2026-09-08 09:00 · ${items.length} follow-up item${items.length === 1 ? "" : "s"} due`)
  })

  const runFailure = Effect.fnUntraced(function*() {
    yield* Console.log("\nFailure fixture      real process termination and workflow replay")
    yield* runCrashResumeFixture
    return "completed" as const
  })

  if (mode === "interactive") {
    const completed = new Set<HomeEvent>()
    const pending: Array<PendingTask> = []
    while (true) {
      const homeTasks: ReadonlyArray<HomeTask> = pending.map((task, index) => ({ key: index === 0 ? "1" : "2", title: task.title, detail: task.detail }))
      const now = yield* clock.now
      const action = yield* requestHomeAction(homeTasks, completed, now)
      if (action === "quit") return yield* Console.log("\nHARMONY terminal offline\n")
      if (action === "task-1" || action === "task-2") {
        const index = action === "task-1" ? 0 : 1
        const task = pending[index]
        if (task !== undefined && (yield* resolveTask(task)) === "completed") pending.splice(index, 1)
      } else if (action === "supplier") {
        pending.push(yield* prepareSupplier())
        completed.add(action)
      } else if (action === "quality") {
        pending.push(yield* prepareQuality())
        completed.add(action)
      } else if (action === "noise") {
        yield* runNoise()
        completed.add(action)
      } else if (action === "time") {
        yield* runTimeAdvance()
        completed.add(action)
      } else {
        yield* runFailure()
        completed.add(action)
      }
      yield* waitForHome
    }
  }

  yield* Console.log(`\n${renderBanner(mode)}`)
  yield* Console.log("virtual time         2026-09-02 09:00 America/Mexico_City")
  yield* Console.log("safety               writes cross durable approval and runtime scope checks\n")
  yield* runNoise()
  yield* countdown("supplier email in")
  const supplierTask = yield* prepareSupplier()
  yield* Console.log(`\nagent                ${recommendationText(supplierTask.recommendation)}`)
  yield* resolveTask(supplierTask)

  yield* clock.advanceTo("2026-09-02T17:00:00-06:00")
  const edgeApprovalId = yield* crypto.randomUUIDv4
  yield* approvals.create(new ApprovalRecord({ approvalId: edgeApprovalId, runId: "failure-backup-routing", effectiveUserId: "u-101", requestedApproverId: "u-101", assignedApproverId: "u-101", planHash: "backup-routing-fixture", planJson: "{}", policyReason: "Failure fixture: unanswered agent write approval", status: "pending", createdAt: "2026-09-02T16:30:00-06:00" }))
  const routed = yield* backupRouting.routeIfOutTomorrow(edgeApprovalId)
  const routedApproval = yield* approvals.get(edgeApprovalId)
  yield* Console.log(`backup routing       ${routed ? `u-101 → ${routedApproval.assignedApproverId} because tomorrow is OOO` : "not routed"}`)
  yield* runTimeAdvance()
  const qualityTask = yield* prepareQuality()
  yield* resolveTask(qualityTask)

  const revoked = new Principal({ ...elena, scopes: elena.scopes.filter((scope) => scope !== "erp:po:create") })
  const denied = yield* runtime.execute({ tool: "erp.create-po", principal: revoked, idempotencyKey: "failure:revoked-scope", input: { poId: "PO-SHOULD-NOT-EXIST", partId: "RT-4471", supplierId: "S-Z", qty: 1, unitPrice: 46.5, orderedDate: "2026-09-08", promisedDate: "2026-09-09" } }).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
  yield* Console.log(`scope revocation     ${denied ? "tool boundary denied write" : "unexpectedly allowed"}`)
  yield* runFailure()
  yield* Console.log("\nrecorded audit       artifacts/scenario-a.ndjson")
  yield* Console.log("demo complete\n")
})
