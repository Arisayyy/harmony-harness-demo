import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { BusinessClock } from "../../harness/scheduling/model/business-clock"

export const placeQualityHold = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const clock = yield* BusinessClock
  const now = yield* clock.now
  yield* sql`UPDATE quality_lots SET status = 'hold', hold_reason = ${"Surface finish 3.4 Ra vs spec 3.2 Ra"}, hold_placed_by = ${"u-202"}, hold_placed_on = ${now.slice(0, 10)} WHERE lot_id = ${"L-2093"}`
})
