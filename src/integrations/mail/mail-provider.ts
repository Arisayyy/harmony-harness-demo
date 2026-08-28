import { Context, Effect, Schema } from "effect"
import type { Principal } from "../../harness/authorization/permissions/principal"
import type { ProviderDenied } from "../erp/erp-provider"

export class MailMessage extends Schema.Class<MailMessage>("MailMessage")({
  messageId: Schema.String,
  from: Schema.String,
  to: Schema.Array(Schema.String),
  date: Schema.String,
  subject: Schema.String,
  body: Schema.String
}) {}

export class MailProvider extends Context.Service<MailProvider, {
  readonly search: (principal: Principal, query: string) => Effect.Effect<ReadonlyArray<MailMessage>, ProviderDenied>
}>()("harmony/integrations/MailProvider") {}
