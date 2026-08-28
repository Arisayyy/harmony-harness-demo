import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { BusinessClock } from "../../harness/scheduling/model/business-clock"

export const deliverSupplierDelay = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const clock = yield* BusinessClock
  const receivedAt = yield* clock.now
  yield* sql`INSERT OR IGNORE INTO mail_messages VALUES (
    ${"M-001"}, ${"rita.alvarez@sierramotion.example"}, ${JSON.stringify(["elena.vargas@realtruck.example"])},
    ${receivedAt}, ${"Re: PO-77812 — shipment update"},
    ${"Revised ship date is Monday 9/7, which puts it on your Guadalajara dock Tuesday 9/8."}
  )`
})
