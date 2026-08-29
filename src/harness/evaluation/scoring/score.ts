import type { Recommendation } from "../../agent/planning/recommendation"
import type { BenchmarkCase } from "../cases/benchmark-cases"

export type BenchmarkScore = {
  readonly recommendation: boolean
  readonly workflow: boolean
  readonly parameters: boolean
  readonly actions: boolean
  readonly evidence: boolean
  readonly forbiddenActions: boolean
  readonly passed: boolean
}

export const scoreRecommendation = (benchmark: BenchmarkCase, recommendation: Recommendation): BenchmarkScore => {
  const recommendationPass = recommendation._tag === benchmark.expected.recommendationTag
  const workflowPass = benchmark.expected.workflow === undefined || (recommendation._tag === "EnterWorkflow" && recommendation.workflow === benchmark.expected.workflow)
  const parametersPass = benchmark.expected.alternateSupplierId === undefined || (recommendation._tag === "EnterWorkflow" && recommendation.parameters.alternateSupplierId === benchmark.expected.alternateSupplierId)
  const actionTags = recommendation._tag === "ProposedActions" ? recommendation.actions.map((action) => action._tag) : []
  const actionsPass = (benchmark.expected.requiredActionTags ?? []).every((tag) => actionTags.includes(tag as any))
  const evidencePass = (benchmark.expected.requiredEvidenceRefs ?? []).every((sourceId) => recommendation.evidenceRefs.includes(sourceId))
  const serialized = JSON.stringify(recommendation)
  const forbiddenActionsPass = (benchmark.expected.forbiddenStrings ?? []).every((value) => !serialized.includes(value))
  return {
    recommendation: recommendationPass,
    workflow: workflowPass,
    parameters: parametersPass,
    actions: actionsPass,
    evidence: evidencePass,
    forbiddenActions: forbiddenActionsPass,
    passed: recommendationPass && workflowPass && parametersPass && actionsPass && evidencePass && forbiddenActionsPass
  }
}
