import { EvidenceSnapshot } from "../../audit/model/audit-event"
import { PlannerInput } from "../../agent/planning/planner"

export type BenchmarkExpectation = {
  readonly recommendationTag: "NoAction" | "EnterWorkflow" | "ProposedActions"
  readonly workflow?: "purchasing.reroute-po"
  readonly requiredActionTags?: ReadonlyArray<string>
  readonly requiredEvidenceRefs?: ReadonlyArray<string>
  readonly forbiddenStrings?: ReadonlyArray<string>
}

export type BenchmarkCase = {
  readonly id: string
  readonly fixtureVersion: string
  readonly input: PlannerInput
  readonly expected: BenchmarkExpectation
}

const observedAt = "2026-09-02T09:05:00-06:00"
const e = (provider: EvidenceSnapshot["provider"], sourceId: string, payload: unknown) => new EvidenceSnapshot({ provider, sourceId, observedAt, payload })

const purchasingEvidence = [
  e("erp", "RT-4471", { partId: "RT-4471", description: "12V retractable-cover drive motor, RH", onHand: 150, dailyUsage: 30, safetyStock: 20 }),
  e("erp", "PO-77812", { poId: "PO-77812", partId: "RT-4471", supplierId: "S-Y", qty: 400, totalValue: 16800, status: "open" }),
  e("erp", "4812", { productionOrderId: "4812", scheduledStart: "2026-09-07", components: [{ partId: "RT-4471", qty: 120 }] }),
  e("erp", "S-Z", { supplierId: "S-Z", name: "Bajío Electromech", approved: true, approvedParts: ["RT-4471"], leadTimeDays: 2, pricing: [{ partId: "RT-4471", unitPrice: 46.5 }] }),
  e("erp", "S-Q", { supplierId: "S-Q", name: "Volta Direct Trading", approved: false, approvedParts: ["RT-2210"], leadTimeDays: 1, pricing: [{ partId: "RT-4471", unitPrice: 34.8 }] }),
  e("mail", "M-001", { subject: "Re: PO-77812 — shipment update", body: "Revised ship date is Monday 9/7, which puts it on your Guadalajara dock Tuesday 9/8." })
]

export const cases: ReadonlyArray<BenchmarkCase> = [
  {
    id: "purchasing-delay-reroute",
    fixtureVersion: "1",
    input: new PlannerInput({ attentionKind: "purchasing.supply-risk", attention: { partId: "RT-4471", poId: "PO-77812", productionOrderId: "4812" }, evidence: purchasingEvidence }),
    expected: { recommendationTag: "EnterWorkflow", workflow: "purchasing.reroute-po", requiredEvidenceRefs: ["RT-4471", "PO-77812", "4812", "M-001", "S-Z"], forbiddenStrings: ["S-Q"] }
  },
  {
    id: "irrelevant-email-no-action",
    fixtureVersion: "1",
    input: new PlannerInput({ attentionKind: "purchasing.supply-risk", attention: { source: "mail" }, evidence: [
      e("erp", "RT-2210", { partId: "RT-2210", onHand: 2400, dailyUsage: 75, safetyStock: 300 }),
      e("mail", "M-NOISE-1", { subject: "Parking access — visitor lot", body: "The west visitor lot will be closed after 18:00 Thursday." })
    ] }),
    expected: { recommendationTag: "NoAction", requiredEvidenceRefs: ["M-NOISE-1"] }
  },
  {
    id: "unapproved-supplier-is-forbidden",
    fixtureVersion: "1",
    input: new PlannerInput({ attentionKind: "purchasing.supply-risk", attention: { partId: "RT-4471", poId: "PO-77812", productionOrderId: "4812", cheapestSupplierId: "S-Q" }, evidence: purchasingEvidence }),
    expected: { recommendationTag: "EnterWorkflow", workflow: "purchasing.reroute-po", requiredEvidenceRefs: ["S-Z"], forbiddenStrings: ["S-Q"] }
  },
  {
    id: "quality-hold-reallocate",
    fixtureVersion: "1",
    input: new PlannerInput({ attentionKind: "quality.lot-hold", attention: { lotId: "L-2093", partId: "RT-1180", productionOrderId: "4820", requiredQuantity: 80 }, evidence: [
      e("erp", "4820", { productionOrderId: "4820", scheduledStart: "2026-09-11", components: [{ partId: "RT-1180", qty: 80, lotId: "L-2093" }] }),
      e("erp", "L-2093", { lotId: "L-2093", partId: "RT-1180", qty: 100, status: "hold" }),
      e("erp", "L-2094", { lotId: "L-2094", partId: "RT-1180", qty: 120, status: "good" })
    ] }),
    expected: { recommendationTag: "ProposedActions", requiredActionTags: ["quality.reallocate-lot", "production.notify"], requiredEvidenceRefs: ["4820", "L-2093", "L-2094"] }
  },
  {
    id: "quality-hold-shortage",
    fixtureVersion: "1",
    input: new PlannerInput({ attentionKind: "quality.lot-hold", attention: { lotId: "L-2093", partId: "RT-1180", productionOrderId: "4820", requiredQuantity: 80 }, evidence: [
      e("erp", "4820", { productionOrderId: "4820", scheduledStart: "2026-09-11", components: [{ partId: "RT-1180", qty: 80, lotId: "L-2093" }] }),
      e("erp", "L-2093", { lotId: "L-2093", partId: "RT-1180", qty: 100, status: "hold" }),
      e("erp", "L-2094", { lotId: "L-2094", partId: "RT-1180", qty: 20, status: "good" })
    ] }),
    expected: { recommendationTag: "ProposedActions", requiredActionTags: ["purchasing.flag-shortage"], requiredEvidenceRefs: ["4820", "L-2093", "L-2094"] }
  }
]
