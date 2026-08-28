import { Effect, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { BusinessClock } from "../../../harness/scheduling/model/business-clock"
import { defineTool } from "../../../harness/tools/catalog/tool"

export class NotifyProductionInput extends Schema.Class<NotifyProductionInput>("NotifyProductionInput")({ messageId: Schema.String, productionOrderId: Schema.String, message: Schema.String }) {}
export class NotifyProductionOutput extends Schema.Class<NotifyProductionOutput>("NotifyProductionOutput")({ messageId: Schema.String }) {}
export class FlagShortageInput extends Schema.Class<FlagShortageInput>("FlagShortageInput")({ messageId: Schema.String, productionOrderId: Schema.String, partId: Schema.String, quantity: Schema.Number, reason: Schema.String }) {}
export class FlagShortageOutput extends Schema.Class<FlagShortageOutput>("FlagShortageOutput")({ messageId: Schema.String }) {}

export const makeProductionTools = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const clock = yield* BusinessClock

  return [
    defineTool({
      name: "production.notify",
      input: NotifyProductionInput,
      output: NotifyProductionOutput,
      requiredScopes: ["production:notify", "mail:send"],
      execute: Effect.fn("tool.production.notify")(function*(_principal, input: NotifyProductionInput) {
        const sentAt = yield* clock.now
        yield* sql`INSERT INTO mail_messages VALUES (${input.messageId}, ${"agent@realtruck.example"}, ${JSON.stringify(["production.gdl@realtruck.example"])}, ${sentAt}, ${`Production order ${input.productionOrderId}`}, ${input.message})`
        return new NotifyProductionOutput({ messageId: input.messageId })
      })
    }),
    defineTool({
      name: "purchasing.flag-shortage",
      input: FlagShortageInput,
      output: FlagShortageOutput,
      requiredScopes: ["purchasing:flag-shortage", "mail:send"],
      execute: Effect.fn("tool.purchasing.flag-shortage")(function*(_principal, input: FlagShortageInput) {
        const sentAt = yield* clock.now
        yield* sql`INSERT INTO mail_messages VALUES (${input.messageId}, ${"agent@realtruck.example"}, ${JSON.stringify(["purchasing.gdl@realtruck.example"])}, ${sentAt}, ${`Shortage risk — ${input.partId} / ${input.productionOrderId}`}, ${input.reason})`
        return new FlagShortageOutput({ messageId: input.messageId })
      })
    })
  ] as const
})
