import { Context, Crypto, Data, Effect, Layer } from "effect"
import type { PlatformError } from "effect/PlatformError"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { ApprovalRecord } from "../model/approval"

export class ApprovalNotFound extends Data.TaggedError("ApprovalNotFound")<{ readonly approvalId: string }> {}

export class ApprovalRepository extends Context.Service<ApprovalRepository, {
  readonly create: (approval: ApprovalRecord) => Effect.Effect<void, SqlError>
  readonly get: (approvalId: string) => Effect.Effect<ApprovalRecord, ApprovalNotFound | SqlError>
  readonly resolve: (approvalId: string, decision: "approved" | "rejected", reviewerId: string, reason: string | undefined, resolvedAt: string) => Effect.Effect<void, SqlError>
  readonly route: (approvalId: string, fromApproverId: string, toApproverId: string, reason: string, routedAt: string) => Effect.Effect<void, SqlError | PlatformError>
}>()("harmony/approvals/ApprovalRepository") {}

const fromRow = (row: any) => new ApprovalRecord({
  approvalId: row.approval_id, runId: row.run_id, effectiveUserId: row.effective_user_id,
  requestedApproverId: row.requested_approver_id, assignedApproverId: row.assigned_approver_id,
  planHash: row.plan_hash, planJson: row.plan_json, policyReason: row.policy_reason, status: row.status,
  decision: row.decision ?? undefined, reviewerId: row.reviewer_id ?? undefined, reviewerReason: row.reviewer_reason ?? undefined,
  createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined
})

export const layer = Layer.effect(
  ApprovalRepository,
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const crypto = yield* Crypto.Crypto
    return ApprovalRepository.of({
      create: (approval) => Effect.asVoid(sql`INSERT OR IGNORE INTO approvals (approval_id, run_id, effective_user_id, requested_approver_id, assigned_approver_id, plan_hash, plan_json, policy_reason, status, decision, reviewer_id, reviewer_reason, created_at, resolved_at) VALUES (${approval.approvalId}, ${approval.runId}, ${approval.effectiveUserId}, ${approval.requestedApproverId}, ${approval.assignedApproverId}, ${approval.planHash}, ${approval.planJson}, ${approval.policyReason}, ${approval.status}, ${approval.decision ?? null}, ${approval.reviewerId ?? null}, ${approval.reviewerReason ?? null}, ${approval.createdAt}, ${approval.resolvedAt ?? null})`),
      get: Effect.fn("ApprovalRepository.get")(function*(approvalId) {
        const rows = yield* sql<any>`SELECT * FROM approvals WHERE approval_id = ${approvalId}`
        if (rows[0] === undefined) return yield* new ApprovalNotFound({ approvalId })
        return fromRow(rows[0])
      }),
      resolve: (approvalId, decision, reviewerId, reason, resolvedAt) => Effect.asVoid(sql`UPDATE approvals SET status = ${decision}, decision = ${decision}, reviewer_id = ${reviewerId}, reviewer_reason = ${reason ?? null}, resolved_at = ${resolvedAt} WHERE approval_id = ${approvalId} AND status = 'pending'`),
      route: (approvalId, fromApproverId, toApproverId, reason, routedAt) => sql.withTransaction(Effect.gen(function*() {
        const routeId = yield* crypto.randomUUIDv4
        yield* sql`UPDATE approvals SET assigned_approver_id = ${toApproverId} WHERE approval_id = ${approvalId} AND status = 'pending'`
        yield* sql`INSERT INTO approval_routes (route_id, approval_id, from_approver_id, to_approver_id, reason, routed_at) VALUES (${routeId}, ${approvalId}, ${fromApproverId}, ${toApproverId}, ${reason}, ${routedAt})`
      }))
    })
  })
)
