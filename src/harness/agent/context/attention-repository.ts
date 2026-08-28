import { Context, Effect, Layer, Option } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { AttentionItem } from "./attention-item"

export class AttentionRepository extends Context.Service<AttentionRepository, {
  readonly putIfAbsent: (item: AttentionItem) => Effect.Effect<boolean>
  readonly get: (attentionId: string) => Effect.Effect<Option.Option<AttentionItem>>
}>()("harmony/agent/AttentionRepository") {}

export const layer = Layer.effect(
  AttentionRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return AttentionRepository.of({
      putIfAbsent: Effect.fn("AttentionRepository.putIfAbsent")(function*(item) {
        const before = yield* sql<any>`SELECT attention_id FROM attention_items WHERE dedupe_key = ${item.dedupeKey}`
        if (before.length > 0) return false
        yield* sql`INSERT INTO attention_items (
          attention_id, detector, dedupe_key, principal_id, kind, payload_json, status, created_at
        ) VALUES (
          ${item.attentionId}, ${item.detector}, ${item.dedupeKey}, ${item.principalId}, ${item.kind}, ${JSON.stringify(item.payload)}, ${item.status}, ${item.createdAt}
        )`
        return true
      }),
      get: Effect.fn("AttentionRepository.get")(function*(attentionId) {
        const rows = yield* sql<any>`SELECT * FROM attention_items WHERE attention_id = ${attentionId}`
        const row = rows[0]
        return row === undefined
          ? Option.none()
          : Option.some(new AttentionItem({
            attentionId: row.attention_id,
            detector: row.detector,
            dedupeKey: row.dedupe_key,
            principalId: row.principal_id,
            kind: row.kind,
            payload: JSON.parse(row.payload_json),
            status: row.status,
            createdAt: row.created_at
          }))
      })
    })
  })
)
