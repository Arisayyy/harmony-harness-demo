import { Context, Data, Effect, Layer, Schema } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { AuditLog } from "../../audit/service/audit-log"
import type { Principal } from "../../authorization/permissions/principal"
import { hasScope } from "../../authorization/permissions/principal"
import { BusinessClock } from "../../scheduling/model/business-clock"
import { ToolCatalog } from "../catalog/tool-catalog"

export class ToolDenied extends Data.TaggedError("ToolDenied")<{ readonly tool: string; readonly missingScopes: ReadonlyArray<string> }> {}

export type ToolAuditContext = {
  readonly runId: string
  readonly traceId: string
}

export class ToolRuntime extends Context.Service<ToolRuntime, {
  readonly execute: (options: {
    readonly tool: string
    readonly principal: Principal
    readonly input: unknown
    readonly idempotencyKey: string
    readonly audit?: ToolAuditContext
  }) => Effect.Effect<unknown, unknown>
}>()("harmony/tools/ToolRuntime") {}

export const layer = Layer.effect(
  ToolRuntime,
  Effect.gen(function*() {
    const catalog = yield* ToolCatalog
    const sql = yield* SqlClient.SqlClient
    const clock = yield* BusinessClock
    const auditLog = yield* AuditLog

    const append = (context: ToolAuditContext | undefined, eventType: string, principal: Principal, data: unknown) => context === undefined
      ? Effect.void
      : auditLog.append({
          runId: context.runId,
          traceId: context.traceId,
          eventType,
          actor: `tool:${(data as { tool?: string }).tool ?? "unknown"}`,
          effectiveUserId: principal.userId,
          evidence: [],
          data
        })

    return ToolRuntime.of({
      execute: Effect.fn("ToolRuntime.execute")(function*({ tool: name, principal, input, idempotencyKey, audit }) {
        const tool = yield* catalog.get(name)
        const missingScopes = tool.requiredScopes.filter((scope) => !hasScope(principal, scope))
        if (missingScopes.length > 0) {
          yield* append(audit, "tool.denied", principal, { tool: name, idempotencyKey, input, missingScopes })
          return yield* new ToolDenied({ tool: name, missingScopes })
        }

        const decodeInput = Schema.decodeUnknownEffect(tool.input)
        const decodeOutput = Schema.decodeUnknownEffect(tool.output)
        const encodeOutput = Schema.encodeEffect(tool.output)
        const existing = yield* sql<any>`SELECT result_json FROM tool_idempotency WHERE idempotency_key = ${idempotencyKey}`
        if (existing[0] !== undefined) {
          const replayed = yield* decodeOutput(JSON.parse(existing[0].result_json))
          yield* append(audit, "tool.replayed", principal, { tool: name, idempotencyKey, input, result: replayed })
          return replayed
        }

        const decoded = yield* decodeInput(input)
        const result = yield* tool.execute(principal, decoded).pipe(
          Effect.tapError((error) => append(audit, "tool.failed", principal, { tool: name, idempotencyKey, input: decoded, error: String(error) }))
        )
        const encoded = yield* encodeOutput(result)
        const createdAt = yield* clock.now
        yield* sql`INSERT INTO tool_idempotency (idempotency_key, tool_name, result_json, created_at) VALUES (${idempotencyKey}, ${name}, ${JSON.stringify(encoded)}, ${createdAt})`
        yield* append(audit, "tool.executed", principal, { tool: name, idempotencyKey, input: decoded, result: encoded })
        return result
      })
    })
  })
)
