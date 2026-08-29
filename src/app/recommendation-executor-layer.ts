import { Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine"
import { ReroutePurchaseOrder, ReroutePurchaseOrderWorkflow } from "../domain/purchasing/workflows/reroute-purchase-order"
import { RecommendationExecutor } from "../harness/agent/execution/recommendation-executor"
import { ToolRuntime } from "../harness/tools/runtime/tool-runtime"

export const layer = Layer.effect(
  RecommendationExecutor,
  Effect.gen(function*() {
    const runtime = yield* ToolRuntime
    const engine = yield* WorkflowEngine

    return RecommendationExecutor.of({
      execute: Effect.fn("RecommendationExecutor.execute")(function*({ recommendation, runId, traceId, principal }) {
        switch (recommendation._tag) {
          case "EnterWorkflow": {
            const outcome = yield* ReroutePurchaseOrderWorkflow.execute({
              runId,
              traceId,
              principalId: principal.userId,
              partId: recommendation.parameters.partId,
              originalPoId: recommendation.parameters.originalPoId,
              productionOrderId: recommendation.parameters.productionOrderId,
              alternateSupplierId: recommendation.parameters.alternateSupplierId,
              quantity: recommendation.parameters.quantity
            }).pipe(Effect.provideService(WorkflowEngine, engine))
            return { actor: `workflow:${ReroutePurchaseOrder.name}@${ReroutePurchaseOrder.version}`, outcome }
          }
          case "ProposedActions": {
            const outcome = yield* Effect.forEach(recommendation.actions, (action, index) => {
              const suffix = runId.replace(/-/g, "").slice(0, 10)
              const input = action._tag === "production.notify" || action._tag === "purchasing.flag-shortage"
                ? { ...action, messageId: `M-${suffix}-${index}` }
                : action
              return runtime.execute({
                tool: action._tag,
                principal,
                input,
                idempotencyKey: `${runId}:action:${index}`,
                audit: { runId, traceId }
              })
            }, { concurrency: 1 })
            return { actor: "agent:bounded-actions", outcome }
          }
          case "NoAction":
            return { actor: "agent:no-action", outcome: { noAction: true } }
        }
      })
    })
  })
)
