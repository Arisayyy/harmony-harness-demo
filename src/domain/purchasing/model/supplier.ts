import { Schema } from "effect"

export class SupplierPrice extends Schema.Class<SupplierPrice>("SupplierPrice")({
  partId: Schema.String,
  unitPrice: Schema.Number
}) {}

export class Supplier extends Schema.Class<Supplier>("Supplier")({
  supplierId: Schema.String,
  name: Schema.String,
  contactEmail: Schema.String,
  approved: Schema.Boolean,
  approvedParts: Schema.Array(Schema.String),
  leadTimeDays: Schema.Number,
  pricing: Schema.Array(SupplierPrice)
}) {}
