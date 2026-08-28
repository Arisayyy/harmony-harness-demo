import { Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Part } from "../../domain/purchasing/model/part"
import { ProductionComponent, ProductionOrder } from "../../domain/purchasing/model/production-order"
import { PurchaseOrder } from "../../domain/purchasing/model/purchase-order"
import { Supplier, SupplierPrice } from "../../domain/purchasing/model/supplier"
import { QualityLot } from "../../domain/quality/model/quality-lot"
import { hasScope } from "../../harness/authorization/permissions/principal"
import { ErpProvider, ProviderDenied, ProviderNotFound } from "./erp-provider"

const requireScope = (scopes: ReadonlyArray<string>, scope: string) => scopes.includes(scope)
  ? Effect.void
  : Effect.fail(new ProviderDenied({ provider: "erp", requiredScope: scope }))

export const layer = Layer.effect(
  ErpProvider,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return ErpProvider.of({
      getPart: Effect.fn("ErpProvider.getPart")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:part:read")
        const rows = yield* sql<any>`SELECT * FROM parts WHERE part_id = ${partId}`
        const row = rows[0]
        if (row === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "part", id: partId })
        return new Part({ partId: row.part_id, description: row.description, onHand: row.on_hand, dailyUsage: row.daily_usage, safetyStock: row.safety_stock, unitCost: row.unit_cost, lotTracked: row.lot_tracked === 1 })
      }),
      getPurchaseOrder: Effect.fn("ErpProvider.getPurchaseOrder")(function*(principal, poId) {
        yield* requireScope(principal.scopes, "erp:po:read")
        const rows = yield* sql<any>`SELECT * FROM purchase_orders WHERE po_id = ${poId}`
        const row = rows[0]
        if (row === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "purchase_order", id: poId })
        return new PurchaseOrder({ poId: row.po_id, partId: row.part_id, supplierId: row.supplier_id, qty: row.qty, unitPrice: row.unit_price, totalValue: row.total_value, orderedDate: row.ordered_date, promisedDate: row.promised_date, status: row.status, createdBy: row.created_by })
      }),
      getProductionOrder: Effect.fn("ErpProvider.getProductionOrder")(function*(principal, productionOrderId) {
        yield* requireScope(principal.scopes, "erp:production:read")
        const rows = yield* sql<any>`SELECT * FROM production_orders WHERE production_order_id = ${productionOrderId}`
        const row = rows[0]
        if (row === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "production_order", id: productionOrderId })
        return new ProductionOrder({
          productionOrderId: row.production_order_id,
          product: row.product,
          qty: row.qty,
          scheduledStart: row.scheduled_start,
          scheduledEnd: row.scheduled_end,
          status: row.status,
          line: row.line,
          supervisorId: row.supervisor_id,
          components: JSON.parse(row.components_json).map((component: any) => new ProductionComponent(component))
        })
      }),
      listSuppliersForPart: Effect.fn("ErpProvider.listSuppliersForPart")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:supplier:read")
        const rows = yield* sql<any>`SELECT * FROM suppliers`
        return rows
          .map((row) => new Supplier({
            supplierId: row.supplier_id,
            name: row.name,
            contactEmail: row.contact_email,
            approved: row.approved === 1,
            approvedParts: JSON.parse(row.approved_parts_json),
            leadTimeDays: row.lead_time_days,
            pricing: JSON.parse(row.pricing_json).map((price: any) => new SupplierPrice(price))
          }))
          .filter((supplier) => supplier.approvedParts.includes(partId) || supplier.pricing.some((price) => price.partId === partId))
      }),
      listQualityLots: Effect.fn("ErpProvider.listQualityLots")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:quality:read")
        const rows = yield* sql<any>`SELECT * FROM quality_lots WHERE part_id = ${partId}`
        return rows.map((row) => new QualityLot({
          lotId: row.lot_id,
          partId: row.part_id,
          qty: row.qty,
          status: row.status,
          receivedDate: row.received_date,
          allocatedTo: JSON.parse(row.allocated_to_json),
          holdReason: row.hold_reason ?? undefined,
          holdPlacedBy: row.hold_placed_by ?? undefined,
          holdPlacedOn: row.hold_placed_on ?? undefined
        }))
      })
    })
  })
)
