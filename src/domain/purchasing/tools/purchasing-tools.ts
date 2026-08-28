import { Data, Effect, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { defineTool } from "../../../harness/tools/catalog/tool"

export class PurchaseOrderToolError extends Data.TaggedError("PurchaseOrderToolError")<{ readonly message: string }> {}

export class CreatePurchaseOrderInput extends Schema.Class<CreatePurchaseOrderInput>("CreatePurchaseOrderInput")({
  poId: Schema.String,
  partId: Schema.String,
  supplierId: Schema.String,
  qty: Schema.Number,
  unitPrice: Schema.Number,
  orderedDate: Schema.String,
  promisedDate: Schema.String
}) {}

export class CreatePurchaseOrderOutput extends Schema.Class<CreatePurchaseOrderOutput>("CreatePurchaseOrderOutput")({
  poId: Schema.String,
  totalValue: Schema.Number
}) {}

export class ChangePurchaseOrderStatusInput extends Schema.Class<ChangePurchaseOrderStatusInput>("ChangePurchaseOrderStatusInput")({
  poId: Schema.String,
  status: Schema.Literals(["open", "cancelled"])
}) {}

export class ChangePurchaseOrderStatusOutput extends Schema.Class<ChangePurchaseOrderStatusOutput>("ChangePurchaseOrderStatusOutput")({
  poId: Schema.String,
  previousStatus: Schema.String,
  status: Schema.String
}) {}

export const makePurchasingTools = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  return [
    defineTool({
      name: "erp.create-po",
      input: CreatePurchaseOrderInput,
      output: CreatePurchaseOrderOutput,
      requiredScopes: ["erp:po:create"],
      execute: Effect.fn("tool.erp.create-po")(function*(principal, input: CreatePurchaseOrderInput) {
        const totalValue = input.qty * input.unitPrice
        yield* sql`INSERT INTO purchase_orders (po_id, part_id, supplier_id, qty, unit_price, total_value, ordered_date, promised_date, status, created_by)
          VALUES (${input.poId}, ${input.partId}, ${input.supplierId}, ${input.qty}, ${input.unitPrice}, ${totalValue}, ${input.orderedDate}, ${input.promisedDate}, 'open', ${principal.userId})`
        return new CreatePurchaseOrderOutput({ poId: input.poId, totalValue })
      })
    }),
    defineTool({
      name: "erp.set-po-status",
      input: ChangePurchaseOrderStatusInput,
      output: ChangePurchaseOrderStatusOutput,
      requiredScopes: ["erp:po:cancel"],
      execute: Effect.fn("tool.erp.set-po-status")(function*(_principal, input: ChangePurchaseOrderStatusInput) {
        const rows = yield* sql<any>`SELECT status FROM purchase_orders WHERE po_id = ${input.poId}`
        const row = rows[0]
        if (row === undefined) return yield* new PurchaseOrderToolError({ message: `PO ${input.poId} does not exist` })
        yield* sql`UPDATE purchase_orders SET status = ${input.status} WHERE po_id = ${input.poId}`
        return new ChangePurchaseOrderStatusOutput({ poId: input.poId, previousStatus: row.status, status: input.status })
      })
    })
  ] as const
})
