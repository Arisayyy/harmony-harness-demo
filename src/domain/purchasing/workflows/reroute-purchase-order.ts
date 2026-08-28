import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine"
import { PrincipalDirectory } from "../../../harness/authorization/permissions/principal-directory"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { ToolRuntime } from "../../../harness/tools/runtime/tool-runtime"
import { versionedWorkflow } from "../../../harness/workflows/versioning/versioned-workflow"
import { ErpProvider } from "../../../integrations/erp/erp-provider"
import { Supplier } from "../model/supplier"
import { ChangePurchaseOrderStatusOutput, CreatePurchaseOrderOutput } from "../tools/purchasing-tools"
import { NotifyProductionOutput } from "../tools/production-tools"
import { ScheduleArrivalCheckOutput } from "../../../harness/scheduling/service/scheduling-tools"

export class RerouteWorkflowError extends Schema.Error<RerouteWorkflowError>("RerouteWorkflowError")({
  _tag: Schema.tag("RerouteWorkflowError"),
  step: Schema.String,
  message: Schema.String
}) {}

export class RerouteWorkflowResult extends Schema.Class<RerouteWorkflowResult>("RerouteWorkflowResult")({
  replacementPoId: Schema.String,
  scheduledWorkId: Schema.String
}) {}

const failStep = (step: string) => (error: unknown) => new RerouteWorkflowError({ step, message: String(error) })

export const ReroutePurchaseOrderWorkflow = Workflow.make("PurchasingRerouteV1", {
  payload: {
    principalId: Schema.String,
    partId: Schema.String,
    originalPoId: Schema.String,
    productionOrderId: Schema.String,
    alternateSupplierId: Schema.String,
    quantity: Schema.Number
  },
  success: RerouteWorkflowResult,
  error: RerouteWorkflowError,
  idempotencyKey: ({ originalPoId, productionOrderId }) => `${originalPoId}:${productionOrderId}`
})

export const layer = ReroutePurchaseOrderWorkflow.toLayer(Effect.fn("PurchasingRerouteV1.run")(function*(payload) {
  const erp = yield* ErpProvider
  const directory = yield* PrincipalDirectory
  const runtime = yield* ToolRuntime
  const clock = yield* BusinessClock
  const instance = yield* WorkflowInstance

  const supplier = yield* Activity.make({
    name: "01-confirm-alternate-approved",
    success: Supplier,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const suppliers = yield* erp.listSuppliersForPart(principal, payload.partId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const candidate = suppliers.find((item) => item.supplierId === payload.alternateSupplierId)
      if (candidate === undefined || !candidate.approved || !candidate.approvedParts.includes(payload.partId)) {
        return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `Supplier ${payload.alternateSupplierId} is not approved for ${payload.partId}` })
      }
      return candidate
    })
  })

  const qualified = yield* Activity.make({
    name: "02-confirm-lead-time",
    success: Supplier,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const production = yield* erp.getProductionOrder(principal, payload.productionOrderId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const now = yield* clock.now
      const arrival = new Date(now)
      arrival.setUTCDate(arrival.getUTCDate() + supplier.leadTimeDays)
      if (arrival.getTime() > new Date(production.scheduledStart).getTime()) {
        return yield* new RerouteWorkflowError({ step: "confirm-lead-time", message: `Supplier ${supplier.supplierId} cannot arrive before ${production.scheduledStart}` })
      }
      return supplier
    })
  })

  const price = qualified.pricing.find((entry) => entry.partId === payload.partId)
  if (price === undefined) return yield* new RerouteWorkflowError({ step: "create-new-po", message: "Approved supplier price disappeared before execution" })

  const suffix = instance.executionId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase()
  const replacementPoId = `PO-R-${suffix}`
  const orderedDate = (yield* clock.now).slice(0, 10)
  const promised = new Date(`${orderedDate}T12:00:00Z`)
  promised.setUTCDate(promised.getUTCDate() + qualified.leadTimeDays)
  const promisedDate = promised.toISOString().slice(0, 10)

  const created = yield* Activity.make({
    name: "03-create-new-po",
    success: CreatePurchaseOrderOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("create-new-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("create-new-po")
      return yield* runtime.execute({
        tool: "erp.create-po",
        principal,
        idempotencyKey,
        input: { poId: replacementPoId, partId: payload.partId, supplierId: qualified.supplierId, qty: payload.quantity, unitPrice: price.unitPrice, orderedDate, promisedDate }
      }).pipe(Effect.mapError(failStep("create-new-po"))) as Effect.Effect.Success<any>
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey: `compensate:${instance.executionId}:new-po`, input: { poId: result.poId, status: "cancelled" } }).pipe(Effect.catch(() => Effect.void))
  })))

  const cancelled = yield* Activity.make({
    name: "04-cancel-old-po",
    success: ChangePurchaseOrderStatusOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("cancel-old-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("cancel-old-po")
      return yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey, input: { poId: payload.originalPoId, status: "cancelled" } }).pipe(Effect.mapError(failStep("cancel-old-po"))) as any
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey: `compensate:${instance.executionId}:old-po`, input: { poId: payload.originalPoId, status: result.previousStatus === "open" ? "open" : "cancelled" } }).pipe(Effect.catch(() => Effect.void))
  })))

  const messageId = `M-PROD-${suffix}`
  yield* Activity.make({
    name: "05-notify-production",
    success: NotifyProductionOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("notify-production")))
      const idempotencyKey = yield* Activity.idempotencyKey("notify-production")
      return yield* runtime.execute({
        tool: "production.notify",
        principal,
        idempotencyKey,
        input: { messageId, productionOrderId: payload.productionOrderId, message: `PO ${payload.originalPoId} was rerouted to ${qualified.name}. Replacement ${created.poId} is promised ${promisedDate}.` }
      }).pipe(Effect.mapError(failStep("notify-production"))) as any
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation(() => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({
      tool: "production.notify",
      principal,
      idempotencyKey: `compensate:${instance.executionId}:notify`,
      input: { messageId: `${messageId}-CORRECTION`, productionOrderId: payload.productionOrderId, message: `Correction: reroute workflow ${instance.executionId} was rolled back. Use the restored PO state.` }
    }).pipe(Effect.catch(() => Effect.void))
  })))

  const workId = `WORK-${suffix}`
  const scheduled = yield* Activity.make({
    name: "06-schedule-arrival-check",
    success: ScheduleArrivalCheckOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("schedule-arrival-check")))
      const idempotencyKey = yield* Activity.idempotencyKey("schedule-arrival-check")
      return yield* runtime.execute({
        tool: "schedule.arrival-check",
        principal,
        idempotencyKey,
        input: { workId, runAt: `${promisedDate}T09:00:00-06:00`, poId: replacementPoId, partId: payload.partId, productionOrderId: payload.productionOrderId, principalId: payload.principalId }
      }).pipe(Effect.mapError(failStep("schedule-arrival-check"))) as any
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "schedule.cancel", principal, idempotencyKey: `compensate:${instance.executionId}:schedule`, input: { workId: result.workId } }).pipe(Effect.catch(() => Effect.void))
  })))

  return new RerouteWorkflowResult({ replacementPoId: created.poId, scheduledWorkId: scheduled.workId })
}))

export const ReroutePurchaseOrder = versionedWorkflow("purchasing.reroute-po", 1, ReroutePurchaseOrderWorkflow)
