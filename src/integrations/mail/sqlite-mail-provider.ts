import { Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { hasScope } from "../../harness/authorization/permissions/principal"
import { ProviderDenied } from "../erp/erp-provider"
import { MailMessage, MailProvider } from "./mail-provider"

export const layer = Layer.effect(
  MailProvider,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    return MailProvider.of({
      search: Effect.fn("MailProvider.search")(function*(principal, query) {
        if (!hasScope(principal, "mail:read")) return yield* new ProviderDenied({ provider: "mail", requiredScope: "mail:read" })
        const pattern = `%${query}%`
        const rows = yield* sql<any>`SELECT * FROM mail_messages WHERE subject LIKE ${pattern} OR body LIKE ${pattern} ORDER BY date DESC`
        return rows.map((row) => new MailMessage({ messageId: row.message_id, from: row.sender, to: JSON.parse(row.recipients_json), date: row.date, subject: row.subject, body: row.body }))
      })
    })
  })
)
