import { Context, Data, Effect } from "effect"
import type { Principal } from "../../authorization/permissions/principal"
import type { EvidenceSnapshot } from "../../audit/model/audit-event"
import type { AttentionItem } from "./attention-item"

export type ContextResolver = {
  readonly kind: string
  readonly gather: (principal: Principal, attention: AttentionItem) => Effect.Effect<ReadonlyArray<EvidenceSnapshot>, unknown>
}

export class ContextResolverMissing extends Data.TaggedError("ContextResolverMissing")<{ readonly kind: string }> {}

export class ContextResolverCatalog extends Context.Service<ContextResolverCatalog, {
  readonly resolve: (kind: string) => Effect.Effect<ContextResolver, ContextResolverMissing>
  readonly kinds: ReadonlyArray<string>
}>()("harmony/agent/ContextResolverCatalog") {}

export const makeContextResolverCatalog = (resolvers: ReadonlyArray<ContextResolver>) => {
  const byKind = new Map(resolvers.map((resolver) => [resolver.kind, resolver] as const))
  return ContextResolverCatalog.of({
    kinds: [...byKind.keys()],
    resolve: (kind) => {
      const resolver = byKind.get(kind)
      return resolver === undefined ? Effect.fail(new ContextResolverMissing({ kind })) : Effect.succeed(resolver)
    }
  })
}
