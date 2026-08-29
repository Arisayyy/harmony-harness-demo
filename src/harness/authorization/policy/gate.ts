import { Context, Crypto, Effect, Encoding, Layer } from "effect"
import type { Recommendation } from "../../agent/planning/recommendation"
import type { Principal } from "../permissions/principal"
import { PolicyDenied, PolicyEngine } from "./policy-engine"

export { PolicyDenied as GateDenied }
export type GateApproval = { readonly planHash: string; readonly assignedApproverId: string; readonly policyReason: string }

export class Gate extends Context.Service<Gate, {
  readonly evaluate: (principal: Principal, recommendation: Recommendation) => Effect.Effect<GateApproval | null, PolicyDenied>
}>()("harmony/authorization/Gate") {}

export const layer = Layer.effect(
  Gate,
  Effect.gen(function*() {
    const policies = yield* PolicyEngine
    const crypto = yield* Crypto.Crypto

    const hashPlan = (plan: Recommendation) => Effect.gen(function*() {
      const bytes = new TextEncoder().encode(JSON.stringify(plan))
      const digest = yield* crypto.digest("SHA-256", bytes).pipe(
        Effect.mapError(() => new PolicyDenied({ reasons: ["Unable to compute the immutable approval-plan hash."] }))
      )
      return Encoding.encodeHex(digest)
    })

    return Gate.of({
      evaluate: Effect.fn("Gate.evaluate")(function*(principal, recommendation) {
        if (recommendation._tag === "NoAction") return null
        const policy = yield* policies.evaluate(principal, recommendation)
        return { planHash: yield* hashPlan(recommendation), ...policy }
      })
    })
  })
)
