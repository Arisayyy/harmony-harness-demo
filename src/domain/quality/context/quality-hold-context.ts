import { Context, Effect, Layer } from "effect"
import type { AttentionItem } from "../../../harness/agent/context/attention-item"
import { evidenceSnapshot } from "../../../harness/agent/context/evidence"
import type { EvidenceSnapshot } from "../../../harness/audit/model/audit-event"
import type { Principal } from "../../../harness/authorization/permissions/principal"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { ErpProvider } from "../../../integrations/erp/erp-provider"

export class QualityHoldContext extends Context.Service<QualityHoldContext, {
  readonly gather: (principal: Principal, attention: AttentionItem) => Effect.Effect<ReadonlyArray<EvidenceSnapshot>, unknown>
}>()("harmony/quality/QualityHoldContext") {}

export const layer = Layer.effect(
  QualityHoldContext,
  Effect.gen(function*() {
    const erp = yield* ErpProvider
    const clock = yield* BusinessClock

    return QualityHoldContext.of({
      gather: Effect.fn("QualityHoldContext.gather")(function*(principal, attention) {
        const payload = attention.payload as { partId: string; productionOrderId: string }
        const observedAt = yield* clock.now
        const context = yield* Effect.all({ part: erp.getPart(principal, payload.partId), production: erp.getProductionOrder(principal, payload.productionOrderId), lots: erp.listQualityLots(principal, payload.partId) }, { concurrency: "unbounded" })
        return [evidenceSnapshot("erp", context.part.partId, observedAt, context.part), evidenceSnapshot("erp", context.production.productionOrderId, observedAt, context.production), ...context.lots.map((lot) => evidenceSnapshot("erp", lot.lotId, observedAt, lot))]
      })
    })
  })
)
