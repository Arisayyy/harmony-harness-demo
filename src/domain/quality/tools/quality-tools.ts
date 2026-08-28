import { Data, Effect, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { defineTool } from "../../../harness/tools/catalog/tool"

export class QualityToolError extends Data.TaggedError("QualityToolError")<{ readonly message: string }> {}

export class ReallocateLotInput extends Schema.Class<ReallocateLotInput>("ReallocateLotInput")({
  productionOrderId: Schema.String,
  partId: Schema.String,
  fromLotId: Schema.String,
  toLotId: Schema.String,
  quantity: Schema.Number
}) {}

export class ReallocateLotOutput extends Schema.Class<ReallocateLotOutput>("ReallocateLotOutput")({
  productionOrderId: Schema.String,
  fromLotId: Schema.String,
  toLotId: Schema.String,
  quantity: Schema.Number
}) {}

export const makeQualityTools = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  return [defineTool({
    name: "quality.reallocate-lot",
    input: ReallocateLotInput,
    output: ReallocateLotOutput,
    requiredScopes: ["erp:quality:reallocate"],
    execute: Effect.fn("tool.quality.reallocate-lot")(function*(_principal, input: ReallocateLotInput) {
      const lots = yield* sql<any>`SELECT * FROM quality_lots WHERE lot_id IN (${input.fromLotId}, ${input.toLotId})`
      const target = lots.find((row) => row.lot_id === input.toLotId)
      if (target === undefined || target.status !== "good" || target.qty < input.quantity) {
        return yield* new QualityToolError({ message: `Lot ${input.toLotId} cannot cover ${input.quantity} units` })
      }

      const orders = yield* sql<any>`SELECT components_json FROM production_orders WHERE production_order_id = ${input.productionOrderId}`
      if (orders[0] === undefined) return yield* new QualityToolError({ message: `Production order ${input.productionOrderId} does not exist` })
      const components = JSON.parse(orders[0].components_json).map((component: any) =>
        component.partId === input.partId && component.lotId === input.fromLotId ? { ...component, lotId: input.toLotId } : component
      )

      yield* sql.withTransaction(Effect.gen(function*() {
        yield* sql`UPDATE production_orders SET components_json = ${JSON.stringify(components)} WHERE production_order_id = ${input.productionOrderId}`
        const allocations = JSON.parse(target.allocated_to_json)
        yield* sql`UPDATE quality_lots SET allocated_to_json = ${JSON.stringify([...new Set([...allocations, input.productionOrderId])])} WHERE lot_id = ${input.toLotId}`
      }))

      return new ReallocateLotOutput({ ...input })
    })
  })] as const
})
