import { Context, Effect, Schema } from "effect"
import type { EvidenceSnapshot } from "../../audit/model/audit-event"
import { Recommendation } from "./recommendation"

export class PlannerInput extends Schema.Class<PlannerInput>("PlannerInput")({
  attentionKind: Schema.String,
  attention: Schema.Unknown,
  evidence: Schema.Array(Schema.Unknown)
}) {}

export class Planner extends Context.Service<Planner, {
  readonly version: string
  readonly plan: (input: PlannerInput) => Effect.Effect<typeof Recommendation.Type, unknown>
}>()("harmony/agent/Planner") {}
