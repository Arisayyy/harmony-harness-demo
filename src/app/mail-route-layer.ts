import { Effect, Layer } from "effect"
import { SupplyRiskDetector } from "../domain/purchasing/detectors/supply-risk-detector"
import { MailRouteCatalog, makeMailRouteCatalog } from "../harness/events/catalog/mail-route-catalog"

export const layer = Layer.effect(
  MailRouteCatalog,
  Effect.gen(function*() {
    const supplyRisk = yield* SupplyRiskDetector
    return makeMailRouteCatalog([
      {
        route: "purchasing.supply-risk",
        description: "Supplier shipment delays, revised delivery dates, PO slippage, or other inbound mail that may put near-term production supply at risk.",
        handle: supplyRisk.fromMail
      }
    ])
  })
)
