import { Schema } from "effect"

export class Part extends Schema.Class<Part>("Part")({
  partId: Schema.String,
  description: Schema.String,
  onHand: Schema.Number,
  dailyUsage: Schema.Number,
  safetyStock: Schema.Number,
  unitCost: Schema.Number,
  lotTracked: Schema.Boolean
}) {}
