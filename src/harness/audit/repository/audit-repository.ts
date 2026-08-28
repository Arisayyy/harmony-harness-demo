import { Context, Crypto, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { AuditEvent } from "../model/audit-event"

export class AuditRepository extends Context.Service<AuditRepository, {
  readonly append: (event: AuditEvent) => Effect.Effect<void>
  readonly listRun: (runId: string) => Effect.Effect<ReadonlyArray<AuditEvent>>
}>()("harmony/audit/AuditRepository") {}

export const layer = Layer.effect(
  AuditRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return AuditRepository.of({
      append: (event) => Effect.asVoid(sql`INSERT INTO audit_events (event_id, run_id, trace_id, event_type, actor, effective_user_id, occurred_at, evidence_json, data_json)
        VALUES (${event.eventId}, ${event.runId}, ${event.traceId}, ${event.eventType}, ${event.actor}, ${event.effectiveUserId ?? null}, ${event.occurredAt}, ${JSON.stringify(event.evidence)}, ${JSON.stringify(event.data)})`),
      listRun: Effect.fn("AuditRepository.listRun")(function*(runId) {
        const rows = yield* sql<any>`SELECT * FROM audit_events WHERE run_id = ${runId} ORDER BY sequence`
        return rows.map((row) => new AuditEvent({ eventId: row.event_id, runId: row.run_id, traceId: row.trace_id, eventType: row.event_type, actor: row.actor, effectiveUserId: row.effective_user_id ?? undefined, occurredAt: row.occurred_at, evidence: JSON.parse(row.evidence_json), data: JSON.parse(row.data_json) }))
      })
    })
  })
)

export const appendNow = (event: Omit<AuditEvent, "eventId" | "occurredAt">) => Effect.gen(function*() {
  const repository = yield* AuditRepository
  const clock = yield* BusinessClock
  const crypto = yield* Crypto.Crypto
  const [occurredAt, eventId] = yield* Effect.all([clock.now, crypto.randomUUIDv4])
  yield* repository.append(new AuditEvent({ ...event, eventId, occurredAt }))
})
