import { Context, Crypto, Effect, Layer } from "effect"
import { AttentionItem } from "../../../harness/agent/context/attention-item"
import { AttentionRepository } from "../../../harness/agent/context/attention-repository"
import type { Principal } from "../../../harness/authorization/permissions/principal"
import type { InboundMail } from "../../../harness/events/model/inbound-mail"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { ErpProvider } from "../../../integrations/erp/erp-provider"

export class SupplyRiskDetector extends Context.Service<SupplyRiskDetector, {
  readonly fromMail: (principal: Principal, mail: InboundMail) => Effect.Effect<ReadonlyArray<AttentionItem>, unknown>
}>()("harmony/purchasing/SupplyRiskDetector") {}

const daysBetween = (from: string, to: string) => Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)

export const layer = Layer.effect(
  SupplyRiskDetector,
  Effect.gen(function*() {
    const erp = yield* ErpProvider
    const attention = yield* AttentionRepository
    const clock = yield* BusinessClock
    const crypto = yield* Crypto.Crypto

    return SupplyRiskDetector.of({
      fromMail: Effect.fn("SupplyRiskDetector.fromMail")(function*(principal, mail) {
        const now = yield* clock.now
        const [parts, purchaseOrders, productionOrders] = yield* Effect.all([
          erp.listParts(principal),
          erp.listOpenPurchaseOrders(principal),
          erp.listPlannedProductionOrders(principal)
        ], { concurrency: "unbounded" })
        const mailText = `${mail.subject}\n${mail.body}`
        const found: Array<AttentionItem> = []

        for (const part of parts) {
          if (part.dailyUsage <= 0) continue
          const daysToSafetyStock = (part.onHand - part.safetyStock) / part.dailyUsage
          if (daysToSafetyStock > 5) continue
          const po = purchaseOrders.find((candidate) => candidate.partId === part.partId && mailText.includes(candidate.poId))
          if (po === undefined) continue
          const production = productionOrders.find((candidate) =>
            candidate.components.some((component) => component.partId === part.partId) && daysBetween(now, candidate.scheduledStart) <= 5
          )
          if (production === undefined) continue

          const item = new AttentionItem({
            attentionId: yield* crypto.randomUUIDv4,
            detector: "purchasing.supply-risk/v2-mail-event",
            dedupeKey: `purchasing-risk:${part.partId}:${po.poId}:${production.productionOrderId}:${mail.messageId}`,
            principalId: principal.userId,
            kind: "purchasing.supply-risk",
            payload: { partId: part.partId, poId: po.poId, productionOrderId: production.productionOrderId, delayMessageId: mail.messageId },
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
