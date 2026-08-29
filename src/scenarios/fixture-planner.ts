import { Effect, Layer } from "effect"
import { Planner, PlannerInput, PlannerResult } from "../harness/agent/planning/planner"
import { EnterWorkflow, FlagShortageAction, NoAction, NotifyProductionAction, ProposedActions, ReallocateLotAction, ReroutePurchaseOrderParameters } from "../harness/agent/planning/recommendation"

const evidenceIds = (input: PlannerInput) => input.evidence.map((item) => item.sourceId)

const purchasing = (input: PlannerInput) => {
  const attention = input.attention as { partId: string; poId: string; productionOrderId: string; followUp?: boolean }
  if (attention.followUp === true) {
    return new ProposedActions({
      _tag: "ProposedActions",
      rationale: "The promised arrival check fired and the replacement PO is still not received. Production needs a fresh warning.",
      confidence: 1,
      evidenceRefs: evidenceIds(input),
      actions: [new NotifyProductionAction({
        _tag: "production.notify",
        productionOrderId: attention.productionOrderId,
        message: `Replacement PO ${attention.poId} is still not received at the scheduled arrival check. Please keep production order ${attention.productionOrderId} on the shortage watchlist.`
      })]
    })
  }
  const originalPo = input.evidence.find((item) => {
    const payload = item.payload as { poId?: string; supplierId?: string }
    return payload.poId === attention.poId
  })
  const originalSupplierId = (originalPo?.payload as { supplierId?: string } | undefined)?.supplierId
  const approvedSupplier = input.evidence.find((item) => {
    const payload = item.payload as { supplierId?: string; approved?: boolean; approvedParts?: ReadonlyArray<string> }
    return payload.supplierId !== originalSupplierId && payload.approved === true && payload.approvedParts?.includes(attention.partId)
  })
  const supplierId = (approvedSupplier?.payload as { supplierId?: string } | undefined)?.supplierId
  if (supplierId === undefined) {
    return new NoAction({ _tag: "NoAction", rationale: "No approved alternate supplier is present in the fixture evidence.", confidence: 1, evidenceRefs: evidenceIds(input) })
  }
  return new EnterWorkflow({
    _tag: "EnterWorkflow",
    workflow: "purchasing.reroute-po",
    rationale: "The supplier delay intersects the production window; reroute the PO to the approved alternate supplier.",
    confidence: 1,
    evidenceRefs: evidenceIds(input),
    parameters: new ReroutePurchaseOrderParameters({
      partId: attention.partId,
      originalPoId: attention.poId,
      productionOrderId: attention.productionOrderId,
      alternateSupplierId: supplierId,
      quantity: 400
    })
  })
}

const quality = (input: PlannerInput) => {
  const attention = input.attention as { lotId: string; partId: string; productionOrderId: string; requiredQuantity: number }
  const goodLot = input.evidence.find((item) => {
    const payload = item.payload as { lotId?: string; partId?: string; qty?: number; status?: string }
    return payload.partId === attention.partId && payload.status === "good" && (payload.qty ?? 0) >= attention.requiredQuantity
  })
  if (goodLot !== undefined) {
    const toLotId = (goodLot.payload as { lotId: string }).lotId
    return new ProposedActions({
      _tag: "ProposedActions",
      rationale: "The allocated lot is on hold and a good lot can fully cover the production requirement.",
      confidence: 1,
      evidenceRefs: evidenceIds(input),
      actions: [
        new ReallocateLotAction({ _tag: "quality.reallocate-lot", productionOrderId: attention.productionOrderId, partId: attention.partId, fromLotId: attention.lotId, toLotId, quantity: attention.requiredQuantity }),
        new NotifyProductionAction({ _tag: "production.notify", productionOrderId: attention.productionOrderId, message: `Reallocated ${attention.requiredQuantity} units of ${attention.partId} from held lot ${attention.lotId} to good lot ${toLotId}.` })
      ]
    })
  }
  return new ProposedActions({
    _tag: "ProposedActions",
    rationale: "The held lot blocks production and no good lot fully covers the required quantity.",
    confidence: 1,
    evidenceRefs: evidenceIds(input),
    actions: [new FlagShortageAction({ _tag: "purchasing.flag-shortage", productionOrderId: attention.productionOrderId, partId: attention.partId, quantity: attention.requiredQuantity, reason: `Quality hold on ${attention.lotId}; no good lot covers production demand.` })]
  })
}

export const layer = Layer.succeed(Planner, Planner.of({
  version: "fixture/v1",
  model: "deterministic-ci-fixture",
  plan: (input) => Effect.succeed(new PlannerResult({
    plannerVersion: "fixture/v1",
    model: "deterministic-ci-fixture",
    latencyMs: 0,
    recommendation: input.attentionKind === "purchasing.supply-risk"
      ? purchasing(input)
      : input.attentionKind === "quality.lot-hold"
        ? quality(input)
        : new NoAction({ _tag: "NoAction", rationale: "The deterministic fixture planner has no rule for this attention kind.", confidence: 1, evidenceRefs: evidenceIds(input) })
  }))
}))
