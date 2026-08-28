import { Context, Data, Effect, Layer } from "effect"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ApprovalLimits, Principal } from "./principal"

export class PrincipalNotFound extends Data.TaggedError("PrincipalNotFound")<{
  readonly userId: string
}> {}

type PrincipalRow = {
  readonly user_id: string
  readonly name: string
  readonly role: string
  readonly manager_id: string | null
  readonly backup_approver_id: string | null
  readonly scopes_json: string
  readonly po_create_max_value: number
}

export class PrincipalDirectory extends Context.Service<PrincipalDirectory, {
  readonly get: (userId: string) => Effect.Effect<Principal, PrincipalNotFound>
}>()("harmony/authorization/PrincipalDirectory") {}

export const layer = Layer.effect(
  PrincipalDirectory,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    const get = Effect.fn("PrincipalDirectory.get")(function*(userId: string) {
      const rows = yield* sql<PrincipalRow>`SELECT * FROM principals WHERE user_id = ${userId}`
      const row = rows[0]
      if (row === undefined) return yield* new PrincipalNotFound({ userId })

      return new Principal({
        userId: row.user_id,
        name: row.name,
        role: row.role,
        managerId: row.manager_id ?? undefined,
        backupApproverId: row.backup_approver_id ?? undefined,
        scopes: JSON.parse(row.scopes_json),
        approvalLimits: new ApprovalLimits({ poCreateMaxValue: row.po_create_max_value })
      })
    })

    return { get }
  })
)
