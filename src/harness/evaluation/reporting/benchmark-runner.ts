import { Console, Context, Crypto, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Planner, PlannerResult } from "../../agent/planning/planner"
import { Recommendation } from "../../agent/planning/recommendation"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { cases } from "../cases/benchmark-cases"
import { scoreRecommendation } from "../scoring/score"

const decodeRecommendation = Schema.decodeUnknownEffect(Recommendation)
const glmFlashInputPerMillion = 0.075
const glmFlashOutputPerMillion = 0.25
const estimateCost = (result: PlannerResult) => result.inputTokens === undefined || result.outputTokens === undefined ? undefined : (result.inputTokens / 1_000_000) * glmFlashInputPerMillion + (result.outputTokens / 1_000_000) * glmFlashOutputPerMillion

export class BenchmarkRunner extends Context.Service<BenchmarkRunner, { readonly live: Effect.Effect<void, unknown>; readonly replay: Effect.Effect<void, unknown> }>()("harmony/evaluation/BenchmarkRunner") {}

export const layer = Layer.effect(BenchmarkRunner, Effect.gen(function*() {
  const planner = yield* Planner
  const sql = yield* SqlClient.SqlClient
  const clock = yield* BusinessClock
  const crypto = yield* Crypto.Crypto
  return BenchmarkRunner.of({
    live: Effect.gen(function*() {
      yield* sql`DELETE FROM benchmark_runs`
      let passed = 0; let total = 0
      for (const benchmark of cases) {
        const tags: Array<string> = []
        for (let repetition = 1; repetition <= 3; repetition++) {
          const result = yield* planner.plan(benchmark.input)
          const score = scoreRecommendation(benchmark, result.recommendation)
          const createdAt = yield* clock.now
          const benchmarkRunId = yield* crypto.randomUUIDv4
          const estimatedCost = estimateCost(result)
          tags.push(result.recommendation._tag === "EnterWorkflow" ? `${result.recommendation._tag}:${result.recommendation.workflow}` : result.recommendation._tag)
          total++; if (score.passed) passed++
          yield* sql`INSERT INTO benchmark_runs (benchmark_run_id, case_id, fixture_version, model, planner_version, repetition, result_json, latency_ms, input_tokens, output_tokens, estimated_cost, created_at) VALUES (${benchmarkRunId}, ${benchmark.id}, ${benchmark.fixtureVersion}, ${result.model}, ${result.plannerVersion}, ${repetition}, ${JSON.stringify({ plannerResult: result, score })}, ${result.latencyMs}, ${result.inputTokens ?? null}, ${result.outputTokens ?? null}, ${estimatedCost ?? null}, ${createdAt})`
          yield* Console.log(`${benchmark.id.padEnd(34)} run=${repetition} ${score.passed ? "pass" : "fail"} ${result.latencyMs.toFixed(0)}ms`)
        }
        yield* Console.log(`${"".padEnd(34)} agreement=${new Set(tags).size === 1 ? "3/3" : `${3 - (new Set(tags).size - 1)}/3`}`)
      }
      yield* Console.log(`benchmark live       ${passed}/${total} runs passed deterministic scoring`)
    }),
    replay: Effect.gen(function*() {
      const rows = yield* sql<any>`SELECT * FROM benchmark_runs ORDER BY case_id, repetition`
      let passed = 0
      for (const row of rows) {
        const benchmark = cases.find((candidate) => candidate.id === row.case_id)
        if (benchmark === undefined) continue
        const stored = JSON.parse(row.result_json)
        const recommendation = yield* decodeRecommendation(stored.plannerResult.recommendation)
        const score = scoreRecommendation(benchmark, recommendation)
        if (score.passed) passed++
        yield* Console.log(`${row.case_id.padEnd(34)} run=${row.repetition} ${score.passed ? "pass" : "fail"}`)
      }
      yield* Console.log(`benchmark replay     ${passed}/${rows.length} stored runs passed current scoring`)
    })
  })
}))
