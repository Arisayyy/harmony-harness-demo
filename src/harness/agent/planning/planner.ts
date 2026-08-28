import { Context, Data, Effect, Schema } from "effect"
import { EvidenceSnapshot } from "../../audit/model/audit-event"
import { Recommendation } from "./recommendation"

export class PlannerInput extends Schema.Class<PlannerInput>("PlannerInput")({
  attentionKind: Schema.String,
  attention: Schema.Unknown,
  evidence: Schema.Array(EvidenceSnapshot)
}) {}

export class PlannerResult extends Schema.Class<PlannerResult>("PlannerResult")({
  plannerVersion: Schema.String,
  model: Schema.String,
  latencyMs: Schema.Number,
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  recommendation: Recommendation
}) {}

export class PlannerEvidenceError extends Data.TaggedError("PlannerEvidenceError")<{
  readonly unknownReferences: ReadonlyArray<string>
}> {}

export class Planner extends Context.Service<Planner, {
  readonly version: string
  readonly model: string
  readonly plan: (input: PlannerInput) => Effect.Effect<PlannerResult, unknown>
}>()("harmony/agent/Planner") {}
