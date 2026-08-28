import { Context, Data, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { RunRecord } from "./run-record"

export class RunNotFound extends Data.TaggedError("RunNotFound")<{ readonly runId: string }> {}

const fromRow = (row: any) => new RunRecord({ runId: row.run_id, attentionId: row.attention_id, traceId: row.trace_id, principalId: row.principal_id, plannerResultJson: row.planner_result_json, recommendationJson: row.recommendation_json, evidenceJson: row.evidence_json, gateJson: row.gate_json ?? undefined, approvalId: row.approval_id ?? undefined, status: row.status, outcomeJson: row.outcome_json ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at })

export class RunRepository extends Context.Service<RunRepository, {
  readonly create: (record: RunRecord) => Effect.Effect<void, SqlError>
  readonly get: (runId: string) => Effect.Effect<RunRecord, RunNotFound | SqlError>
  readonly setStatus: (runId: string, status: RunRecord["status"], updatedAt: string, outcome?: unknown) => Effect.Effect<void, SqlError>
}>()("harmony/memory/RunRepository") {}

export const layer = Layer.effect(
  RunRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return RunRepository.of({
      create: (record) => Effect.asVoid(sql`INSERT INTO agent_runs (run_id, attention_id, trace_id, principal_id, planner_result_json, recommendation_json, evidence_json, gate_json, approval_id, status, outcome_json, created_at, updated_at) VALUES (${record.runId}, ${record.attentionId}, ${record.traceId}, ${record.principalId}, ${record.plannerResultJson}, ${record.recommendationJson}, ${record.evidenceJson}, ${record.gateJson ?? null}, ${record.approvalId ?? null}, ${record.status}, ${record.outcomeJson ?? null}, ${record.createdAt}, ${record.updatedAt})`),
      get: Effect.fn("RunRepository.get")(function*(runId) {
        const rows = yield* sql<any>`SELECT * FROM agent_runs WHERE run_id = ${runId}`
        if (rows[0] === undefined) return yield* new RunNotFound({ runId })
        return fromRow(rows[0])
      }),
      setStatus: (runId, status, updatedAt, outcome) => Effect.asVoid(sql`UPDATE agent_runs SET status = ${status}, updated_at = ${updatedAt}, outcome_json = ${outcome === undefined ? null : JSON.stringify(outcome)} WHERE run_id = ${runId}`)
    })
  })
)
