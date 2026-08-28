import { Context, Data, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { Principal } from "../../authorization/permissions/principal"
import { hasScope } from "../../authorization/permissions/principal"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { ToolCatalog } from "../catalog/tool-catalog"

export class ToolDenied extends Data.TaggedError("ToolDenied")<{
  readonly tool: string
  readonly missingScopes: ReadonlyArray<string>
}> {}

export class ToolRuntime extends Context.Service<ToolRuntime, {
  readonly execute: (options: {
    readonly tool: string
    readonly principal: Principal
    readonly input: unknown
    readonly idempotencyKey: string
  }) => Effect.Effect<unknown, unknown>
}>()("harmony/tools/ToolRuntime") {}

export const layer = Layer.effect(
  ToolRuntime,
  Effect.gen(function*() {
    const catalog = yield* ToolCatalog
    const sql = yield* SqlClient.SqlClient
    const clock = yield* BusinessClock

    return ToolRuntime.of({
      execute: Effect.fn("ToolRuntime.execute")(function*({ tool: name, principal, input, idempotencyKey }) {
        const tool = yield* catalog.get(name)
        const missingScopes = tool.requiredScopes.filter((scope) => !hasScope(principal, scope))
        if (missingScopes.length > 0) return yield* new ToolDenied({ tool: name, missingScopes })

        const existing = yield* sql<any>`SELECT result_json FROM tool_idempotency WHERE idempotency_key = ${idempotencyKey}`
        if (existing[0] !== undefined) return yield* Schema.decodeUnknown(tool.output)(JSON.parse(existing[0].result_json))

        const decoded = yield* Schema.decodeUnknown(tool.input)(input)
        const result = yield* tool.execute(principal, decoded)
        const encoded = yield* Schema.encode(tool.output)(result)
        const createdAt = yield* clock.now
        yield* sql`INSERT INTO tool_idempotency (idempotency_key, tool_name, result_json, created_at) VALUES (${idempotencyKey}, ${name}, ${JSON.stringify(encoded)}, ${createdAt})`
        return result
      })
    })
  })
)
