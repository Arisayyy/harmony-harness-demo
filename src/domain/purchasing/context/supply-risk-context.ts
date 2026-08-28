import { Context, Effect, Layer } from "effect"
import type { AttentionItem } from "../../../harness/agent/context/attention-item"
import { evidenceSnapshot } from "../../../harness/agent/context/evidence"
import type { EvidenceSnapshot } from "../../../harness/audit/model/audit-event"
import type { Principal } from "../../../harness/authorization/permissions/principal"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { CalendarProvider } from "../../../integrations/calendar/calendar-provider"
import { ErpProvider } from "../../../integrations/erp/erp-provider"
import { MailProvider } from "../../../integrations/mail/mail-provider"

export class SupplyRiskContext extends Context.Service<SupplyRiskContext, {
  readonly gather: (principal: Principal, attention: AttentionItem) => Effect.Effect<ReadonlyArray<EvidenceSnapshot>, unknown>
}>()("harmony/purchasing/SupplyRiskContext") {}

export const layer = Layer.effect(
  SupplyRiskContext,
  Effect.gen(function*() {
    const erp = yield* ErpProvider
    const mail = yield* MailProvider
    const calendar = yield* CalendarProvider
    const clock = yield* BusinessClock

    return SupplyRiskContext.of({
      gather: Effect.fn("SupplyRiskContext.gather")(function*(principal, attention) {
        const payload = attention.payload as { partId: string; poId: string; productionOrderId: string }
        const observedAt = yield* clock.now
        const horizon = new Date(observedAt)
        horizon.setUTCDate(horizon.getUTCDate() + 3)
        const context = yield* Effect.all({
          part: erp.getPart(principal, payload.partId),
          po: erp.getPurchaseOrder(principal, payload.poId),
          production: erp.getProductionOrder(principal, payload.productionOrderId),
          suppliers: erp.listSuppliersForPart(principal, payload.partId),
          mail: mail.search(principal, payload.poId),
          calendar: calendar.listRange(principal, principal.userId, observedAt, horizon.toISOString())
        }, { concurrency: "unbounded" })
        return [
          evidenceSnapshot("erp", context.part.partId, observedAt, context.part),
          evidenceSnapshot("erp", context.po.poId, observedAt, context.po),
          evidenceSnapshot("erp", context.production.productionOrderId, observedAt, context.production),
          ...context.suppliers.map((supplier) => evidenceSnapshot("erp", supplier.supplierId, observedAt, supplier)),
          ...context.mail.map((message) => evidenceSnapshot("mail", message.messageId, observedAt, message)),
          ...context.calendar.map((event) => evidenceSnapshot("calendar", event.eventId, observedAt, event))
        ]
      })
    })
  })
)
