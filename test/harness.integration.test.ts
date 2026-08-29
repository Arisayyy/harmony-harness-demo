import * as BunServices from "@effect/platform-bun/BunServices"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ReroutePurchaseOrderWorkflow } from "../src/domain/purchasing/workflows/reroute-purchase-order"
import { QualityHoldDetector } from "../src/domain/quality/detectors/quality-hold-detector"
import { layer } from "../src/environments/demo/fixture-layer"
import { AgentHarness } from "../src/harness/agent/execution/agent-harness"
import { AttentionItem } from "../src/harness/agent/context/attention-item"
import { AttentionRepository } from "../src/harness/agent/context/attention-repository"
import { EnterWorkflow, ReroutePurchaseOrderParameters } from "../src/harness/agent/planning/recommendation"
import { ApprovalRecord } from "../src/harness/approvals/model/approval"
import { BackupRouting } from "../src/harness/approvals/routing/backup-routing"
import { ApprovalRepository } from "../src/harness/approvals/service/approval-repository"
import { ApprovalService } from "../src/harness/approvals/service/approval-service"
import { AuditRepository } from "../src/harness/audit/repository/audit-repository"
import { Gate } from "../src/harness/authorization/policy/gate"
import { Principal } from "../src/harness/authorization/permissions/principal"
import { PrincipalDirectory } from "../src/harness/authorization/permissions/principal-directory"
import { MailIngress } from "../src/harness/events/runtime/mail-ingress"
import { BusinessClock } from "../src/harness/scheduling/model/business-clock"
import { FollowupDispatcher } from "../src/harness/scheduling/service/followup-dispatcher"
import { ToolRuntime } from "../src/harness/tools/runtime/tool-runtime"
import { migrate } from "../src/infra/database/migrations/migrate"
import { resetDemo } from "../src/infra/database/seed/reset-demo"
import { runCrashResumeFixture } from "../src/scenarios/failures/crash-resume"
import { deliverIrrelevantMail, deliverSupplierDelay } from "../src/scenarios/scenario-a/events"
import { placeQualityHold } from "../src/scenarios/scenario-b/events"
import { ErpProvider } from "../src/integrations/erp/erp-provider"
import { MailProvider } from "../src/integrations/mail/mail-provider"

process.env.DATABASE_PATH = `.data/harmony-test-${process.pid}.db`

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(layer))) as Effect.Effect<A, E>)

const setup = () => run(Effect.gen(function*() {
  yield* migrate
  yield* resetDemo
}))

const approvedReroute = (supplierId: string) => new EnterWorkflow({
  _tag: "EnterWorkflow",
  workflow: "purchasing.reroute-po",
  rationale: "Supply risk requires reroute.",
  confidence: 1,
  evidenceRefs: ["RT-4471", "PO-77812", "S-Z"],
  parameters: new ReroutePurchaseOrderParameters({
    partId: "RT-4471",
    originalPoId: "PO-77812",
    productionOrderId: "4812",
    alternateSupplierId: supplierId,
    quantity: 400
  })
})

describe("enterprise harness safety and durability", () => {
  test("AI-triages every new inbound email and dedupes provider redelivery before a second model call", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const ingress = yield* MailIngress
      const noise = yield* deliverIrrelevantMail
      const ignored = yield* ingress.received("u-101", noise)
      const delay = yield* deliverSupplierDelay
      const routed = yield* ingress.received("u-101", delay)
      const replay = yield* ingress.received("u-101", delay)
      return {
        ignoredStatus: ignored.status,
        ignoredTag: ignored.status === "processed" ? ignored.decision._tag : null,
        ignoredRuns: ignored.runs.length,
        routedStatus: routed.status,
        routedTag: routed.status === "processed" ? routed.decision._tag : null,
        route: routed.status === "processed" && routed.decision._tag === "RouteMail" ? routed.decision.route : null,
        routedRuns: routed.runs.length,
        replayStatus: replay.status,
        replayRuns: replay.runs.length
      }
    }))
    expect(result).toEqual({
      ignoredStatus: "processed",
      ignoredTag: "IgnoreMail",
      ignoredRuns: 0,
      routedStatus: "processed",
      routedTag: "RouteMail",
      route: "purchasing.supply-risk",
      routedRuns: 1,
      replayStatus: "duplicate",
      replayRuns: 0
    })
  })

  test("deduplicates attention items at the durable repository boundary", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const repository = yield* AttentionRepository
      const first = new AttentionItem({ attentionId: "A-1", detector: "test", dedupeKey: "risk:RT-4471", principalId: "u-101", kind: "purchasing.supply-risk", payload: {}, status: "open", createdAt: "2026-09-02T09:00:00-06:00" })
      const second = new AttentionItem({ ...first, attentionId: "A-2" })
      return [yield* repository.putIfAbsent(first), yield* repository.putIfAbsent(second)] as const
    }))
    expect(result).toEqual([true, false])
  })

  test("rejects an unapproved alternate supplier before any write can execute", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const gate = yield* Gate
      const principal = yield* directory.get("u-101")
      return yield* gate.evaluate(principal, approvedReroute("S-Q")).pipe(
        Effect.match({
          onFailure: (error) => ({ failed: true as const, reasons: error.reasons }),
          onSuccess: () => ({ failed: false as const, reasons: [] as ReadonlyArray<string> })
        })
      )
    }))
    expect(result.failed).toBe(true)
    expect(result.reasons.join(" ")).toContain("not approved")
  })

  test("rejects a no-op reroute back to the incumbent supplier", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const gate = yield* Gate
      const principal = yield* directory.get("u-101")
      return yield* gate.evaluate(principal, approvedReroute("S-Y")).pipe(
        Effect.match({
          onFailure: (error) => ({ failed: true as const, reasons: error.reasons }),
          onSuccess: () => ({ failed: false as const, reasons: [] as ReadonlyArray<string> })
        })
      )
    }))
    expect(result.failed).toBe(true)
    expect(result.reasons.join(" ")).toContain("must differ")
  })

  test("routes a replacement PO above the buyer limit to their manager", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const gate = yield* Gate
      const principal = yield* directory.get("u-101")
      const recommendation = approvedReroute("S-Z")
      const highValue = new EnterWorkflow({
        ...recommendation,
        parameters: new ReroutePurchaseOrderParameters({ ...recommendation.parameters, quantity: 1_000 })
      })
      return yield* gate.evaluate(principal, highValue)
    }))
    expect(result?.assignedApproverId).toBe("u-100")
    expect(result?.policyReason).toContain("exceeds")
  })

  test("blocks unauthorized provider reads and cross-role writes", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const erp = yield* ErpProvider
      const mail = yield* MailProvider
      const runtime = yield* ToolRuntime
      const quality = yield* directory.get("u-202")
      const production = yield* directory.get("u-301")
      const mailDenied = yield* mail.search(quality, "PO-77812").pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
      const poReadDenied = yield* erp.getPurchaseOrder(production, "PO-77812").pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
      const poWriteDenied = yield* runtime.execute({
        tool: "erp.create-po",
        principal: quality,
        idempotencyKey: "test:quality-cannot-create-po",
        input: { poId: "PO-NOT-ALLOWED", partId: "RT-4471", supplierId: "S-Z", qty: 1, unitPrice: 46.5, orderedDate: "2026-09-02", promisedDate: "2026-09-04" }
      }).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
      return { mailDenied, poReadDenied, poWriteDenied }
    }))
    expect(result).toEqual({ mailDenied: true, poReadDenied: true, poWriteDenied: true })
  })

  test("rechecks scopes at the tool boundary after policy approval", async () => {
    await setup()
    const denied = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const runtime = yield* ToolRuntime
      const principal = yield* directory.get("u-101")
      const revoked = new Principal({ ...principal, scopes: principal.scopes.filter((scope) => scope !== "erp:po:create") })
      return yield* runtime.execute({
        tool: "erp.create-po",
        principal: revoked,
        idempotencyKey: "test:revoked-scope",
        input: { poId: "PO-SHOULD-NOT-EXIST", partId: "RT-4471", supplierId: "S-Z", qty: 1, unitPrice: 46.5, orderedDate: "2026-09-02", promisedDate: "2026-09-04" }
      }).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }))
    }))
    expect(denied).toBe(true)
  })

  test("routes a pending approval to the configured backup when the primary is OOO tomorrow", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const approvals = yield* ApprovalRepository
      const routing = yield* BackupRouting
      const clock = yield* BusinessClock
      yield* clock.advanceTo("2026-09-02T17:00:00-06:00")
      yield* approvals.create(new ApprovalRecord({
        approvalId: "A-BACKUP-1",
        runId: "run-backup-fixture",
        effectiveUserId: "u-101",
        requestedApproverId: "u-101",
        assignedApproverId: "u-101",
        planHash: "fixture-hash",
        planJson: "{}",
        policyReason: "test fixture",
        status: "pending",
        createdAt: "2026-09-02T16:30:00-06:00"
      }))
      const routed = yield* routing.routeIfOutTomorrow("A-BACKUP-1")
      const record = yield* approvals.get("A-BACKUP-1")
      return { routed, assignedApproverId: record.assignedApproverId }
    }))
    expect(result).toEqual({ routed: true, assignedApproverId: "u-102" })
  })

  test("schedules and automatically routes the real Scenario A approval at end of day", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const ingress = yield* MailIngress
      const approvals = yield* ApprovalRepository
      const clock = yield* BusinessClock
      const dispatcher = yield* FollowupDispatcher
      const delay = yield* deliverSupplierDelay
      const received = yield* ingress.received("u-101", delay)
      if (received.status !== "processed" || received.runs[0]?.approvalId === undefined) return yield* Effect.die("Scenario A did not create approval")
      const approvalId = received.runs[0].approvalId
      yield* clock.advanceTo("2026-09-02T17:00:00-06:00")
      const dispatched = yield* dispatcher.runDue
      const approval = yield* approvals.get(approvalId)
      return { approvalId, assignedApproverId: approval.assignedApproverId, routed: dispatched.routedApprovalIds }
    }))
    expect(result.assignedApproverId).toBe("u-102")
    expect(result.routed).toContain(result.approvalId)
  })

  test("audits all six workflow steps in order and Tuesday re-enters the gated agent loop", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const ingress = yield* MailIngress
      const approvals = yield* ApprovalRepository
      const approvalService = yield* ApprovalService
      const harness = yield* AgentHarness
      const audit = yield* AuditRepository
      const clock = yield* BusinessClock
      const dispatcher = yield* FollowupDispatcher
      const delay = yield* deliverSupplierDelay
      const received = yield* ingress.received("u-101", delay)
      const scenarioRun = received.runs[0]
      if (scenarioRun?.approvalId === undefined) return yield* Effect.die("Scenario A did not create approval")
      const approval = yield* approvals.get(scenarioRun.approvalId)
      yield* approvalService.decide(approval.approvalId, approval.assignedApproverId, "approved", "test")
      yield* harness.executeApproved(scenarioRun.runId)
      const events = yield* audit.listRun(scenarioRun.runId)
      const completedSteps = events
        .filter((event) => event.eventType === "workflow.step.completed")
        .map((event) => (event.data as { step: string }).step)
      yield* clock.advanceTo("2026-09-08T09:00:00-06:00")
      const followup = yield* dispatcher.runDue
      const followupRecommendation = followup.agentRuns[0] === undefined ? null : JSON.parse(followup.agentRuns[0].recommendationJson)
      return { completedSteps, followup, followupRecommendation }
    }))
    expect(result.completedSteps).toEqual([
      "01-confirm-alternate-approved",
      "02-confirm-lead-time",
      "03-create-new-po",
      "04-cancel-old-po",
      "05-notify-production",
      "06-schedule-arrival-check"
    ])
    expect(result.followup.attentionItems).toHaveLength(1)
    expect(result.followup.agentRuns).toHaveLength(1)
    expect(result.followup.agentRuns[0]?.status).toBe("pending_approval")
    expect(result.followupRecommendation?._tag).toBe("ProposedActions")
    expect(result.followupRecommendation?.actions?.[0]?._tag).toBe("production.notify")
  }, 20_000)

  test("Scenario B reallocates to a covering good lot and notifies production", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const detector = yield* QualityHoldDetector
      const harness = yield* AgentHarness
      const approvals = yield* ApprovalRepository
      const approvalService = yield* ApprovalService
      const clock = yield* BusinessClock
      const sql = yield* SqlClient.SqlClient
      yield* clock.advanceTo("2026-09-08T09:00:00-06:00")
      yield* placeQualityHold
      const quality = yield* directory.get("u-202")
      const attention = (yield* detector.scan(quality))[0]
      if (attention === undefined) return yield* Effect.die("Quality detector found nothing")
      const proposed = yield* harness.propose(attention.attentionId)
      if (proposed.approvalId === undefined) return yield* Effect.die("Quality plan did not request approval")
      const approval = yield* approvals.get(proposed.approvalId)
      yield* approvalService.decide(approval.approvalId, approval.assignedApproverId, "approved", "test")
      yield* harness.executeApproved(proposed.runId)
      const order = yield* sql<any>`SELECT components_json FROM production_orders WHERE production_order_id = '4820'`
      const notices = yield* sql<any>`SELECT COUNT(*) AS count FROM mail_messages WHERE sender = 'agent@realtruck.example'`
      return { components: JSON.parse(order[0].components_json), notices: Number(notices[0].count) }
    }))
    expect(result.components.find((part: any) => part.partId === "RT-1180")?.lotId).toBe("L-2094")
    expect(result.notices).toBe(1)
  })

  test("Scenario B flags purchasing when no good lot can cover demand", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const directory = yield* PrincipalDirectory
      const detector = yield* QualityHoldDetector
      const harness = yield* AgentHarness
      const clock = yield* BusinessClock
      const sql = yield* SqlClient.SqlClient
      yield* clock.advanceTo("2026-09-08T09:00:00-06:00")
      yield* sql`UPDATE quality_lots SET qty = 10 WHERE lot_id = 'L-2094'`
      yield* placeQualityHold
      const quality = yield* directory.get("u-202")
      const attention = (yield* detector.scan(quality))[0]
      if (attention === undefined) return yield* Effect.die("Quality detector found nothing")
      const proposed = yield* harness.propose(attention.attentionId)
      const recommendation = JSON.parse(proposed.recommendationJson)
      return recommendation
    }))
    expect(result._tag).toBe("ProposedActions")
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?._tag).toBe("purchasing.flag-shortage")
  })

  test("replays the same workflow run idempotently but allows a new agent run", async () => {
    await setup()
    const nonce = `${process.pid}-${Date.now()}`
    const result = await run(Effect.gen(function*() {
      const payload = {
        runId: `run-a-${nonce}`,
        traceId: `trace-a-${nonce}`,
        principalId: "u-101",
        partId: "RT-4471",
        originalPoId: "PO-77812",
        productionOrderId: "4812",
        alternateSupplierId: "S-Z",
        quantity: 400
      }
      const first = yield* ReroutePurchaseOrderWorkflow.execute(payload)
      const replay = yield* ReroutePurchaseOrderWorkflow.execute(payload)
      const second = yield* ReroutePurchaseOrderWorkflow.execute({ ...payload, runId: `run-b-${nonce}`, traceId: `trace-b-${nonce}` })
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<any>`SELECT COUNT(*) AS count FROM purchase_orders WHERE po_id LIKE 'PO-R-%'`
      return { first, replay, second, count: Number(rows[0]?.count ?? 0) }
    }))
    expect(result.replay.replacementPoId).toBe(result.first.replacementPoId)
    expect(result.second.replacementPoId).not.toBe(result.first.replacementPoId)
    expect(result.count).toBe(2)
  }, 20_000)

  test("compensates completed PO writes when production notification fails", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const audit = yield* AuditRepository
      yield* sql`CREATE TRIGGER fail_agent_notification BEFORE INSERT ON mail_messages WHEN NEW.sender = 'agent@realtruck.example' BEGIN SELECT RAISE(ABORT, 'injected notification failure'); END`
      const runId = `run-compensation-${process.pid}-${Date.now()}`
      const exit = yield* Effect.exit(ReroutePurchaseOrderWorkflow.execute({
        runId,
        traceId: runId,
        principalId: "u-101",
        partId: "RT-4471",
        originalPoId: "PO-77812",
        productionOrderId: "4812",
        alternateSupplierId: "S-Z",
        quantity: 400
      }))
      const original = yield* sql<any>`SELECT status FROM purchase_orders WHERE po_id = 'PO-77812'`
      const replacements = yield* sql<any>`SELECT status FROM purchase_orders WHERE po_id LIKE 'PO-R-%'`
      const events = yield* audit.listRun(runId)
      return {
        failed: exit._tag === "Failure",
        originalStatus: original[0]?.status,
        replacementStatuses: replacements.map((row) => row.status),
        compensated: events.filter((event) => event.eventType === "workflow.step.compensated").map((event) => (event.data as { step: string }).step)
      }
    }))
    expect(result.failed).toBe(true)
    expect(result.originalStatus).toBe("open")
    expect(result.replacementStatuses).toEqual(["cancelled"])
    expect(result.compensated).toEqual(["04-cancel-old-po", "03-create-new-po", "02-confirm-lead-time", "01-confirm-alternate-approved"])
  }, 20_000)

  test("survives a real SIGKILL and resumes in a fresh Bun process without duplicate PO creation", async () => {
    await Effect.runPromise(Effect.scoped(runCrashResumeFixture.pipe(Effect.provide(BunServices.layer))))
  }, 30_000)
})
