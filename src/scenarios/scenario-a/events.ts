import { Effect } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { InboundMail } from "../../harness/events/model/inbound-mail"
import { BusinessClock } from "../../harness/scheduling/model/business-clock"

const deliver = (message: Omit<InboundMail, "date">) => Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const clock = yield* BusinessClock
  const date = yield* clock.now
  const mail = new InboundMail({ ...message, date })
  yield* sql`INSERT OR IGNORE INTO mail_messages VALUES (${mail.messageId}, ${mail.from}, ${JSON.stringify(mail.to)}, ${mail.date}, ${mail.subject}, ${mail.body})`
  return mail
})

export const deliverIrrelevantMail = deliver({
  messageId: "M-LIVE-NOISE",
  from: "facilities.gdl@realtruck.example",
  to: ["elena.vargas@realtruck.example"],
  subject: "Visitor parking update",
  body: "The west visitor lot will close at 18:00 Thursday for resurfacing."
})

export const deliverSupplierDelay = deliver({
  messageId: "M-001",
  from: "rita.alvarez@sierramotion.example",
  to: ["elena.vargas@realtruck.example"],
  subject: "Re: PO-77812 — shipment update",
  body: "Revised ship date is Monday 9/7, which puts it on your Guadalajara dock Tuesday 9/8."
})
