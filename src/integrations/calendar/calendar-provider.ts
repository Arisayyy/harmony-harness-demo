import { Context, Effect, Schema } from "effect"
import type { Principal } from "../../harness/authorization/permissions/principal"
import type { ProviderError } from "../erp/erp-provider"

export class CalendarEvent extends Schema.Class<CalendarEvent>("CalendarEvent")({
  eventId: Schema.String,
  ownerId: Schema.String,
  start: Schema.String,
  end: Schema.String,
  title: Schema.String,
  attendees: Schema.Array(Schema.String),
  outOfOffice: Schema.Boolean
}) {}

export class CalendarProvider extends Context.Service<CalendarProvider, {
  readonly listRange: (principal: Principal, ownerId: string, start: string, end: string) => Effect.Effect<ReadonlyArray<CalendarEvent>, ProviderError>
}>()("harmony/integrations/CalendarProvider") {}
