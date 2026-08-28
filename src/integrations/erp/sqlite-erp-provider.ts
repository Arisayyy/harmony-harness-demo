import { Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Part } from "../../domain/purchasing/model/part"
import { ProductionComponent, ProductionOrder } from "../../domain/purchasing/model/production-order"
import { PurchaseOrder } from "../../domain/purchasing/model/purchase-order"
import { Supplier, SupplierPrice } from "../../domain/purchasing/model/supplier"
import { QualityLot } from "../../domain/quality/model/quality-lot"
import { ErpProvider, ProviderDenied, ProviderNotFound } from "./erp-provider"

const requireScope = (scopes: ReadonlyArray<string>, scope: string) => scopes.includes(scope)
  ? Effect.void
  : Effect.fail(new ProviderDenied({ provider: "erp", requiredScope: scope }))

const partFromRow = (row: any) => new Part({ partId: row.part_id, description: row.description, onHand: row.on_hand, dailyUsage: row.daily_usage, safetyStock: row.safety_stock, unitCost: row.unit_cost, lotTracked: row.lot_tracked === 1 })
const poFromRow = (row: any) => new PurchaseOrder({ poId: row.po_id, partId: row.part_id, supplierId: row.supplier_id, qty: row.qty, unitPrice: row.unit_price, totalValue: row.total_value, orderedDate: row.ordered_date, promisedDate: row.promised_date, status: row.status, createdBy: row.created_by })
const productionFromRow = (row: any) => new ProductionOrder({ productionOrderId: row.production_order_id, product: row.product, qty: row.qty, scheduledStart: row.scheduled_start, scheduledEnd: row.scheduled_end, status: row.status, line: row.line, supervisorId: row.supervisor_id, components: JSON.parse(row.components_json).map((component: any) => new ProductionComponent(component)) })
const lotFromRow = (row: any) => new QualityLot({ lotId: row.lot_id, partId: row.part_id, qty: row.qty, status: row.status, receivedDate: row.received_date, allocatedTo: JSON.parse(row.allocated_to_json), holdReason: row.hold_reason ?? undefined, holdPlacedBy: row.hold_placed_by ?? undefined, holdPlacedOn: row.hold_placed_on ?? undefined })

export const layer = Layer.effect(
  ErpProvider,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return ErpProvider.of({
      getPart: Effect.fn("ErpProvider.getPart")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:part:read")
        const rows = yield* sql<any>`SELECT * FROM parts WHERE part_id = ${partId}`
        if (rows[0] === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "part", id: partId })
        return partFromRow(rows[0])
      }),
      getPurchaseOrder: Effect.fn("ErpProvider.getPurchaseOrder")(function*(principal, poId) {
        yield* requireScope(principal.scopes, "erp:po:read")
        const rows = yield* sql<any>`SELECT * FROM purchase_orders WHERE po_id = ${poId}`
        if (rows[0] === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "purchase_order", id: poId })
        return poFromRow(rows[0])
      }),
      getProductionOrder: Effect.fn("ErpProvider.getProductionOrder")(function*(principal, productionOrderId) {
        yield* requireScope(principal.scopes, "erp:production:read")
        const rows = yield* sql<any>`SELECT * FROM production_orders WHERE production_order_id = ${productionOrderId}`
        if (rows[0] === undefined) return yield* new ProviderNotFound({ provider: "erp", entity: "production_order", id: productionOrderId })
        return productionFromRow(rows[0])
      }),
      listParts: Effect.fn("ErpProvider.listParts")(function*(principal) {
        yield* requireScope(principal.scopes, "erp:part:read")
        return (yield* sql<any>`SELECT * FROM parts ORDER BY part_id`).map(partFromRow)
      }),
      listOpenPurchaseOrders: Effect.fn("ErpProvider.listOpenPurchaseOrders")(function*(principal) {
        yield* requireScope(principal.scopes, "erp:po:read")
        return (yield* sql<any>`SELECT * FROM purchase_orders WHERE status = 'open' ORDER BY po_id`).map(poFromRow)
      }),
      listPlannedProductionOrders: Effect.fn("ErpProvider.listPlannedProductionOrders")(function*(principal) {
        yield* requireScope(principal.scopes, "erp:production:read")
        return (yield* sql<any>`SELECT * FROM production_orders WHERE status = 'planned' ORDER BY scheduled_start`).map(productionFromRow)
      }),
      listSuppliersForPart: Effect.fn("ErpProvider.listSuppliersForPart")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:supplier:read")
        const rows = yield* sql<any>`SELECT * FROM suppliers`
        return rows.map((row) => new Supplier({ supplierId: row.supplier_id, name: row.name, contactEmail: row.contact_email, approved: row.approved === 1, approvedParts: JSON.parse(row.approved_parts_json), leadTimeDays: row.lead_time_days, pricing: JSON.parse(row.pricing_json).map((price: any) => new SupplierPrice(price)) })).filter((supplier) => supplier.approvedParts.includes(partId) || supplier.pricing.some((price) => price.partId === partId))
      }),
      listQualityLots: Effect.fn("ErpProvider.listQualityLots")(function*(principal, partId) {
        yield* requireScope(principal.scopes, "erp:quality:read")
        return (yield* sql<any>`SELECT * FROM quality_lots WHERE part_id = ${partId}`).map(lotFromRow)
      }),
      listHeldQualityLots: Effect.fn("ErpProvider.listHeldQualityLots")(function*(principal) {
        yield* requireScope(principal.scopes, "erp:quality:read")
        return (yield* sql<any>`SELECT * FROM quality_lots WHERE status = 'hold' ORDER BY hold_placed_on`).map(lotFromRow)
      })
    })
  })
)
