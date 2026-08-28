import { OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Clock, Effect, Layer } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { AppConfig } from "../../infra/config/app-config"
import { Planner, PlannerEvidenceError, PlannerResult } from "../../harness/agent/planning/planner"
import { Recommendation } from "../../harness/agent/planning/recommendation"

export const plannerVersion = "planner/v1"

const system = `You are the planning boundary of an enterprise manufacturing agent harness.
You propose intent only. You never execute tools or invent permissions.
Return NoAction when the evidence does not justify a write.
For purchasing supply risk, the only deterministic workflow you may enter is purchasing.reroute-po.
For quality holds, you may propose only quality.reallocate-lot plus production.notify, or purchasing.flag-shortage when no good lot covers demand.
Never choose an unapproved supplier. Never cite evidence that is not present in the provided evidence list.
Use sourceId values verbatim in evidenceRefs. Keep rationale concise and factual.`

export const layer = Layer.effect(
  Planner,
  Effect.gen(function*() {
    const config = yield* AppConfig
    const model = yield* OpenRouterLanguageModel.model(config.openRouterModel, {
      temperature: 0
    }).captureRequirements

    const plan = Effect.fn("Planner.plan")(function*(input) {
      const start = yield* Clock.monotonicTimeNanos
      const languageModel = yield* LanguageModel.LanguageModel
      const response = yield* languageModel.generateObject({
        objectName: "enterprise_agent_recommendation",
        schema: Recommendation,
        prompt: `${system}\n\nAttention item:\n${JSON.stringify(input.attention)}\n\nEvidence snapshots:\n${JSON.stringify(input.evidence)}`
      })
      const end = yield* Clock.monotonicTimeNanos
      const allowed = new Set(input.evidence.map((evidence) => evidence.sourceId))
      const unknownReferences = response.value.evidenceRefs.filter((sourceId) => !allowed.has(sourceId))
      if (unknownReferences.length > 0) return yield* new PlannerEvidenceError({ unknownReferences })

      return new PlannerResult({
        plannerVersion,
        model: config.openRouterModel,
        latencyMs: Number(end - start) / 1_000_000,
        inputTokens: response.usage.inputTokens.total,
        outputTokens: response.usage.outputTokens.total,
        recommendation: response.value
      })
    }, Effect.provide(model), Effect.withSpan("planner.generate", { attributes: { "planner.version": plannerVersion, "ai.model": config.openRouterModel } }))

    return Planner.of({ version: plannerVersion, model: config.openRouterModel, plan })
  })
)
