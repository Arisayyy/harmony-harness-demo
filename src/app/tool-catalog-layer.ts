import { Effect, Layer } from "effect"
import { makeProductionTools } from "../domain/purchasing/tools/production-tools"
import { makePurchasingTools } from "../domain/purchasing/tools/purchasing-tools"
import { makeQualityTools } from "../domain/quality/tools/quality-tools"
import { makeSchedulingTools } from "../harness/scheduling/service/scheduling-tools"
import { layer as catalogLayer } from "../harness/tools/catalog/tool-catalog"

export const layer = Layer.unwrap(Effect.gen(function*() {
  const groups = yield* Effect.all([makePurchasingTools, makeProductionTools, makeQualityTools, makeSchedulingTools])
  return catalogLayer(groups.flat())
}))
