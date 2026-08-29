import { Effect, Schema } from "effect"
import { Activity, Workflow } from "effect/unstable/workflow"
import { WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine"
import { PrincipalDirectory } from "../../../harness/authorization/permissions/principal-directory"
import { AuditLog } from "../../../harness/audit/service/audit-log"
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
  payload: { runId: Schema.String, traceId: Schema.String, principalId: Schema.String, partId: Schema.String, originalPoId: Schema.String, productionOrderId: Schema.String, alternateSupplierId: Schema.String, quantity: Schema.Number },
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
  const audit = yield* AuditLog
  const instance = yield* WorkflowInstance
  const toolAudit = { runId: payload.runId, traceId: payload.traceId }
  const appendWorkflowEvent = (eventType: string, step: string, rationale: string, data: unknown = {}) => audit.append({
    runId: payload.runId,
    traceId: payload.traceId,
    eventType,
    actor: `workflow:purchasing.reroute-po@1`,
    effectiveUserId: payload.principalId,
    evidence: [],
    data: { workflow: "purchasing.reroute-po", version: 1, step, rationale, ...data as object }
  }).pipe(Effect.orDie)
  const auditedStep = <A, E, R>(step: string, rationale: string, effect: Effect.Effect<A, E, R>) => Effect.gen(function*() {
    yield* appendWorkflowEvent("workflow.step.started", step, rationale)
    return yield* effect.pipe(
      Effect.tap((result) => appendWorkflowEvent("workflow.step.completed", step, rationale, { result })),
      Effect.tapError((error) => appendWorkflowEvent("workflow.step.failed", step, rationale, { error: String(error) }))
    )
  })

  yield* appendWorkflowEvent("workflow.started", "workflow", "Execute the approved reroute definition in its declared order.", { executionId: instance.executionId })

  const supplier = yield* Activity.make({
    name: "01-confirm-alternate-approved",
    success: Supplier,
    error: RerouteWorkflowError,
    execute: auditedStep("01-confirm-alternate-approved", "Only an approved supplier for this exact part may receive the replacement PO.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const originalPo = yield* erp.getPurchaseOrder(principal, payload.originalPoId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      if (originalPo.partId !== payload.partId) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `PO ${payload.originalPoId} does not contain ${payload.partId}` })
      if (originalPo.supplierId === payload.alternateSupplierId) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `Supplier ${payload.alternateSupplierId} is already the supplier on ${payload.originalPoId}` })
      const suppliers = yield* erp.listSuppliersForPart(principal, payload.partId).pipe(Effect.mapError(failStep("confirm-alternate-approved")))
      const candidate = suppliers.find((item) => item.supplierId === payload.alternateSupplierId)
      if (candidate === undefined || !candidate.approved || !candidate.approvedParts.includes(payload.partId)) return yield* new RerouteWorkflowError({ step: "confirm-alternate-approved", message: `Supplier ${payload.alternateSupplierId} is not approved for ${payload.partId}` })
      return candidate
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation(() => appendWorkflowEvent(
    "workflow.step.compensated",
    "01-confirm-alternate-approved",
    "This validation is read-only, so its compensation is an explicit no-op."
  )))

  const qualified = yield* Activity.make({
    name: "02-confirm-lead-time",
    success: QualifiedSupplier,
    error: RerouteWorkflowError,
    execute: auditedStep("02-confirm-lead-time", "The alternate must arrive no later than the production start.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const production = yield* erp.getProductionOrder(principal, payload.productionOrderId).pipe(Effect.mapError(failStep("confirm-lead-time")))
      const now = yield* clock.now.pipe(Effect.mapError(failStep("confirm-lead-time")))
      const orderedDate = now.slice(0, 10)
      const arrival = new Date(`${orderedDate}T12:00:00Z`)
      arrival.setUTCDate(arrival.getUTCDate() + supplier.leadTimeDays)
      if (arrival.getTime() > new Date(production.scheduledStart).getTime()) return yield* new RerouteWorkflowError({ step: "confirm-lead-time", message: `Supplier ${supplier.supplierId} cannot arrive before ${production.scheduledStart}` })
      return new QualifiedSupplier({ supplier, orderedDate, promisedDate: arrival.toISOString().slice(0, 10), followUpDate: nextTuesday(orderedDate) })
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation(() => appendWorkflowEvent(
    "workflow.step.compensated",
    "02-confirm-lead-time",
    "This validation is read-only, so its compensation is an explicit no-op."
  )))

  const price = qualified.supplier.pricing.find((entry) => entry.partId === payload.partId)
  if (price === undefined) return yield* new RerouteWorkflowError({ step: "create-new-po", message: "Approved supplier price disappeared before execution" })
  const suffix = instance.executionId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase()
  const replacementPoId = `PO-R-${suffix}`

  const created = yield* Activity.make({
    name: "03-create-new-po",
    success: CreatePurchaseOrderOutput,
    error: RerouteWorkflowError,
    execute: auditedStep("03-create-new-po", "Create the safe replacement before touching the incumbent PO.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("create-new-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("create-new-po")
      const result = yield* runtime.execute({ tool: "erp.create-po", principal, idempotencyKey, audit: toolAudit, input: { poId: replacementPoId, partId: payload.partId, supplierId: qualified.supplier.supplierId, qty: payload.quantity, unitPrice: price.unitPrice, orderedDate: qualified.orderedDate, promisedDate: qualified.promisedDate } }).pipe(Effect.mapError(failStep("create-new-po")))
      return yield* decodeCreatePurchaseOrderOutput(result).pipe(Effect.mapError(failStep("create-new-po")))
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey: `compensate:${instance.executionId}:new-po`, audit: toolAudit, input: { poId: result.poId, status: "cancelled" } }).pipe(Effect.catch(() => Effect.void))
    yield* appendWorkflowEvent("workflow.step.compensated", "03-create-new-po", "A later step failed, so the replacement PO was cancelled.", { poId: result.poId })
  })))

  yield* crash.afterActivity("03-create-new-po")

  yield* Activity.make({
    name: "04-cancel-old-po",
    success: ChangePurchaseOrderStatusOutput,
    error: RerouteWorkflowError,
    execute: auditedStep("04-cancel-old-po", "Retire the delayed PO only after the replacement exists.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("cancel-old-po")))
      const idempotencyKey = yield* Activity.idempotencyKey("cancel-old-po")
      const result = yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey, audit: toolAudit, input: { poId: payload.originalPoId, status: "cancelled" } }).pipe(Effect.mapError(failStep("cancel-old-po")))
      return yield* decodeChangePurchaseOrderStatusOutput(result).pipe(Effect.mapError(failStep("cancel-old-po")))
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "erp.set-po-status", principal, idempotencyKey: `compensate:${instance.executionId}:old-po`, audit: toolAudit, input: { poId: payload.originalPoId, status: result.previousStatus === "open" ? "open" : "cancelled" } }).pipe(Effect.catch(() => Effect.void))
    yield* appendWorkflowEvent("workflow.step.compensated", "04-cancel-old-po", "A later step failed, so the original PO status was restored.", { poId: payload.originalPoId, restoredStatus: result.previousStatus })
  })))

  const messageId = `M-PROD-${suffix}`
  yield* Activity.make({
    name: "05-notify-production",
    success: NotifyProductionOutput,
    error: RerouteWorkflowError,
    execute: auditedStep("05-notify-production", "Production needs the new supply promise after both PO changes are committed.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("notify-production")))
      const idempotencyKey = yield* Activity.idempotencyKey("notify-production")
      const result = yield* runtime.execute({ tool: "production.notify", principal, idempotencyKey, audit: toolAudit, input: { messageId, productionOrderId: payload.productionOrderId, message: `PO ${payload.originalPoId} was rerouted to ${qualified.supplier.name}. Replacement ${created.poId} is promised ${qualified.promisedDate}.` } }).pipe(Effect.mapError(failStep("notify-production")))
      return yield* decodeNotifyProductionOutput(result).pipe(Effect.mapError(failStep("notify-production")))
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation(() => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "production.notify", principal, idempotencyKey: `compensate:${instance.executionId}:notify`, audit: toolAudit, input: { messageId: `${messageId}-CORRECTION`, productionOrderId: payload.productionOrderId, message: `Correction: reroute workflow ${instance.executionId} was rolled back. Use the restored PO state.` } }).pipe(Effect.catch(() => Effect.void))
    yield* appendWorkflowEvent("workflow.step.compensated", "05-notify-production", "Notifications cannot be deleted reliably, so compensation sends a correction.", { correctionMessageId: `${messageId}-CORRECTION` })
  })))

  const workId = `WORK-${suffix}`
  const scheduled = yield* Activity.make({
    name: "06-schedule-arrival-check",
    success: ScheduleArrivalCheckOutput,
    error: RerouteWorkflowError,
    execute: auditedStep("06-schedule-arrival-check", "Persist a Tuesday check so the new promise is verified after this process exits.", Effect.gen(function*() {
      const principal = yield* directory.get(payload.principalId).pipe(Effect.mapError(failStep("schedule-arrival-check")))
      const idempotencyKey = yield* Activity.idempotencyKey("schedule-arrival-check")
      const result = yield* runtime.execute({ tool: "schedule.arrival-check", principal, idempotencyKey, audit: toolAudit, input: { workId, runAt: `${qualified.followUpDate}T09:00:00-06:00`, poId: replacementPoId, partId: payload.partId, productionOrderId: payload.productionOrderId, principalId: payload.principalId } }).pipe(Effect.mapError(failStep("schedule-arrival-check")))
      return yield* decodeScheduleArrivalCheckOutput(result).pipe(Effect.mapError(failStep("schedule-arrival-check")))
    }))
  }).pipe(ReroutePurchaseOrderWorkflow.withCompensation((result) => Effect.gen(function*() {
    const principal = yield* directory.get(payload.principalId).pipe(Effect.orDie)
    yield* runtime.execute({ tool: "schedule.cancel", principal, idempotencyKey: `compensate:${instance.executionId}:schedule`, audit: toolAudit, input: { workId: result.workId } }).pipe(Effect.catch(() => Effect.void))
    yield* appendWorkflowEvent("workflow.step.compensated", "06-schedule-arrival-check", "A rolled-back reroute must not leave stale deferred work.", { workId: result.workId })
  })))

  const result = new RerouteWorkflowResult({ replacementPoId: created.poId, scheduledWorkId: scheduled.workId })
  yield* appendWorkflowEvent("workflow.completed", "workflow", "All declared steps completed in order.", { result })
  return result
}))

export const ReroutePurchaseOrder = versionedWorkflow("purchasing.reroute-po", 1, ReroutePurchaseOrderWorkflow)
