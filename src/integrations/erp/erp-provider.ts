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

export class ProviderNotFound extends Data.TaggedError("ProviderNotFound")<{
  readonly provider: "erp" | "mail" | "calendar"
  readonly entity: string
  readonly id: string
}> {}

export type ProviderError = ProviderDenied | ProviderNotFound

export class ErpProvider extends Context.Service<ErpProvider, {
  readonly getPart: (principal: Principal, partId: string) => Effect.Effect<Part, ProviderError>
  readonly getPurchaseOrder: (principal: Principal, poId: string) => Effect.Effect<PurchaseOrder, ProviderError>
  readonly getProductionOrder: (principal: Principal, productionOrderId: string) => Effect.Effect<ProductionOrder, ProviderError>
  readonly listParts: (principal: Principal) => Effect.Effect<ReadonlyArray<Part>, ProviderError>
  readonly listOpenPurchaseOrders: (principal: Principal) => Effect.Effect<ReadonlyArray<PurchaseOrder>, ProviderError>
  readonly listPlannedProductionOrders: (principal: Principal) => Effect.Effect<ReadonlyArray<ProductionOrder>, ProviderError>
  readonly listSuppliersForPart: (principal: Principal, partId: string) => Effect.Effect<ReadonlyArray<Supplier>, ProviderError>
  readonly listQualityLots: (principal: Principal, partId: string) => Effect.Effect<ReadonlyArray<QualityLot>, ProviderError>
  readonly listHeldQualityLots: (principal: Principal) => Effect.Effect<ReadonlyArray<QualityLot>, ProviderError>
}>()("harmony/integrations/ErpProvider") {}
