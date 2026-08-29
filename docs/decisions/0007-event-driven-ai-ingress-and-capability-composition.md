# ADR 0007 — Event-driven AI ingress and capability composition

Status: Accepted

## Context

The first implementation of Scenario A was autonomous from chat, but the demo still inserted a supplier email and then explicitly invoked a purchasing detector scan. That met the broad scheduled/event detector requirement, but it introduced avoidable latency and made the runtime look more polling-oriented than a real enterprise event system.

The first kernel also accumulated domain knowledge in generic services. `AgentHarness` selected purchasing versus quality context directly, execution knew the purchasing workflow directly, and `Gate` contained purchasing and bounded-action business rules. Those branches were correct locally, but they meant adding a new business capability could require changing the generic harness kernel.

For this harness, incoming mail is important enough that the preferred behavior is to inspect every received message immediately with AI and only then decide whether to wake a domain agent.

## Decision

### Every inbound email crosses AI triage

A mail adapter, webhook, or event subscription calls `MailIngress.received(principalId, mail)` as soon as a message is received.

`MailIngress` always invokes the configured `MailTriage` service. The triage model receives the message plus the names and descriptions of currently installed mail routes and returns one of two typed decisions:

- `IgnoreMail`
- `RouteMail(route)`

The triage model cannot call tools, create arbitrary capabilities, or directly construct a business workflow. A returned route is independently checked against `MailRouteCatalog`.

When a message is routed, its registered route handler performs deterministic domain checks against current provider state and may create a durable `AttentionItem`. New attention is passed immediately to `AgentHarness.propose`; no later polling cycle is required.

A relevant email therefore normally causes two bounded AI calls:

1. immediate mail relevance/routing;
2. evidence-backed planning after the domain detector has established a real attention item.

An irrelevant email causes only the triage call.

### Domain capabilities are composed, not selected by the kernel

The generic harness resolves domain behavior through injectable services:

- `ContextResolverCatalog` selects evidence gathering by attention kind;
- `MailRouteCatalog` exposes installed email-triggered capabilities;
- `RecommendationExecutor` interprets accepted recommendations;
- `PolicyEngine` evaluates an ordered set of named business policy rules;
- `ToolCatalog` exposes schema- and scope-defined enterprise actions.

`AgentHarness` no longer imports purchasing/quality context implementations or the purchasing workflow. `Gate` no longer imports ERP or knows purchasing-specific qualification rules; it delegates business authorization to `PolicyEngine` and retains only universal approval-plan hashing behavior.

Local `if`/`switch` statements remain inside individual domain rules and handlers where they express business logic. They are not used in the kernel to decide which domain implementation exists.

### Demo environment is explicit

The RealTruck Guadalajara fixture is a deployment/environment, not the harness itself.

The concrete SQLite enterprise adapters, OpenRouter services, synthetic organization data, and deterministic CI AI fixtures are composed under `src/environments/demo/`.

`harness/` contains reusable orchestration and safety services. `domain/` contains installed business capabilities. `integrations/` contains provider contracts and adapters. `app/` declares which capabilities/routes/policies are installed in this application.

A real deployment should replace the environment edges—such as SQLite mail with Microsoft Graph and the demo callback with a Graph subscription—without changing the generic agent kernel.

## Consequences

### Positive

- Important email can wake the agent immediately rather than waiting for a scan interval.
- The repository now demonstrates a real event → AI triage → domain route → attention → planner chain.
- New business domains can register context, policy, routes, execution, and tools without adding another domain branch to `AgentHarness`.
- AI triage remains non-authoritative: routing a message does not grant permissions or cause writes.
- The triage model can be replaced independently from the main planner.
- The same architecture supports webhook-based real adapters and deterministic demo fixtures.

### Costs and risks

- Every inbound email incurs a model call, so enterprise deployments need concurrency limits, quotas, backpressure, provider-event dedupe, and cost monitoring.
- Email may contain sensitive information. Production deployment must choose an allowed model/data-residency boundary and may replace OpenRouter triage with an approved private or on-prem model while preserving the `MailTriage` contract.
- Relevant mail can incur two model calls. The first is intentionally narrow and should use a fast/low-cost model where appropriate.
- AI routing can make classification mistakes. Domain route handlers still perform deterministic checks before creating actionable attention, and all writes remain behind policy and approval.

## Validation

The deterministic integration environment proves that:

- an irrelevant inbound email is triaged to `IgnoreMail` and starts no agent run;
- a supplier-delay email is triaged to `purchasing.supply-risk` and immediately starts an agent run;
- replaying the same delivered email creates no second agent run;
- the existing approval, policy, tool-idempotency, workflow replay, and real `SIGKILL` recovery invariants remain intact.

The live environment uses the same event/kernel path with the OpenRouter `MailTriage` and planner implementations.