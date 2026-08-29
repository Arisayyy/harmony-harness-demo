import { Effect, Layer } from "effect"
import { PolicyDenied, PolicyEngine, makePolicyEngine, type PolicyRule } from "../harness/authorization/policy/policy-engine"
import { hasScope, type Principal } from "../harness/authorization/permissions/principal"
import type { Recommendation } from "../harness/agent/planning/recommendation"
import { ErpProvider } from "../integrations/erp/erp-provider"

const requireScopes = (principal: Principal, scopes: ReadonlyArray<string>) => {
  const missing = scopes.filter((scope) => !hasScope(principal, scope))
  return missing.length === 0
    ? Effect.void
    : Effect.fail(new PolicyDenied({ reasons: missing.map((scope) => `Missing write scope: ${scope}`) }))
}

export const layer = Layer.effect(
  PolicyEngine,
  Effect.gen(function*() {
    const erp = yield* ErpProvider

    const workflowScopes: PolicyRule = {
      name: "workflow-write-scopes",
      evaluate: (principal, recommendation, state) => recommendation._tag === "EnterWorkflow"
        ? requireScopes(principal, ["erp:po:create", "erp:po:cancel", "production:notify", "mail:send"]).pipe(Effect.as(state))
        : Effect.succeed(state)
    }

    const purchasingReroute: PolicyRule = {
      name: "purchasing-reroute-integrity",
      evaluate: (principal, recommendation, state) => Effect.gen(function*() {
        if (recommendation._tag !== "EnterWorkflow") return state
        const originalPo = yield* erp.getPurchaseOrder(principal, recommendation.parameters.originalPoId).pipe(
          Effect.mapError(() => new PolicyDenied({ reasons: ["Unable to verify the original purchase order."] }))
        )
        if (originalPo.partId !== recommendation.parameters.partId) return yield* new PolicyDenied({ reasons: ["The original purchase order does not match the proposed part."] })
        if (originalPo.supplierId === recommendation.parameters.alternateSupplierId) return yield* new PolicyDenied({ reasons: ["Alternate supplier must differ from the original PO supplier."] })

        const suppliers = yield* erp.listSuppliersForPart(principal, recommendation.parameters.partId).pipe(
          Effect.mapError(() => new PolicyDenied({ reasons: ["Unable to verify alternate supplier authorization."] }))
        )
        const supplier = suppliers.find((candidate) => candidate.supplierId === recommendation.parameters.alternateSupplierId)
        if (supplier === undefined || !supplier.approved || !supplier.approvedParts.includes(recommendation.parameters.partId)) {
          return yield* new PolicyDenied({ reasons: ["Alternate supplier is not approved for the requested part."] })
        }
        const price = supplier.pricing.find((item) => item.partId === recommendation.parameters.partId)
        if (price === undefined) return yield* new PolicyDenied({ reasons: ["No approved price exists for the alternate supplier and part."] })

        const value = price.unitPrice * recommendation.parameters.quantity
        if (value <= principal.approvalLimits.poCreateMaxValue) return state
        if (principal.managerId === undefined) return yield* new PolicyDenied({ reasons: ["PO value exceeds approval authority and no manager is configured."] })
        return {
          assignedApproverId: principal.managerId,
          policyReason: `Agent write plan requires approval; replacement PO value ${value.toFixed(2)} exceeds ${principal.name}'s ${principal.approvalLimits.poCreateMaxValue.toFixed(2)} limit.`
        }
      })
    }

    const boundedActionScopes: PolicyRule = {
      name: "bounded-action-write-scopes",
      evaluate: (principal, recommendation, state) => {
        if (recommendation._tag !== "ProposedActions") return Effect.succeed(state)
        const required = new Set<string>()
        for (const action of recommendation.actions) {
          switch (action._tag) {
            case "quality.reallocate-lot":
              required.add("erp:quality:reallocate")
              break
            case "production.notify":
              required.add("production:notify")
              required.add("mail:send")
              break
            case "purchasing.flag-shortage":
              required.add("purchasing:flag-shortage")
              required.add("mail:send")
              break
          }
        }
        return requireScopes(principal, [...required]).pipe(Effect.as(state))
      }
    }

    return makePolicyEngine([workflowScopes, purchasingReroute, boundedActionScopes])
  })
)
