# Design: a durable enterprise agent harness

## 1. Problem framing

The interesting failure mode for enterprise agents is rarely “the model produced a bad sentence.” It is that an ambiguous model decision is allowed to cross into a privileged system without enough identity, evidence, policy, approval, retry semantics, or audit context around it.

This submission treats the agent as a small distributed system. The LLM is one component inside that system and is deliberately not the authority for permissions or side effects.

The demo uses a RealTruck Guadalajara manufacturing fixture because manufacturing creates a useful multi-system problem: inventory and production live in ERP-like data, the supplier delay arrives in email, approver availability lives in calendar state, and a correct response can involve expensive writes that must survive retries and human latency.

The implementation has two goals that pull in opposite directions. It should feel agentic—the system notices issues, gathers context, interprets noisy data, and selects a response without a scripted user prompt—but it must also be predictable at the boundaries where money, production state, and authorization are involved.

The resulting split is:

**LLM for interpretation; deterministic code for authority and execution.**

## 2. Runtime and state model

The code is TypeScript on Bun with Effect 4. Effect provides explicit service dependencies, typed error channels, resource scopes, tracing spans, and the workflow primitives. SQLite is the single portable persistence substrate for the demo. The fake ERP, mail, and calendar systems have independent provider interfaces but share that local database so the entire submission can run without Docker or external SaaS accounts.

This is an implementation convenience, not an architectural coupling: domain/context code depends on `ErpProvider`, `MailProvider`, and `CalendarProvider`, not SQL tables. A production adapter can replace each SQLite layer with a real delegated API while the planner, gate, workflow, and audit code remain unchanged.

Persistent state is used for four distinct reasons:

- enterprise fixture state: POs, lots, production orders, mail, calendars;
- harness state: attention items, approvals, scheduled work, audit, model benchmark rows;
- agent-run state: the exact evidence/recommendation/gate/approval relationship for a proposal;
- Effect Workflow state: activity/replay state needed to resume deterministic workflows.

An Effect fiber/context is never treated as durable memory. Anything required after approval or restart is stored explicitly.

## 3. Detection and context gathering

The agent starts from detectors, not chat. A detector converts a change in enterprise state into an `AttentionItem`. Each attention item has a durable `dedupeKey`, and the repository has a uniqueness constraint so repeated scans cannot create a queue storm.

The detector does not hand the model unrestricted database access. Once an attention item is accepted, a context service makes specific calls through the provider interfaces using the effective `Principal`.

Authorization is intentionally enforced inside each provider adapter. This matters because filtering an already-fetched result after the fact is not a real least-privilege boundary: the sensitive data has already entered the process/model context. The provider returns a typed denial if the principal lacks the relevant read scope.

Each retrieved fact becomes an immutable `EvidenceSnapshot` with provider, source ID, observed time, and payload. The complete snapshots enter audit/run storage. Only the typed set is sent to the planner.

## 4. Planner as an intent compiler

The planner is best understood as an intent compiler. It converts noisy, heterogeneous evidence into one small typed algebra:

```text
NoAction
EnterWorkflow(purchasing.reroute-po, parameters)
ProposedActions([bounded action...])
```

It has no tool handles. Structured output is decoded against Effect Schema, and evidence references are checked against the supplied evidence IDs after generation.

This makes prompt injection materially less powerful. An email may still persuade the model to recommend something incorrect, but it cannot give the model a hidden method for creating a PO. The next component—the policy gate—receives the typed recommendation and independently applies business rules.

This is also why the purchasing path is a workflow rather than six model tool calls. Once the intent “reroute this PO to this approved alternate” is accepted, the exact ordering, compensation, idempotency, and restart semantics are business logic and should not be re-decided by a probabilistic model at every step.

## 5. Authorization and approval model

A `Principal` carries scopes, manager/backup relationships, and an approval limit. The gate performs plan-level checks before any approval is requested.

For the reroute path it verifies the write scopes, verifies that the original PO actually contains the proposed part, requires the alternate supplier to differ from the incumbent supplier, confirms that the proposed supplier is approved for the exact part, finds an approved price, computes the replacement PO value, and determines whether the user's authority is sufficient. The intentionally cheaper `S-Q` supplier exists in the data but is unapproved; a model that selects it is rejected regardless of its rationale.

Every write still goes through `ToolRuntime`, which rechecks the principal's current scopes immediately before execution. The integration test revokes `erp:po:create` after the planning boundary and proves that the runtime blocks the write. This closes a time-of-check/time-of-use gap between plan approval and execution.

Approval is plan-level. The gate hashes the typed recommendation with SHA-256. The durable approval record stores that hash, policy reason, requested/assigned approver, and decision. Before execution the harness evaluates policy again. It rejects execution if either the plan hash or the currently required approver no longer matches the approval.

Approval waiting is an Effect Workflow backed by a `DurableDeferred`, so the process does not need to stay alive while a human decides. Backup routing is modeled separately against calendar OOO state; changing who is assigned does not silently alter the approved plan itself.

## 6. Durable workflow and side-effect semantics

`purchasing.reroute-po@1` has six named activities:

1. confirm alternate supplier approval;
2. confirm lead time against production;
3. create the replacement PO;
4. cancel the old PO;
5. notify production;
6. schedule the next-Tuesday arrival check.

The first workflow activity repeats the original-PO and true-alternate checks even though policy already performed them. That is deliberate defense in depth: direct/internal workflow execution cannot bypass a business invariant merely because the normal caller would have gated it.

Activities that mutate state have compensation where a meaningful inverse exists. A failed later step can cancel the newly created PO, restore the old PO status, emit a correction, and cancel scheduled follow-up work.

Workflow identity includes the durable agent `runId` plus the original PO and production order. This was an important hardening detail: using only the business object IDs would cause a deliberately reset demo to collide with a completed historical workflow and replay it instead of creating a clean new execution.

Effect Workflow provides durable activity replay, but the implementation also protects each side effect with `ToolRuntime` idempotency. The idempotency key/result is persisted separately. This defense-in-depth matters because exactly-once effects cannot be assumed across arbitrary external systems; production adapters would use the same key as a provider request/idempotency token wherever supported.

The restart test is intentionally adversarial. A child Bun process executes through the PO-creation activity and then receives a real `SIGKILL`. The parent starts a separate Bun process against the same SQLite file. The workflow resumes and the test asserts that only one replacement PO exists. This validates persistence across process memory loss rather than merely catching an exception in the same runtime.

## 7. Scheduling and re-entry

The reroute does not end when the initial mutation succeeds. It schedules a check for the next Tuesday. `ScheduledWork` is durable; a dispatcher finds due work and returns it to the same attention loop.

The demo uses a virtual `BusinessClock` stored in SQLite. That keeps a multi-day scenario deterministic and lets the test/demo advance from Wednesday to Tuesday without sleeping for six real days. The clock is an explicit domain service rather than scattered `Date.now()` calls, which also makes workflow business-time reads auditable and testable.

## 8. Audit and observability

The audit log is append-only at the application API. Events carry a run ID and trace ID, actor, effective user, timestamp, evidence snapshots where applicable, and structured data.

The important distinction is between **evidence** and **decision**. `context.gathered` preserves the observed facts. `planner.recommendation` records the model/model version and the evidence IDs it used. `gate.evaluated` records deterministic policy. Approval and execution events then make the human and side-effect history visible. The demo exporter emits newline-delimited JSON for a run.

Effect spans are named around planner generation, tools, workflows, and higher-level harness operations. The submission keeps telemetry local rather than requiring an external collector, but the Effect service boundary allows OTLP or another sink to be added without changing domain code.

## 9. Evaluation strategy

The planner is evaluated separately from the safety kernel. Five versioned benchmark cases are run three times each. Deterministic scoring checks structural behavior and grounding, not prose similarity. Stored runs can be replay-scored without another API call.

This matters because a safe harness should not conflate “model quality” with “system safety.” A planner can fail a benchmark while the deterministic gate still prevents a forbidden write. Conversely, a planner can pass every fixture while a broken tool boundary would still be unacceptable. CI therefore validates the deterministic invariants independently of an external API key.

The current integration suite covers durable trigger dedupe, unapproved-supplier rejection, rejection of a no-op incumbent-supplier reroute, runtime scope revocation, backup approver routing, workflow run identity/replay, and real process death/recovery. CI runs strict TypeScript first and then the Bun-native tests against the actual `bun:sqlite` driver, followed by the full deterministic demo.

## 10. Production path and tradeoffs

The demo makes several deliberate simplifications. It is a single process except for the crash fixture; enterprise providers share one SQLite database; identity is represented by a seeded principal rather than an OAuth/SSO token exchange; and the audit table is locally append-only rather than cryptographically anchored or WORM-backed.

A production deployment would preserve the interfaces while changing the edges:

- real ERP/mail/calendar adapters with delegated credentials and provider-side authorization;
- a managed SQL database for harness/workflow state;
- KMS-backed secrets and service identity;
- an approval UI or integration with the organization's workflow system;
- provider-native idempotency keys and reconciliation jobs;
- an external append-only audit/telemetry sink;
- rate limits, quotas, and per-tool concurrency controls;
- benchmark gates before planner/model rollout.

The most important production property is already represented in the demo: none of those infrastructure replacements require granting the model more authority. The planner stays a typed recommendation boundary, and the deterministic safety kernel stays between the model and enterprise side effects.

## 11. Identity and authentication

The demo intentionally models **authorization state**, not a fake OAuth server. A seeded `Principal` is the effective user and carries the scopes, reporting chain, backup approver, and monetary authority used by providers, policy, approvals, and tools. That is enough to exercise propagation and enforcement without disguising fixture code as real identity infrastructure.

In production the principal would be constructed only after authenticating a human or workload through the organization's IdP. For an interactive employee agent, the preferred path is OIDC/SAML SSO into the agent service followed by short-lived delegated connector credentials. The harness should preserve both the authenticated actor and the effective user in every run. Connector calls should use delegated credentials where possible rather than a shared omnipotent service token. Service-to-service calls would use workload identity and mTLS or equivalent platform identity.

The important invariant is that authentication happens before a `Principal` enters the harness and authorization happens again at every data/side-effect boundary. A model never chooses or manufactures its own identity. Approval decisions also require an authenticated reviewer identity, and the durable approval verifies that reviewer against the currently assigned approver before resolving the wait.

## 12. Long-term memory

Long-term memory is deliberately narrower than “store every conversation in a vector database.” The durable memory that matters for this class of enterprise agent is structured operational memory: attention items, run snapshots, evidence, approval state, workflow state, scheduled work, idempotency records, and audit history.

Those records answer questions such as “what did the agent know when it proposed this?”, “was this plan already executed?”, “which approval authorized the write?”, and “what must resume after a restart?” without semantic retrieval or model inference.

A production system could add user preferences or summarized historical context, but that memory would be a separate, permission-aware provider with retention and provenance rules. It would never silently broaden the user's current connector permissions. High-value facts used to authorize a write would still be re-read from the system of record and snapshotted into the current run rather than trusted from stale semantic memory.

## 13. Scaling to thousands of employees

The current single-process/SQLite deployment is intentionally optimized for reviewer portability, not fleet scale. The service boundaries are designed so the execution model can scale without changing domain code.

At thousands of employees, the main scaling units are **attention items, agent runs, workflow instances, and connector calls**, not chat sessions. A production deployment would move harness and workflow persistence to managed SQL, run stateless detector/planner/API workers horizontally, and use Effect Cluster or another durable routing layer to distribute workflow execution. Scheduled work would be partitioned by due time/tenant, and connector concurrency would be rate-limited per upstream system and organization.

Tenant and employee isolation would be explicit in every persistence key and query. Provider credentials would be scoped per user/organization, policy data would be cached with short lifetimes and versioned invalidation, and expensive LLM work would be bounded by per-user/organization quotas. The dedupe key and idempotency-key model already prevents horizontal workers from turning duplicate events/retries into duplicate writes; in production the underlying database constraints remain the final arbiter.

The audit/event stream can fan out asynchronously to observability, compliance, and evaluation consumers. None of those consumers need to sit on the critical write path. This keeps the authorization/approval/tool path small while still allowing organization-wide analytics and evaluation.

## 14. Would a graph-first deterministic workflow engine be designed differently?

Yes, but mostly at the authoring and scheduling layer rather than at the safety boundaries.

This submission expresses Scenario A as a sequential Effect Workflow because the challenge requires a fixed six-step order and the desired API is intentionally close to normal program control flow. Activities are durable nodes, compensation is attached to mutations, and replay makes the sequential definition restart-safe. For this workflow, a graph representation would add ceremony without adding reachable behavior.

A graph-first engine becomes valuable when workflows have explicit parallel branches, joins, conditional subgraphs, human waits at multiple branches, reusable subgraphs, or graph-level visualization/version migration requirements. In that design, the definition would likely compile a typed DAG/state machine into durable Effect Workflow execution. Node IDs and edge conditions would become part of the persisted workflow version, and the engine would validate acyclicity/reachability (or explicitly modeled loops) before deployment.

The **planner, gate, approval binding, tool catalog, idempotency, evidence, and audit contracts would not change**. The graph engine would only change how an already-authorized business process is orchestrated. That separation is intentional: switching from sequential code-first workflow authoring to a DAG should not grant the model additional authority or require rewriting connector security.

For Scenario A specifically, I would keep the current code-first definition. If the product grew into a general enterprise workflow platform, I would add a graph authoring layer that compiles onto the same Effect Workflow activities rather than replacing the durable runtime or safety kernel.
