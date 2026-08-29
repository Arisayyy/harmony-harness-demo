import { Schema } from "effect"

export class InboundMail extends Schema.Class<InboundMail>("InboundMail")({
  messageId: Schema.String,
  from: Schema.String,
  to: Schema.Array(Schema.String),
  date: Schema.String,
  subject: Schema.String,
  body: Schema.String
}) {}
