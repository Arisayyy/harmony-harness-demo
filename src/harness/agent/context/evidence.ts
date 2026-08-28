import { EvidenceSnapshot } from "../../audit/model/audit-event"

export const evidenceSnapshot = (provider: EvidenceSnapshot["provider"], sourceId: string, observedAt: string, payload: unknown) => new EvidenceSnapshot({
  provider,
  sourceId,
  observedAt,
  payload
})
