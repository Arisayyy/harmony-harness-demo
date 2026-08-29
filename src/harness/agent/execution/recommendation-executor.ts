import { Context, Effect } from "effect"
import type { Principal } from "../../authorization/permissions/principal"
import type { Recommendation } from "../planning/recommendation"

export type RecommendationExecution = {
  readonly runId: string
  readonly traceId: string
  readonly principal: Principal
  readonly recommendation: Recommendation
}

export type RecommendationExecutionResult = {
  readonly actor: string
  readonly outcome: unknown
}

export class RecommendationExecutor extends Context.Service<RecommendationExecutor, {
  readonly execute: (input: RecommendationExecution) => Effect.Effect<RecommendationExecutionResult, unknown>
}>()("harmony/agent/RecommendationExecutor") {}
