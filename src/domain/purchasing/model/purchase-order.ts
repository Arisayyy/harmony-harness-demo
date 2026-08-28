import { Schema } from "effect"

export const PurchaseOrderStatus = Schema.Literals(["open", "cancelled", "received"])
export type PurchaseOrderStatus = typeof PurchaseOrderStatus.Type

export class PurchaseOrder extends Schema.Class<PurchaseOrder>("PurchaseOrder")({
  poId: Schema.String,
  partId: Schema.String,
  supplierId: Schema.String,
  qty: Schema.Number,
  unitPrice: Schema.Number,
  totalValue: Schema.Number,
  orderedDate: Schema.String,
  promisedDate: Schema.String,
  status: PurchaseOrderStatus,
  createdBy: Schema.String
}) {}
