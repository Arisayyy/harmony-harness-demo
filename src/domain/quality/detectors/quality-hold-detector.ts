import { Context, Effect, Layer } from "effect"
import { AttentionItem } from "../../../harness/agent/context/attention-item"
import { AttentionRepository } from "../../../harness/agent/context/attention-repository"
import type { Principal } from "../../../harness/authorization/permissions/principal"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { ErpProvider } from "../../../integrations/erp/erp-provider"

export class QualityHoldDetector extends Context.Service<QualityHoldDetector, {
  readonly scan: (principal: Principal) => Effect.Effect<ReadonlyArray<AttentionItem>, unknown>
}>()("harmony/quality/QualityHoldDetector") {}

const daysBetween = (from: string, to: string) => Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)

export const layer = Layer.effect(
  QualityHoldDetector,
  Effect.gen(function*() {
    const erp = yield* ErpProvider
    const attention = yield* AttentionRepository
    const clock = yield* BusinessClock

    return QualityHoldDetector.of({
      scan: Effect.fn("QualityHoldDetector.scan")(function*(principal) {
        const now = yield* clock.now
        const [heldLots, productionOrders] = yield* Effect.all([
          erp.listHeldQualityLots(principal),
          erp.listPlannedProductionOrders(principal)
        ], { concurrency: "unbounded" })
        const found: Array<AttentionItem> = []

        for (const lot of heldLots) {
          const production = productionOrders.find((candidate) =>
            candidate.components.some((component) => component.partId === lot.partId && component.lotId === lot.lotId) && daysBetween(now, candidate.scheduledStart) <= 3
          )
          if (production === undefined) continue
          const component = production.components.find((candidate) => candidate.partId === lot.partId && candidate.lotId === lot.lotId)
          if (component === undefined) continue
          const item = new AttentionItem({
            attentionId: crypto.randomUUID(),
            detector: "quality.lot-hold/v1",
            dedupeKey: `quality-hold:${lot.lotId}:${production.productionOrderId}`,
            principalId: principal.userId,
            kind: "quality.lot-hold",
            payload: { lotId: lot.lotId, partId: lot.partId, productionOrderId: production.productionOrderId, requiredQuantity: component.qty },
            status: "open",
            createdAt: now
          })
          if (yield* attention.putIfAbsent(item)) found.push(item)
        }

        return found
      })
    })
  })
)
