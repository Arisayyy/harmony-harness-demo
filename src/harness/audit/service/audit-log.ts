import { Context, Crypto, Effect, Layer } from "effect"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { AuditEvent } from "../model/audit-event"
import { AuditRepository } from "../repository/audit-repository"

export class AuditLog extends Context.Service<AuditLog, {
  readonly append: (event: Omit<AuditEvent, "eventId" | "occurredAt">) => Effect.Effect<void, unknown>
}>()("harmony/audit/AuditLog") {}

export const layer = Layer.effect(
  AuditLog,
  Effect.gen(function*() {
    const repository = yield* AuditRepository
    const clock = yield* BusinessClock
    const crypto = yield* Crypto.Crypto

    return AuditLog.of({
      append: (event) => Effect.gen(function*() {
        const [occurredAt, eventId] = yield* Effect.all([clock.now, crypto.randomUUIDv4])
        yield* repository.append(new AuditEvent({ ...event, eventId, occurredAt }))
      })
    })
  })
)
