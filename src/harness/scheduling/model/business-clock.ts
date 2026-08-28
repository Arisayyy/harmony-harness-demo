import { Context, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export class BusinessClock extends Context.Service<BusinessClock, {
  readonly now: Effect.Effect<string, SqlError>
  readonly advanceTo: (instant: string) => Effect.Effect<void, SqlError>
}>()("harmony/scheduling/BusinessClock") {}

type ClockRow = { readonly now: string }

export const layer = Layer.effect(
  BusinessClock,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return {
      now: Effect.map(sql<ClockRow>`SELECT now FROM business_clock WHERE id = 1`, (rows) => rows[0]?.now ?? "2026-09-02T09:00:00-06:00"),
      advanceTo: (instant) => Effect.asVoid(sql`UPDATE business_clock SET now = ${instant} WHERE id = 1`)
    }
  })
)
