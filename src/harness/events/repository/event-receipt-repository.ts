import { Context, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export class EventReceiptRepository extends Context.Service<EventReceiptRepository, {
  readonly claim: (source: string, eventId: string, claimId: string, receivedAt: string) => Effect.Effect<boolean, SqlError>
}>()("harmony/events/EventReceiptRepository") {}

export const layer = Layer.effect(
  EventReceiptRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return EventReceiptRepository.of({
      claim: Effect.fn("EventReceiptRepository.claim")(function*(source, eventId, claimId, receivedAt) {
        yield* sql`INSERT OR IGNORE INTO event_receipts (source, event_id, claim_id, received_at) VALUES (${source}, ${eventId}, ${claimId}, ${receivedAt})`
        const rows = yield* sql<any>`SELECT claim_id FROM event_receipts WHERE source = ${source} AND event_id = ${eventId}`
        return rows[0]?.claim_id === claimId
      })
    })
  })
)
