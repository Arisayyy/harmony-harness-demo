import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine"
import { PrincipalDirectory } from "../../../harness/authorization/permissions/principal-directory"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { ScheduleArrivalCheckOutput } from "../../../harness/scheduling/service/scheduling-tools"
import { ToolRuntime } from "../../../harness/tools/runtime/tool-runtime"
import { CrashControl } from "../../../harness/workflows/runtime/crash-control"
import { versionedWorkflow } from "../../../harness/workflows/versioning/versioned-workflow"
import { ErpProvider } from "../../../integrations/erp/erp-provider"
import { Supplier } from "../model/supplier"
import { ChangePurchaseOrderStatusOutput, CreatePurchaseOrderOutput } from "../tools/purchasing-tools"
import { NotifyProductionOutput } from "../tools/production-tools"

export class RerouteWorkflowError extends Schema.Error<RerouteWorkflowError>("RerouteWorkflowError")({ _tag: Schema.tag("RerouteWorkflowError"), step: Schema.String, message: Schema.String }) {}
export class RerouteWorkflowResult extends Schema.Class<RerouteWorkflowResult>("RerouteWorkflowResult")({ replacementPoId: Schema.String, scheduledWorkId: Schema.String }) {}
export class QualifiedSupplier extends Schema.Class<QualifiedSupplier>("QualifiedSupplier")({ supplier: Supplier, orderedDate: Schema.String, promisedDate: Schema.String, followUpDate: Schema.String }) {}

const decodeCreatePurchaseOrderOutput = Schema.decodeUnknownEffect(CreatePurchaseOrderOutput)
const decodeChangePurchaseOrderStatusOutput = Schema.decodeUnknownEffect(ChangePurchaseOrderStatusOutput)
const decodeNotifyProductionOutput = Schema.decodeUnknownEffect(NotifyProductionOutput)
const decodeScheduleArrivalCheckOutput = Schema.decodeUnknownEffect(ScheduleArrivalCheckOutput)
const failStep = (step: string) => (error: unknown) => new RerouteWorkflowError({ step, message: String(error) })
const nextTuesday = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`)
  let delta = (2 - value.getUTCDay() + 7) % 7
  if (delta === 0) delta = 7
  value.setUTCDate(value.getUTCDate() + delta)
  return value.toISOString().slice(0, 10)
}

export const ReroutePurchaseOrderWorkflow = Workflow.make("PurchasingRerouteV1", {
  payload: { runId: Schema.String, principalId: Schema.String, partId: Schema.String, originalPoId: Schema.String, productionOrderId: Schema.String, alternateSupplierId: Schema.String, quantity: Schema.Number },
  success: RerouteWorkflowResult,
  error: RerouteWorkflowError,
  idempotencyKey: ({ runId, originalPoId, productionOrderId }) => `${runId}:${originalPoId}:${productionOrderId}`
})

export const layer = ReroutePurchaseOrderWorkflow.toLayer(Effect.fn("PurchasingRerouteV1.run")(function*(payload) {
  const erp = yield* ErpProvider
  const directory = yield* PrincipalDirectory
  const runtime = yield* ToolRuntime
  const clock = yield* BusinessClock
  const crash = yield* CrashControl
  const instance = yield* WorkflowInstance

  const supplier = yield* Activity.make({
    name: "01-confirm-alternate-approved",
    success: Supplier,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const originalPo = yield* erp.getPurchaseOrder(principal, payload.originalPoId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      if (originalPo.partId !== payload.partId) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `PO ${payload.originalPoId} does not contain ${payload.partId}` })
      if (originalPo.supplierId === payload.alternateSupplierId) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `Supplier ${payload.alternateSupplierId} is already the supplier on ${payload.originalPoId}` })
      const suppliers = yield* erp.listSuppliersForPart(principal, payload.partId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const candidate = suppliers.find((item) => item.supplierId === payload.alternateSupplierId)
      if (candidate === undefined || !candidate.approved || !candidate.approvedParts.includes(payload.partId)) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `Supplier ${payload.alternateSupplierId} is not approved for ${payload.partId}` })
      return candidate
    })
  })

  const qualified = yield* Activity.make({
    name: "02-confirm-lead-time",
    success: QualifiedSupplier,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const production = yield* erp.getProductionOrder(principal, payload.productionOrderId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const now = yield* clock.now.pipe(Effect.mapError(failStep("confirm-lead-time")))
      const orderedDate = now.slice(0, 10)
      const arrival = new Date(`${orderedDate}T12:00:00Z`)
      arrival.setUTCDate(arrival.getUTCDate() + supplier.leadTimeDays)
      if (arrival.getTime() > new Date(production.scheduledStart).getTime()) return yield* new RerouteWorkflowError({ step: "confirm-lead-time", message: `Supplier ${supplier.supplierId} cannot arrive before ${production.scheduledStart}` })
      return new QualifiedSupplier({ supplier, orderedDate, promisedDate: arrival.toISOString().slice(0, 10), followUpDate: nextTuesday(orderedDate) })
    })
  })

  const price = qualified.supplier.pricing.find((entry) => entry.partId === payload.partId)
  if (price === undefined) return yield* new RerouteWorkflowError({ step: "create-new-po", message: "Approved supplier price disappeared before execution" })
  const suffix = instance.executionId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase()
  const replacementPoId = `PO-R-${suffix}`

  const created = yield* Activity.make({
    name: "03-create-new-po",
    success: CreatePurchaseOrderOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("create-new-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("create-new-po")
      const result = yield* runtime.execute({ tool: "erp.create-po", principal, idempotencyKey, input: { poId: replacementPoId, partId: payload.partId, supplierId: qualified.supplier.supplierId, qty: payload.quantity, unitPrice: price.unitPrice, orderedDate: qualified.orderedDate, promisedDate: qualified.promisedDate } }).pipe(Effect.mapError(failStep("create-new-po")))
      return yield* decodeCreatePurchaseOrderOutput(result).pipe(Effect.mapError(failStep("create-new-po")))
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey: `compensate:${instance.executionId}:new-po`, input: { poId: result.poId, status: "cancelled" } }).pipe(Effect.catch(() => Effect.void))
  })))

  yield* crash.afterActivity("03-create-new-po")

  yield* Activity.make({
    name: "04-cancel-old-po",
    success: ChangePurchaseOrderStatusOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("cancel-old-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("cancel-old-po")
      const result = yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey, input: { poId: payload.originalPoId, status: "cancelled" } }).pipe(Effect.mapError(failStep("cancel-old-po")))
      return yield* decodeChangePurchaseOrderStatusOutput(result).pipe(Effect.mapError(failStep("cancel-old-po")))
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
      const result = yield* runtime.execute({ tool: "production.notify", principal, idempotencyKey, input: { messageId, productionOrderId: payload.productionOrderId, message: `PO ${payload.originalPoId} was rerouted to ${qualified.supplier.name}. Replacement ${created.poId} is promised ${qualified.promisedDate}.` } }).pipe(Effect.mapError(failStep("notify-production")))
      return yield* decodeNotifyProductionOutput(result).pipe(Effect.mapError(failStep("notify-production")))
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation(() => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "production.notify", principal, idempotencyKey: `compensate:${instance.executionId}:notify`, input: { messageId: `${messageId}-CORRECTION`, productionOrderId: payload.productionOrderId, message: `Correction: reroute workflow ${instance.executionId} was rolled back. Use the restored PO state.` } }).pipe(Effect.catch(() => Effect.void))
  })))

  const workId = `WORK-${suffix}`
  const scheduled = yield* Activity.make({
    name: "06-schedule-arrival-check",
    success: ScheduleArrivalCheckOutput,
    error: RerouteWorkflowError,
    execute: Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("schedule-arrival-check")))
      const idempotencyKey = yield* Activity.idempotencyKey("schedule-arrival-check")
      const result = yield* runtime.execute({ tool: "schedule.arrival-check", principal, idempotencyKey, input: { workId, runAt: `${qualified.followUpDate}T09:00:00-06:00`, poId: replacementPoId, partId: payload.partId, productionOrderId: payload.productionOrderId, principalId: payload.principalId } }).pipe(Effect.mapError(failStep("schedule-arrival-check")))
      return yield* decodeScheduleArrivalCheckOutput(result).pipe(Effect.mapError(failStep("schedule-arrival-check")))
    })
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "schedule.cancel", principal, idempotencyKey: `compensate:${instance.executionId}:schedule`, input: { workId: result.workId } }).pipe(Effect.catch(() => Effect.void))
  })))

  return new RerouteWorkflowResult({ replacementPoId: created.poId, scheduledWorkId: scheduled.workId })
}))

export const ReroutePurchaseOrder = versionedWorkflow("purchasing.reroute-po", 1, ReroutePurchaseOrderWorkflow)
