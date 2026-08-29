import { Effect, Layer } from "effect"
import { IgnoreMail, MailTriage, RouteMail } from "../harness/events/triage/mail-triage"

const relevant = /shipment|delivery|delay|slip|revised ship|dock|purchase order|\bPO[-\s]?\d+/i

export const layer = Layer.succeed(MailTriage, MailTriage.of({
  version: "mail-triage/fixture-v1",
  model: "deterministic-ci-mail-triage",
  triage: (mail, routes) => {
    const route = routes.find((candidate) => candidate.route === "purchasing.supply-risk")
    const text = `${mail.subject}\n${mail.body}`
    return Effect.succeed(
      route !== undefined && relevant.test(text)
        ? new RouteMail({ _tag: "RouteMail", route: route.route, rationale: "Inbound mail describes supplier or delivery timing that may affect a purchase order.", confidence: 1 })
        : new IgnoreMail({ _tag: "IgnoreMail", rationale: "Inbound mail does not match an installed operational route.", confidence: 1 })
    )
  }
}))
