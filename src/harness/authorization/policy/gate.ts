import { Context, Crypto, Data, Effect, Encoding, Layer } from "effect"
import type { Recommendation } from "../../agent/planning/recommendation"
import type { Principal } from "../permissions/principal"
import { hasScope } from "../permissions/principal"
import { ErpProvider } from "../../../integrations/erp/erp-provider"

export class GateDenied extends Data.TaggedError("GateDenied")<{ readonly reasons: ReadonlyArray<string> }> {}
export type GateApproval = { readonly planHash: string; readonly assignedApproverId: string; readonly policyReason: string }

export class Gate extends Context.Service<Gate, {
  readonly evaluate: (principal: Principal, recommendation: Recommendation) => Effect.Effect<GateApproval | null, GateDenied>
}>()("harmony/authorization/Gate") {}

export const layer = Layer.effect(
  Gate,
  Effect.gen(function*() {
    const erp = yield* ErpProvider
    const crypto = yield* Crypto.Crypto

    const hashPlan = (plan: Recommendation) => Effect.gen(function*() {
      const bytes = new TextEncoder().encode(JSON.stringify(plan))
      const digest = yield* crypto.digest("SHA-256", bytes).pipe(
        Effect.mapError(() => new GateDenied({ reasons: ["Unable to compute the immutable approval-plan hash."] }))
      )
      return Encoding.encodeHex(digest)
    })

    return Gate.of({
      evaluate: Effect.fn("Gate.evaluate")(function*(principal, recommendation) {
        if (recommendation._tag === "NoAction") return null
        const missing = new Set<string>()
        let assignedApproverId = principal.userId
        let policyReason = "Agent-originated writes require plan-level human approval."

        if (recommendation._tag === "EnterWorkflow") {
          for (const scope of ["erp:po:create", "erp:po:cancel", "production:notify", "mail:send"]) if (!hasScope(principal, scope)) missing.add(scope)
          const suppliers = yield* erp.listSuppliersForPart(principal, recommendation.parameters.partId).pipe(Effect.mapError(() => new GateDenied({ reasons: ["Unable to verify alternate supplier authorization."] })))
          const supplier = suppliers.find((candidate) => candidate.supplierId === recommendation.parameters.alternateSupplierId)
          if (supplier === undefined || !supplier.approved || !supplier.approvedParts.includes(recommendation.parameters.partId)) return yield* new GateDenied({ reasons: ["Alternate supplier is not approved for the requested part."] })
          const price = supplier.pricing.find((item) => item.partId === recommendation.parameters.partId)
          if (price === undefined) return yield* new GateDenied({ reasons: ["No approved price exists for the alternate supplier and part."] })
          const value = price.unitPrice * recommendation.parameters.quantity
          if (value > principal.approvalLimits.poCreateMaxValue) {
            if (principal.managerId === undefined) return yield* new GateDenied({ reasons: ["PO value exceeds approval authority and no manager is configured."] })
            assignedApproverId = principal.managerId
            policyReason = `Agent write plan requires approval; replacement PO value ${value.toFixed(2)} exceeds ${principal.name}'s ${principal.approvalLimits.poCreateMaxValue.toFixed(2)} limit.`
          }
        } else {
          for (const action of recommendation.actions) {
            const required = action._tag === "quality.reallocate-lot" ? ["erp:quality:reallocate"] : action._tag === "production.notify" ? ["production:notify", "mail:send"] : ["purchasing:flag-shortage", "mail:send"]
            for (const scope of required) if (!hasScope(principal, scope)) missing.add(scope)
          }
        }

        if (missing.size > 0) return yield* new GateDenied({ reasons: [...missing].map((scope) => `Missing write scope: ${scope}`) })
        return { planHash: yield* hashPlan(recommendation), assignedApproverId, policyReason }
      })
    })
  })
)
