import { Context, Data, Effect } from "effect"
import type { Part } from "../../domain/purchasing/model/part"
import type { ProductionOrder } from "../../domain/purchasing/model/production-order"
import type { PurchaseOrder } from "../../domain/purchasing/model/purchase-order"
import type { Supplier } from "../../domain/purchasing/model/supplier"
import type { QualityLot } from "../../domain/quality/model/quality-lot"
import type { Principal } from "../../harness/authorization/permissions/principal"

export class ProviderDenied extends Data.TaggedError("ProviderDenied")<{
  readonly provider: "erp" | "mail" | "calendar"
  readonly requiredScope: string
}> {}

export class ErpProvider extends Context.Service<ErpProvider, {
  readonly getPart: (principal: Principal, partId: string) => Effect.Effect<Part, ProviderDenied>
  readonly getPurchaseOrder: (principal: Principal, poId: string) => Effect.Effect<PurchaseOrder, ProviderDenied>
  readonly getProductionOrder: (principal: Principal, productionOrderId: string) => Effect.Effect<ProductionOrder, ProviderDenied>
  readonly listSuppliersForPart: (principal: Principal, partId: string) => Effect.Effect<ReadonlyArray<Supplier>, ProviderDenied>
  readonly listQualityLots: (principal: Principal, partId: string) => Effect.Effect<ReadonlyArray<QualityLot>, ProviderDenied>
}>()("harmony/integrations/ErpProvider") {}
