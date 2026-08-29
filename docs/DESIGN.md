# Design: a durable enterprise agent harness

## 1. Problem framing

The interesting failure mode for enterprise agents is rarely “the model produced a bad sentence.” It is that an ambiguous model decision is allowed to cross into a privileged system without enough identity, evidence, policy, approval, retry semantics, or audit context around it.

This submission treats the agent as a small distributed system. AI is useful at two interpretation boundaries, but it is deliberately not the authority for permissions or side effects.

The demo uses a synthetic RealTruck Guadalajara manufacturing environment because manufacturing creates a useful multi-system problem: inventory and production live in ERP-like data, supplier risk arrives in email, approver availability lives in calendar state, and a correct response can involve expensive writes that must survive retries and human latency.

The design goal is therefore:

**AI for semantic interpretation; deterministic code for routing validation, authority, and execution.**

## 2. Kernel, capabilities, integrations, and environments

The repository separates four concerns.

`harness/` is the reusable kernel: event ingress, attention/run orchestration, approvals, generic policy evaluation, workflow support, tool runtime, scheduling, memory, audit, and evaluation contracts. The kernel should not need to know that purchasing or quality exists.

`domain/` contains installed business capabilities such as purchasing and quality. Those capabilities own domain models, detectors, tools, and workflows.

`integrations/` contains provider contracts and concrete adapters. Domain code depends on `ErpProvider`, `MailProvider`, and `CalendarProvider`, not SQLite tables. OpenRouter implementations also live here because they are replaceable AI adapters.

`app/` is composition: it registers context resolvers, mail routes, business policy rules, recommendation execution, and tools. This is where the application decides which capabilities are installed.

Finally, `environments/demo/` composes the portable RealTruck demonstration. It selects SQLite enterprise adapters and either OpenRouter AI or deterministic CI AI fixtures. A real deployment can replace those edges without changing `AgentHarness`.

This separation gives the codebase a useful architectural test: adding Scenario C should primarily add a domain capability and composition registrations, not another `if (domain === ...)` inside the harness kernel.

## 3. Event-driven mail ingestion

Scenario A is event-driven rather than polling-driven.

A real mail adapter, webhook, or provider subscription hands a received message to `MailIngress.received(principalId, mail)`. The demo simulates that callback after inserting the message into its fake mailbox.

Every incoming email crossing this boundary is immediately analyzed by the configured `MailTriage` AI service. The model receives only the message and the names/descriptions of installed mail routes and returns:

```text
IgnoreMail
RouteMail(route)
```

This model is a semantic router, not an agent executor. It cannot call ERP, create a PO, approve a plan, or dynamically register capabilities. A route returned by the model is independently validated against `MailRouteCatalog`.

If mail is routed, the registered domain handler performs deterministic checks against current enterprise state. For the purchasing route, the handler verifies inventory pressure, the referenced open PO, and near-term production demand before it creates a durable `AttentionItem`. The new attention is passed directly to `AgentHarness.propose`, so a high-value email can wake the full agent immediately rather than waiting for a scan interval.

A relevant email therefore normally produces two bounded AI calls:

1. **mail triage** — fast semantic relevance/routing;
2. **planning** — after the system has established actionable attention and gathered richer permission-scoped evidence.

Irrelevant mail incurs only the first call.

This choice optimizes responsiveness and coverage. At production scale it also creates explicit obligations: webhook/event dedupe, backpressure, concurrency limits, model quotas, cost observability, and an approved privacy/data-residency boundary for mail content. `MailTriage` is an injectable service specifically so an organization may use a cheaper classifier, private model, or on-prem model without changing event orchestration.

## 4. Durable attention and permission-scoped context

An event handler converts a credible operational condition into an `AttentionItem`. Attention has a durable dedupe key backed by a database uniqueness constraint, so redelivery cannot create repeated work.

The generic `AgentHarness` does not switch on purchasing versus quality. It resolves a `ContextResolver` by attention kind through `ContextResolverCatalog`. The installed resolver then makes specific provider calls under the effective `Principal`.

Authorization is intentionally enforced inside provider adapters. Filtering unauthorized records only after retrieval is not true least privilege because sensitive data has already crossed into the process/model context. ERP, mail, and calendar providers therefore reject reads the principal is not allowed to perform.

Each retrieved fact becomes an immutable `EvidenceSnapshot` with provider, source ID, observed time, and payload. Those snapshots are persisted with the run and audit trail before planning.

## 5. Planner as an intent compiler

The second AI boundary is the planner. It receives an attention kind, detector payload, and permission-filtered evidence and compiles them into a small typed intent algebra:

```text
NoAction
EnterWorkflow(purchasing.reroute-po, parameters)
ProposedActions([bounded action...])
```

The planner has no tool handles. Structured generation is decoded by Effect Schema, and every returned evidence reference is checked against the supplied snapshot IDs.

This keeps prompt injection away from authority. A malicious or misleading email may influence semantic interpretation, but it cannot supply a hidden method for creating a PO. A poor recommendation still has to survive deterministic policy, human approval, workflow invariants, and runtime authorization.

Once a high-risk purchasing intent is accepted, the model no longer controls ordering. The six reroute steps are business logic and must not be re-decided probabilistically at each node.

## 6. Policy and approval

The generic `Gate` has two universal responsibilities: no-action handling and immutable plan hashing. Business authorization is delegated to a composable `PolicyEngine` assembled by the application.

The current installed rules include:

- workflow write-scope requirements;
- purchasing reroute integrity and supplier qualification;
- monetary authority and manager routing;
- bounded-action write-scope requirements.

The purchasing rule verifies that the original PO contains the proposed part, that the alternate differs from the incumbent supplier, that the alternate is approved for that part, that a price exists, and that the effective user has sufficient monetary authority or the plan is routed to the correct manager.

This structure is intentionally different from replacing `if` with abstract syntax for aesthetic reasons. Local guard clauses remain inside a policy rule because they express that rule. What disappeared is kernel branching whose purpose was to select which domain implementation exists.

Every agent-originated write still requires plan-level approval. The typed recommendation is hashed with SHA-256. The durable approval stores that hash, effective user, requested/assigned approver, policy reason, reviewer, and decision. Before execution, policy is evaluated again; a changed hash or changed required approver makes the old approval stale.

Approval waiting is an Effect Workflow backed by durable workflow primitives. Backup routing checks calendar OOO state and can reassign a still-pending approval without mutating the plan itself.

## 7. Recommendation execution and durable workflow

`AgentHarness` does not import the purchasing workflow. Once an approved recommendation is ready to execute, it delegates to the injected `RecommendationExecutor`.

The application executor interprets the typed recommendation. A high-risk workflow intent enters the registered purchasing workflow; bounded actions execute sequentially through `ToolRuntime`. The kernel therefore stays stable as business execution capabilities evolve.

`purchasing.reroute-po@1` has six fixed activities:

1. confirm the alternate supplier is approved and genuinely different;
2. confirm lead time meets production;
3. create the replacement PO;
4. cancel/reduce the old PO;
5. notify production;
6. schedule the next-Tuesday arrival check.

Mutable reads and side effects that affect branching live inside durable activities. Mutating activities have compensation where a meaningful inverse exists: cancel the replacement PO, restore the old PO state, emit a corrective production message, and cancel scheduled follow-up work.

Workflow identity includes the durable agent `runId` plus business object IDs. That prevents a fresh demo or future agent run from accidentally replaying a historically completed execution while preserving resume semantics for the same run.

Effect Workflow provides orchestration/activity replay. `ToolRuntime` independently persists idempotency keys/results for side effects. That defense in depth is intentional: exactly-once behavior cannot be assumed across arbitrary external SaaS/ERP systems. Production adapters should propagate the same idempotency token whenever their upstream API supports it and reconcile otherwise.

The restart test is adversarial: a child Bun process reaches replacement-PO creation and is terminated with real `SIGKILL`. A separate Bun process opens the same SQLite state and resumes. The test verifies no duplicate replacement PO exists.

## 8. Scheduling and re-entry

The reroute persists a next-Tuesday arrival check rather than ending after its initial mutations. `ScheduledWork` is durable; when due, the dispatcher can create new attention and return work to the same agent loop.

The challenge uses a persisted virtual `BusinessClock` so a multi-day process is deterministic and the demo can advance from Wednesday to Tuesday instantly. Business virtual time is intentionally distinct from workflow-runtime durability.

## 9. Audit and observability

The audit API is append-only. Events carry run/trace identity, actor, effective user, timestamp, evidence, and structured data.

Mail ingress produces `mail.received`, `mail.triaged`, and `mail.routed`. The spawned agent run then records context, planner recommendation, policy result, approval, execution start/completion, and concrete tool operations. `ToolRuntime` records tool name, idempotency key, validated input, result/replay/denial/failure under the correlated run.

The Scenario A exporter can combine the mail-event identity with the spawned agent-run identity into one NDJSON recording, so a reviewer can reconstruct the complete causal chain from received supplier email through enterprise writes.

Effect spans surround AI, tools, workflows, and orchestration. The demo intentionally does not require an external OTLP collector, but the service boundaries allow a production telemetry sink without changing business logic.

## 10. Evaluation strategy

Model quality and system safety are evaluated separately.

The planner benchmark has five versioned fixtures × three live repetitions. Deterministic scoring checks recommendation variant, workflow, critical workflow parameters such as `alternateSupplierId`, required actions/evidence, and forbidden values. Stored recommendations can be replay-scored without another model call. No LLM judge is used.

Mail triage is separately tested at the ingress boundary: irrelevant mail is ignored, supplier-delay mail routes to `purchasing.supply-risk` and immediately starts exactly one agent run, and redelivery starts no second run.

Safety/durability integration tests independently cover supplier policy, no-op reroute rejection, runtime permission revocation, backup approval routing, workflow identity/replay, and real process death/recovery. CI runs strict TypeScript, all Bun-native integration tests, the deterministic end-to-end demo, and audit-artifact generation without requiring an external model secret.

## 11. Identity and authentication

The demo models authorization state rather than pretending a seeded table is a real OAuth server. A `Principal` represents the effective user and carries scopes, reporting relationships, backup approver, and monetary authority.

In production, a principal should only be constructed after authenticating a human/workload through the organization's IdP. Employee-facing access would typically use OIDC/SAML SSO plus short-lived delegated connector credentials. Service-to-service calls should use workload identity. Every run should preserve authenticated actor and effective user separately where delegation exists.

Authentication precedes entry to the harness; authorization is then enforced again at every read/write boundary. AI never manufactures identity. Human approvals also require authenticated reviewer identity and are validated against the currently required approver.

## 12. Long-term memory

Durable memory here means operational state required for correctness: attention, run snapshots, evidence, approval state, workflow state, scheduled work, idempotency records, and audit history.

This intentionally avoids treating an opaque vector store as authority. High-value facts used to approve a write are re-read from the relevant system of record and snapshotted into the current run.

A production system may add permission-aware user preferences or semantic historical memory as another provider, with explicit provenance/retention rules. Such memory must never silently broaden the current principal's connector permissions.

## 13. Scaling to thousands of employees

The demo's one-process SQLite deployment optimizes reviewer portability, not fleet scale. The architecture scales around events, attention items, agent runs, workflow instances, and connector calls—not chat sessions.

A production deployment would use provider webhooks/subscriptions to feed ingress, durable/event-queue buffering before workers, managed SQL for harness/workflow state, horizontal stateless API/triage/planner workers, and distributed durable workflow execution. Mail triage specifically needs per-tenant backpressure and concurrency quotas because every inbound email intentionally invokes AI.

Tenant/user isolation belongs in every persistence key/query and credential boundary. Provider rate limits must be enforced per upstream/organization. Model usage should have per-tenant quotas and telemetry. Duplicate provider events must be collapsed under stable provider event/message IDs before downstream work.

The existing attention dedupe and tool idempotency model remains useful under horizontal concurrency because database constraints—not process memory—are the final arbiter. Audit/observability/evaluation consumers can fan out asynchronously and stay off the privileged write path.

## 14. Production adapter path

The SQLite ERP/mail/calendar implementations are demo adapters behind provider contracts. A real deployment can substitute SAP/Oracle/Dynamics and Microsoft Graph/Gmail/Google Calendar without changing the harness kernel.

For email specifically, a Microsoft Graph or Gmail integration would persist/fetch the message as appropriate and invoke `MailIngress.received` from its subscription/webhook handler. It would not reproduce purchasing logic inside the connector.

Likewise, OpenRouter is an environment choice. `MailTriage` and `Planner` are independent injectable services; customers can select separate providers/models for each boundary.

Production infrastructure would also replace local SQLite with managed SQL, local append-only audit with an appropriate durable compliance sink, local secrets with KMS/workload identity, and CLI approval with an enterprise approval surface. None of those changes should grant the model additional authority.

## 15. Would a graph-first deterministic workflow engine be designed differently?

Yes, mainly at the authoring/scheduling layer rather than at the safety boundaries.

Scenario A is sequential with a required fixed order, so Effect Workflow expressed as ordinary typed control flow is a good fit. A graph representation would add little reachable behavior here.

A graph-first engine becomes more useful with parallel branches, joins, conditional subgraphs, multiple human waits, reusable subgraphs, visualization, or workflow-version migration. I would then compile a typed graph/DAG into the same durable activity/runtime concepts and persist node/edge version information.

The **event ingress, planner, context catalog, policy engine, approval binding, tool catalog, idempotency, evidence, and audit contracts would not change**. Changing workflow authoring representation must not grant AI more authority or require reworking connector security.

For this challenge I would keep the current code-first workflow. For a general enterprise workflow product, I would add graph authoring on top of the same durable runtime and safety kernel rather than replacing them.