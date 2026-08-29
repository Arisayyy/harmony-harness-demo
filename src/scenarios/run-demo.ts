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

const decodeRecommendation = Schema.decodeUnknownEffect(Recommendation)
const pause = Effect.sleep("250 millis")
const countdown = (label: string) => Effect.forEach([3, 2, 1], (value) => Effect.gen(function*() { yield* Console.log(`  ${label} ${value}`); yield* pause }), { discard: true })

const recommendationText = (recommendation: typeof Recommendation.Type) => recommendation._tag === "EnterWorkflow"
  ? `RT-4471 will likely cause production order 4812 to miss its scheduled start. Sierra Motion Components says PO-77812 will not reach Guadalajara until Tuesday. I can move the PO to Bajío Electromech and notify production. Want me to proceed?`
  : recommendation.rationale

export const runDemo = Effect.gen(function*() {
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

  yield* Console.log("\nRealTruck · Guadalajara manufacturing agent harness")
  yield* Console.log("virtual time         2026-09-02 09:00 America/Mexico_City")
  yield* Console.log("mode                 event-driven mail AI; writes still cross durable approval\n")

  const elena = yield* directory.get("u-101")
  const noiseMail = yield* deliverIrrelevantMail
  const noiseResult = yield* mailIngress.received(elena.userId, noiseMail)
  yield* Console.log(`mail AI triage       ${noiseMail.messageId} · ${noiseResult.decision._tag} · no domain agent started`)

  yield* countdown("supplier email in")
  const supplierMail = yield* deliverSupplierDelay
  yield* Console.log("mail                 M-001 received · PO-77812 slips to Guadalajara dock Tuesday 9/8")
  const ingress = yield* mailIngress.received(elena.userId, supplierMail)
  yield* Console.log(`mail AI triage       ${ingress.decision._tag}${ingress.decision._tag === "RouteMail" ? ` → ${ingress.decision.route}` : ""}`)
  const scenarioARun = ingress.runs[0]
  if (scenarioARun === undefined) return yield* Effect.die("Scenario A mail event did not start an agent run")
  const duplicate = yield* mailIngress.received(elena.userId, supplierMail)
  yield* Console.log(`event dedupe         repeated delivery created ${duplicate.runs.length} duplicate agent runs`)

  const scenarioARecommendation = yield* decodeRecommendation(JSON.parse(scenarioARun.recommendationJson))
  yield* Console.log(`\nagent                ${recommendationText(scenarioARecommendation)}`)

  if (scenarioARun.approvalId === undefined) return yield* Effect.die("Scenario A did not request approval")
  const approval = yield* approvals.get(scenarioARun.approvalId)
  yield* Console.log(`approval             pending · ${approval.assignedApproverId} · plan ${approval.planHash.slice(0, 12)}`)
  yield* countdown("auto approval in")
  yield* approvalService.decide(approval.approvalId, approval.assignedApproverId, "approved", "Approved in automatic demo")
  yield* Console.log(`approval             approved by ${approval.assignedApproverId}`)
  const scenarioAOutcome = yield* harness.executeApproved(scenarioARun.runId)
  yield* Console.log(`workflow             purchasing.reroute-po@1 complete · ${JSON.stringify(scenarioAOutcome)}`)
  yield* exporter.exportRun(scenarioARun.runId, "artifacts/scenario-a.ndjson")

  yield* clock.advanceTo("2026-09-02T17:00:00-06:00")
  const edgeApprovalId = yield* crypto.randomUUIDv4
  yield* approvals.create(new ApprovalRecord({ approvalId: edgeApprovalId, runId: "failure-backup-routing", effectiveUserId: "u-101", requestedApproverId: "u-101", assignedApproverId: "u-101", planHash: "backup-routing-fixture", planJson: "{}", policyReason: "Failure fixture: unanswered agent write approval", status: "pending", createdAt: "2026-09-02T16:30:00-06:00" }))
  const routed = yield* backupRouting.routeIfOutTomorrow(edgeApprovalId)
  const routedApproval = yield* approvals.get(edgeApprovalId)
  yield* Console.log(`backup routing       ${routed ? `u-101 → ${routedApproval.assignedApproverId} because tomorrow is OOO` : "not routed"}`)

  yield* Console.log("\nclock                advancing to Tuesday 2026-09-08 09:00")
  yield* clock.advanceTo("2026-09-08T09:00:00-06:00")
  const followupItems = yield* followups.runDue
  yield* Console.log(`follow-up            fired · ${followupItems.length} missing-arrival item re-entered the attention loop`)

  yield* Console.log("\nScenario B           quality lot hold arrives")
  yield* placeQualityHold
  const sofia = yield* directory.get("u-202")
  const qualityItems = yield* qualityDetector.scan(sofia)
  const qualityAttention = qualityItems[0]
  if (qualityAttention === undefined) return yield* Effect.die("Scenario B detector did not produce an attention item")
  const scenarioBRun = yield* harness.propose(qualityAttention.attentionId)
  const scenarioBRecommendation = yield* decodeRecommendation(JSON.parse(scenarioBRun.recommendationJson))
  yield* Console.log(`agent                ${scenarioBRecommendation.rationale}`)
  if (scenarioBRun.approvalId === undefined) return yield* Effect.die("Scenario B did not request approval")
  const scenarioBApproval = yield* approvals.get(scenarioBRun.approvalId)
  yield* approvalService.decide(scenarioBApproval.approvalId, scenarioBApproval.assignedApproverId, "approved", "Approved in automatic demo")
  const scenarioBOutcome = yield* harness.executeApproved(scenarioBRun.runId)
  yield* Console.log(`free-form path       bounded actions complete · ${JSON.stringify(scenarioBOutcome)}`)

  const revoked = new Principal({ ...elena, scopes: elena.scopes.filter((scope) => scope !== "erp:po:create") })
  const denied = yield* runtime.execute({ tool: "erp.create-po", principal: revoked, idempotencyKey: "failure:revoked-scope", input: { poId: "PO-SHOULD-NOT-EXIST", partId: "RT-4471", supplierId: "S-Z", qty: 1, unitPrice: 46.5, orderedDate: "2026-09-08", promisedDate: "2026-09-09" } }).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
  yield* Console.log(`scope revocation     ${denied ? "tool boundary denied write" : "unexpectedly allowed"}`)
  yield* Console.log("\nFailure fixture      real process termination and workflow replay")
  yield* runCrashResumeFixture
  yield* Console.log("\nrecorded audit       artifacts/scenario-a.ndjson")
  yield* Console.log("demo complete\n")
})
