import { Schema } from "effect"

export class AttentionItem extends Schema.Class<AttentionItem>("AttentionItem")({
  attentionId: Schema.String,
  detector: Schema.String,
  dedupeKey: Schema.String,
  principalId: Schema.String,
  kind: Schema.String,
  payload: Schema.Unknown,
  status: Schema.Literal("open", "planned", "closed"),
  createdAt: Schema.String
}) {}
