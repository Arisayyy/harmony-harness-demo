import { Schema } from "effect"

export class ReroutePurchaseOrderParameters extends Schema.Class<ReroutePurchaseOrderParameters>("ReroutePurchaseOrderParameters")({
  partId: Schema.String,
  originalPoId: Schema.String,
  productionOrderId: Schema.String,
  alternateSupplierId: Schema.String,
  quantity: Schema.Number
}) {}

export class ReallocateLotAction extends Schema.Class<ReallocateLotAction>("ReallocateLotAction")({
  _tag: Schema.Literal("quality.reallocate-lot"),
  productionOrderId: Schema.String,
  partId: Schema.String,
  fromLotId: Schema.String,
  toLotId: Schema.String,
  quantity: Schema.Number
}) {}

export class NotifyProductionAction extends Schema.Class<NotifyProductionAction>("NotifyProductionAction")({
  _tag: Schema.Literal("production.notify"),
  productionOrderId: Schema.String,
  message: Schema.String
}) {}

export class FlagShortageAction extends Schema.Class<FlagShortageAction>("FlagShortageAction")({
  _tag: Schema.Literal("purchasing.flag-shortage"),
  productionOrderId: Schema.String,
  partId: Schema.String,
  quantity: Schema.Number,
  reason: Schema.String
}) {}

export const ProposedAction = Schema.Union([ReallocateLotAction, NotifyProductionAction, FlagShortageAction])
export type ProposedAction = typeof ProposedAction.Type

const RecommendationCommon = {
  rationale: Schema.String,
  confidence: Schema.Number,
  evidenceRefs: Schema.Array(Schema.String)
}

export class NoAction extends Schema.Class<NoAction>("NoAction")({
  _tag: Schema.Literal("NoAction"),
  ...RecommendationCommon
}) {}

export class EnterWorkflow extends Schema.Class<EnterWorkflow>("EnterWorkflow")({
  _tag: Schema.Literal("EnterWorkflow"),
  workflow: Schema.Literal("purchasing.reroute-po"),
  ...RecommendationCommon,
  parameters: ReroutePurchaseOrderParameters
}) {}

export class ProposedActions extends Schema.Class<ProposedActions>("ProposedActions")({
  _tag: Schema.Literal("ProposedActions"),
  ...RecommendationCommon,
  actions: Schema.Array(ProposedAction)
}) {}

export const Recommendation = Schema.Union([NoAction, EnterWorkflow, ProposedActions])
export type Recommendation = typeof Recommendation.Type
