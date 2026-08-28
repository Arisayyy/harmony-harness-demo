import { Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { hasScope } from "../../harness/authorization/permissions/principal"
import { ProviderDenied } from "../erp/erp-provider"
import { CalendarEvent, CalendarProvider } from "./calendar-provider"

export const layer = Layer.effect(
  CalendarProvider,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return CalendarProvider.of({
      listRange: Effect.fn("CalendarProvider.listRange")(function*(principal, ownerId, start, end) {
        if (!hasScope(principal, "calendar:read")) return yield* new ProviderDenied({ provider: "calendar", requiredScope: "calendar:read" })
        if (ownerId !== principal.userId && ownerId !== principal.backupApproverId && ownerId !== principal.managerId) {
          return yield* new ProviderDenied({ provider: "calendar", requiredScope: "calendar:read:self-or-approval-chain" })
        }
        const rows = yield* sql<any>`SELECT * FROM calendar_events WHERE owner_id = ${ownerId} AND start <= ${end} AND end >= ${start} ORDER BY start`
        return rows.map((row) => new CalendarEvent({ eventId: row.event_id, ownerId: row.owner_id, start: row.start, end: row.end, title: row.title, attendees: JSON.parse(row.attendees_json), outOfOffice: row.out_of_office === 1 }))
      })
    })
  })
)
