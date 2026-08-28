import { Schema } from "effect"

export class ProductionComponent extends Schema.Class<ProductionComponent>("ProductionComponent")({
  partId: Schema.String,
  qty: Schema.Number,
  lotId: Schema.optional(Schema.String)
}) {}

export class ProductionOrder extends Schema.Class<ProductionOrder>("ProductionOrder")({
  productionOrderId: Schema.String,
  product: Schema.String,
  qty: Schema.Number,
  scheduledStart: Schema.String,
  scheduledEnd: Schema.String,
  status: Schema.Literals(["planned", "released", "complete"]),
  line: Schema.String,
  supervisorId: Schema.String,
  components: Schema.Array(ProductionComponent)
}) {}
