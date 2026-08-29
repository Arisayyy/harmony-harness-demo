import * as BunServices from "@effect/platform-bun/BunServices"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ReroutePurchaseOrderWorkflow } from "../src/domain/purchasing/workflows/reroute-purchase-order"
import { layer } from "../src/environments/demo/fixture-layer"
import { AttentionItem } from "../src/harness/agent/context/attention-item"
import { AttentionRepository } from "../src/harness/agent/context/attention-repository"
import { EnterWorkflow, ReroutePurchaseOrderParameters } from "../src/harness/agent/planning/recommendation"
import { ApprovalRecord } from "../src/harness/approvals/model/approval"
import { BackupRouting } from "../src/harness/approvals/routing/backup-routing"
import { ApprovalRepository } from "../src/harness/approvals/service/approval-repository"
import { Gate } from "../src/harness/authorization/policy/gate"
import { Principal } from "../src/harness/authorization/permissions/principal"
import { PrincipalDirectory } from "../src/harness/authorization/permissions/principal-directory"
import { MailIngress } from "../src/harness/events/runtime/mail-ingress"
import { BusinessClock } from "../src/harness/scheduling/model/business-clock"
import { ToolRuntime } from "../src/harness/tools/runtime/tool-runtime"
import { migrate } from "../src/infra/database/migrations/migrate"
import { resetDemo } from "../src/infra/database/seed/reset-demo"
import { runCrashResumeFixture } from "../src/scenarios/failures/crash-resume"
import { deliverIrrelevantMail, deliverSupplierDelay } from "../src/scenarios/scenario-a/events"

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
  test("AI-triages every inbound email and immediately starts the relevant domain agent", async () => {
    await setup()
    const result = await run(Effect.gen(function*() {
      const ingress = yield* MailIngress
      const noise = yield* deliverIrrelevantMail
      const ignored = yield* ingress.received("u-101", noise)
      const delay = yield* deliverSupplierDelay
      const routed = yield* ingress.received("u-101", delay)
      const replay = yield* ingress.received("u-101", delay)
      return {
        ignoredTag: ignored.decision._tag,
        ignoredRuns: ignored.runs.length,
        routedTag: routed.decision._tag,
        route: routed.decision._tag === "RouteMail" ? routed.decision.route : null,
        routedRuns: routed.runs.length,
        replayRuns: replay.runs.length
      }
    }))
    expect(result).toEqual({
      ignoredTag: "IgnoreMail",
      ignoredRuns: 0,
      routedTag: "RouteMail",
      route: "purchasing.supply-risk",
      routedRuns: 1,
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

  test("survives a real SIGKILL and resumes in a fresh Bun process without duplicate PO creation", async () => {
    await Effect.runPromise(Effect.scoped(runCrashResumeFixture.pipe(Effect.provide(BunServices.layer))))
  }, 30_000)
})
