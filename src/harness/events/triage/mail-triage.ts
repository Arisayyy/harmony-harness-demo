import { Context, Effect, Schema } from "effect"
import type { InboundMail } from "../model/inbound-mail"

export class IgnoreMail extends Schema.Class<IgnoreMail>("IgnoreMail")({
  _tag: Schema.Literal("IgnoreMail"),
  rationale: Schema.String,
  confidence: Schema.Number
}) {}

export class RouteMail extends Schema.Class<RouteMail>("RouteMail")({
  _tag: Schema.Literal("RouteMail"),
  route: Schema.String,
  rationale: Schema.String,
  confidence: Schema.Number
}) {}

export const MailTriageDecision = Schema.Union([IgnoreMail, RouteMail])
export type MailTriageDecision = typeof MailTriageDecision.Type

export type MailRouteSummary = {
  readonly route: string
  readonly description: string
}

export class MailTriage extends Context.Service<MailTriage, {
  readonly version: string
  readonly model: string
  readonly triage: (mail: InboundMail, routes: ReadonlyArray<MailRouteSummary>) => Effect.Effect<MailTriageDecision, unknown>
}>()("harmony/events/MailTriage") {}
