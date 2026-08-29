import { Effect, Layer } from "effect"
import { QualityHoldContext } from "../domain/quality/context/quality-hold-context"
import { SupplyRiskContext } from "../domain/purchasing/context/supply-risk-context"
import { ContextResolverCatalog, makeContextResolverCatalog } from "../harness/agent/context/context-resolver-catalog"

export const layer = Layer.effect(
  ContextResolverCatalog,
  Effect.gen(function*() {
    const supplyRisk = yield* SupplyRiskContext
    const qualityHold = yield* QualityHoldContext
    return makeContextResolverCatalog([
      { kind: "purchasing.supply-risk", gather: supplyRisk.gather },
      { kind: "quality.lot-hold", gather: qualityHold.gather }
    ])
  })
)
