import { Context, Data, Effect } from "effect"
import type { Recommendation } from "../../agent/planning/recommendation"
import type { Principal } from "../permissions/principal"

export class PolicyDenied extends Data.TaggedError("PolicyDenied")<{ readonly reasons: ReadonlyArray<string> }> {}

export type PolicyState = {
  readonly assignedApproverId: string
  readonly policyReason: string
}

export type PolicyRule = {
  readonly name: string
  readonly evaluate: (principal: Principal, recommendation: Recommendation, state: PolicyState) => Effect.Effect<PolicyState, PolicyDenied>
}

export class PolicyEngine extends Context.Service<PolicyEngine, {
  readonly rules: ReadonlyArray<string>
  readonly evaluate: (principal: Principal, recommendation: Recommendation) => Effect.Effect<PolicyState, PolicyDenied>
}>()("harmony/authorization/PolicyEngine") {}

export const makePolicyEngine = (rules: ReadonlyArray<PolicyRule>) => PolicyEngine.of({
  rules: rules.map((rule) => rule.name),
  evaluate: (principal, recommendation) => Effect.reduce(
    rules,
    () => ({
      assignedApproverId: principal.userId,
      policyReason: "Agent-originated writes require plan-level human approval."
    }),
    (state, rule) => rule.evaluate(principal, recommendation, state)
  )
})
