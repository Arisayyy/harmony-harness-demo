# ADR 0003: Durable workflows, approvals, and audit

- Status: Accepted
- Date: 2026-08-28

## Context

Scenario A requires a deterministic purchase-order reroute workflow that survives restart, persists progress, compensates failures, and cannot be reordered by the model.

The same harness needs human approval, approval escalation to a backup when the primary approver is unavailable, deferred follow-up work, and an audit trail from which a reviewer can reconstruct the complete decision and execution history.

The initial direction was to build a small workflow engine from Effect primitives. After reviewing the current Effect v4 workflow implementation and the `@effect/workflows` design notes in Dillon Mulroy's Effect Workflows technical overview, the decision changed: durable workflow infrastructure is a library concern we can legitimately reuse. The challenge is to build the enterprise agent harness and its deterministic business workflow, not to reimplement a durable execution engine for its own sake.

## Decisions

### Use Effect Workflow as the durable substrate

Use `effect/unstable/workflow` for durable workflow execution.

Use its abstractions directly where they map to the challenge:

- `Workflow` for the deterministic business process
- `Activity` for persisted side-effecting or non-deterministic units of work
- `Workflow.withCompensation` for saga-style rollback behavior
- `DurableDeferred` for externally completed human approval waits
- `DurableClock` for durable deferred timing such as the Tuesday arrival check
- `WorkflowEngine` for execution, suspension, replay, polling, interruption, and resumption

For the demo runtime, use Effect's SQL-backed single-runner cluster/workflow infrastructure over the Bun SQLite client. This gives the single-process application durable workflow mailbox and reply state without pretending the challenge needs a distributed cluster.

The workflow body must remain replay-safe. Side effects, wall-clock reads, randomness, model calls, and mutable external reads that can influence workflow branching must happen in durable activities or other durable workflow primitives rather than inline in the replayed workflow body.

### Keep a harness-level workflow definition

Effect Workflow is the execution substrate, not the enterprise harness API.

The repository owns a thin workflow definition layer that adds the business metadata the challenge requires and Effect does not currently expose as a first-class workflow option, particularly:

- explicit workflow version
- business identifier and description
- input contract
- approval policy binding
- audit annotations
- tool and scope metadata where useful for review

A workflow definition therefore carries `version` in our harness even though current Effect v4 `Workflow.make` does not have a built-in version field.

The underlying Effect workflow tag and idempotency key remain stable and deterministic. The design doc will state the policy for in-flight instances when a workflow version changes; migration of in-flight instances is not implemented because the challenge explicitly treats that as a design question.

### Deterministic PO reroute

Scenario A's reroute is a declared workflow. Its order is fixed in code:

1. confirm alternate supplier is approved for the part
2. confirm lead time meets the production date
3. create the replacement PO
4. cancel or reduce the original PO
5. notify production
6. schedule the arrival check

The model may decide to enter this workflow and supply schema-validated parameters. It cannot reorder, skip, inject, or remove workflow steps.

Bounded model work inside a workflow is allowed only when its candidate space is constrained by deterministic code. For example, an activity may ask the model to choose among already filtered approved suppliers or draft a notification, then validate the output through `Schema`.

### Tools, activities, and compensation

Tools remain the harness's typed side-effect primitives. A tool carries its input schema, required scopes, and idempotency behavior and enforces its write scope at execution time.

A workflow activity invokes a tool rather than duplicating connector logic.

Compensation belongs to the workflow step because undo semantics are business-context-specific. The workflow registers compensation around successful steps whose effects need to be reversed if a later step fails.

Every externally visible write also receives an idempotency key derived from the workflow execution and stable step identity. Effect's persisted activity result prevents replay from rerunning a completed activity; the target tool's idempotency key provides defense in depth if execution fails around the system boundary.

### Approval semantics

Every agent-originated write plan requires human approval.

PO approval limits determine who is authorized to approve the proposed plan, not whether agent writes require approval at all. A purchasing manager may approve a plan within their own limit. A plan above that limit routes to an appropriately authorized higher approver.

Approval is a durable entity in the application model and a durable wait in workflow execution.

The approval record captures at least:

- approval request ID
- run or attention item ID
- effective user
- requested approver
- current assigned approver
- immutable action or workflow payload under review
- policy reason for requiring approval
- allowed decision types
- created and resolved timestamps
- decision
- reviewer identity
- optional reviewer reason
- routing history

Executable approval decisions are `approve` or `reject` only. Editing material parameters creates a revised proposal and a new approval instead of mutating the payload that policy already evaluated.

Approval binds to the complete plan, not to individual tool calls. Scenario B therefore approves its reallocation-and-notification plan as one immutable unit.

`DurableDeferred` is the workflow suspension primitive for the external approval decision. The CLI submits a decision through the approval service; it is not a process-local prompt hidden inside the workflow.

### Backup routing

Backup routing is policy-driven, not model-driven.

At the end-of-day deadline, if an approval remains unresolved and the current approver's calendar says they are out of office the following day, policy reassigns the pending approval to the designated backup. The reassignment does not change the reviewed plan or silently create a new approval; it changes the assigned reviewer and appends a routing event.

The canonical Scenario A run demonstrates direct approval. A dedicated failure/edge run demonstrates unanswered approval, next-day out-of-office detection, and routing to the backup approver.

### Follow-up scheduling

Use `DurableClock` for durable waits owned by an in-flight workflow when that is the natural representation.

The arrival check is also represented in the harness's scheduled-work/audit model so an operator can inspect why the work exists and what business object it refers to. Advancing the demo clock must make the Tuesday follow-up visibly fire and re-enter the attention loop when the shipment is still missing.

### Audit and evidence snapshots

Keep business audit and runtime telemetry separate.

The append-only SQLite audit ledger is the business source of truth for reconstructing what the agent saw, what it concluded, what policy allowed, who approved, which workflow/activity/tool ran, why it ran, and what happened in the target system.

Material provider reads are recorded as schema-encoded evidence snapshots in addition to source IDs. This avoids an audit trail whose meaning changes when the fake ERP, mail, or calendar record is later mutated.

Each meaningful audit event carries correlation identifiers such as run ID and trace ID plus actor, effective user, event type, timestamp, evidence, rationale, policy or permission result, approval reference, workflow/activity/tool reference, and outcome.

Export the recorded Scenario A audit as NDJSON.

Runtime telemetry uses Effect structured logs, spans, annotations, and metrics. No external OTLP backend is required.

## References considered

- Effect v4 `effect/unstable/workflow` source and its `Workflow`, `Activity`, `DurableDeferred`, `DurableClock`, and SQL-backed single-runner implementation
- Dillon Mulroy, `@effect/workflows: Comprehensive Technical Overview`
- Vercel Workflow's durable orchestration / persisted-step ergonomics
- human-in-the-loop durable wait patterns from established workflow and agent systems

## Consequences

The implementation demonstrates a deterministic workflow without spending challenge time rebuilding durability primitives already available in the chosen ecosystem.

A killed process can be relaunched against the same SQLite database and replay the workflow while receiving persisted activity results instead of repeating completed writes.

The harness still visibly owns the important enterprise concerns: workflow version contract, tool catalog, authorization, policy, approval semantics, evidence, audit, model boundary, and business workflow definition.