import { Context, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { BusinessClock } from "../model/business-clock"

export class ScheduledWork extends Schema.Class<ScheduledWork>("ScheduledWork")({
  workId: Schema.String,
  runAt: Schema.String,
  kind: Schema.String,
  payload: Schema.Unknown,
  status: Schema.Literal("scheduled", "running", "complete"),
  dedupeKey: Schema.String,
  createdAt: Schema.String
}) {}

export class ScheduledWorkService extends Context.Service<ScheduledWorkService, {
  readonly schedule: (work: Omit<ScheduledWork, "createdAt" | "status">) => Effect.Effect<ScheduledWork>
  readonly cancel: (workId: string) => Effect.Effect<void>
  readonly due: Effect.Effect<ReadonlyArray<ScheduledWork>>
}>()("harmony/scheduling/ScheduledWorkService") {}

export const layer = Layer.effect(
  ScheduledWorkService,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const clock = yield* BusinessClock

    return ScheduledWorkService.of({
      schedule: Effect.fn("ScheduledWork.schedule")(function*(work) {
        const createdAt = yield* clock.now
        yield* sql`INSERT OR IGNORE INTO scheduled_work (work_id, run_at, kind, payload_json, status, dedupe_key, created_at)
          VALUES (${work.workId}, ${work.runAt}, ${work.kind}, ${JSON.stringify(work.payload)}, 'scheduled', ${work.dedupeKey}, ${createdAt})`
        return new ScheduledWork({ ...work, status: "scheduled", createdAt })
      }),
      cancel: (workId) => Effect.asVoid(sql`DELETE FROM scheduled_work WHERE work_id = ${workId} AND status = 'scheduled'`),
      due: Effect.gen(function*() {
        const now = yield* clock.now
        const rows = yield* sql<any>`SELECT * FROM scheduled_work WHERE status = 'scheduled' AND run_at <= ${now} ORDER BY run_at`
        return rows.map((row) => new ScheduledWork({ workId: row.work_id, runAt: row.run_at, kind: row.kind, payload: JSON.parse(row.payload_json), status: row.status, dedupeKey: row.dedupe_key, createdAt: row.created_at }))
      })
    })
  })
)
