import { Context, Crypto, Effect, Layer } from "effect"
import { AgentHarness } from "../../agent/execution/agent-harness"
import { AuditLog } from "../../audit/service/audit-log"
import { EvidenceSnapshot } from "../../audit/model/audit-event"
import { PrincipalDirectory } from "../../authorization/permissions/principal-directory"
import { MailRouteCatalog } from "../catalog/mail-route-catalog"
import type { InboundMail } from "../model/inbound-mail"
import { MailTriage, type MailTriageDecision } from "../triage/mail-triage"
import type { RunRecord } from "../../memory/durable/run-record"

export type MailIngressResult = {
  readonly decision: MailTriageDecision
  readonly runs: ReadonlyArray<RunRecord>
}

export class MailIngress extends Context.Service<MailIngress, {
  readonly received: (principalId: string, mail: InboundMail) => Effect.Effect<MailIngressResult, unknown>
}>()("harmony/events/MailIngress") {}

export const layer = Layer.effect(
  MailIngress,
  Effect.gen(function*() {
    const triage = yield* MailTriage
    const routes = yield* MailRouteCatalog
    const directory = yield* PrincipalDirectory
    const harness = yield* AgentHarness
    const audit = yield* AuditLog
    const crypto = yield* Crypto.Crypto

    return MailIngress.of({
      received: Effect.fn("MailIngress.received")(function*(principalId, mail) {
        const principal = yield* directory.get(principalId)
        const traceId = yield* crypto.randomUUIDv4
        const ingressRunId = `mail:${mail.messageId}`
        const evidence = [new EvidenceSnapshot({ provider: "mail", sourceId: mail.messageId, observedAt: mail.date, payload: mail })]

        yield* audit.append({
          runId: ingressRunId,
          traceId,
          eventType: "mail.received",
          actor: "mail-ingress",
          effectiveUserId: principal.userId,
          evidence,
          data: { messageId: mail.messageId, from: mail.from }
        })

        const decision = yield* triage.triage(mail, routes.summaries)
        yield* audit.append({
          runId: ingressRunId,
          traceId,
          eventType: "mail.triaged",
          actor: `model:${triage.model}`,
          effectiveUserId: principal.userId,
          evidence,
          data: { triageVersion: triage.version, decision }
        })

        switch (decision._tag) {
          case "IgnoreMail":
            return { decision, runs: [] }
          case "RouteMail": {
            const route = yield* routes.resolve(decision.route)
            const attentionItems = yield* route.handle(principal, mail)
            const runs = yield* Effect.forEach(attentionItems, (item) => harness.propose(item.attentionId), { concurrency: 1 })
            yield* audit.append({
              runId: ingressRunId,
              traceId,
              eventType: "mail.routed",
              actor: `route:${route.route}`,
              effectiveUserId: principal.userId,
              evidence,
              data: { attentionIds: attentionItems.map((item) => item.attentionId), agentRunIds: runs.map((run) => run.runId) }
            })
            return { decision, runs }
          }
        }
      })
    })
  })
)
