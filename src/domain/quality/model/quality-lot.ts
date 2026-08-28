import { Schema } from "effect"

export class QualityLot extends Schema.Class<QualityLot>("QualityLot")({
  lotId: Schema.String,
  partId: Schema.String,
  qty: Schema.Number,
  status: Schema.Literal("good", "hold", "consumed"),
  receivedDate: Schema.String,
  allocatedTo: Schema.Array(Schema.String),
  holdReason: Schema.optional(Schema.String),
  holdPlacedBy: Schema.optional(Schema.String),
  holdPlacedOn: Schema.optional(Schema.String)
}) {}
