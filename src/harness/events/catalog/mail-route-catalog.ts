import { Context, Data, Effect } from "effect"
import type { AttentionItem } from "../../agent/context/attention-item"
import type { Principal } from "../../authorization/permissions/principal"
import type { InboundMail } from "../model/inbound-mail"
import type { MailRouteSummary } from "../triage/mail-triage"

export type MailRoute = MailRouteSummary & {
  readonly handle: (principal: Principal, mail: InboundMail) => Effect.Effect<ReadonlyArray<AttentionItem>, unknown>
}

export class MailRouteMissing extends Data.TaggedError("MailRouteMissing")<{ readonly route: string }> {}

export class MailRouteCatalog extends Context.Service<MailRouteCatalog, {
  readonly summaries: ReadonlyArray<MailRouteSummary>
  readonly resolve: (route: string) => Effect.Effect<MailRoute, MailRouteMissing>
}>()("harmony/events/MailRouteCatalog") {}

export const makeMailRouteCatalog = (routes: ReadonlyArray<MailRoute>) => {
  const byName = new Map(routes.map((route) => [route.route, route] as const))
  return MailRouteCatalog.of({
    summaries: routes.map(({ route, description }) => ({ route, description })),
    resolve: (route) => {
      const found = byName.get(route)
      return found === undefined ? Effect.fail(new MailRouteMissing({ route })) : Effect.succeed(found)
    }
  })
}
