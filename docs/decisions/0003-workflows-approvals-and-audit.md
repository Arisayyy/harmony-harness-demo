# ADR 0003: Durable workflows, approvals, and audit

- Status: Proposed
- Date: 2026-08-28

## Context

Scenario A requires a deterministic purchase-order reroute workflow that survives restart, persists after every step, compensates failures, and cannot be reordered by the model.

The same harness also needs human approval, approval escalation to a backup when the primary approver is unavailable, deferred follow-up work, and an audit trail from which a reviewer can reconstruct the complete decision and execution history.

The workflow API should feel natural and compact. Vercel Workflow is a useful reference because it separates durable orchestration from atomic persisted steps while keeping definitions readable. Human-in-the-loop systems such as Trigger.dev, Inngest, Temporal, and LangGraph converge on a durable pause plus an externally supplied decision or signal rather than a process-local blocking prompt.

## Decisions already accepted

### Build the workflow runtime in this repository

Do not use Effect's experimental durable workflow module as the implementation of Part 2.

The challenge explicitly evaluates the deterministic workflow design. Hiding that design behind an existing workflow engine would make the most important architecture less visible. Effect's workflow APIs are also currently unstable.

Instead, build the small workflow runtime with Effect primitives and SQLite persistence.

Borrow the useful API qualities of Vercel Workflow without copying its compiler-directive implementation:

- workflow definitions should read in fixed execution order
- each durable step has a stable identifier
- completed step output is persisted and reused on resume
- workflow state is persisted after every step
- side effects only happen inside declared steps
- workflow definitions carry an explicit version
- the model can decide to enter a workflow and provide validated parameters, but cannot mutate the workflow graph

The required reroute remains deliberately linear. Do not build a generic DAG engine for this challenge.

### Tool and compensation ownership

Tools are typed side-effect primitives with a name, input schema, required scopes, idempotency strategy, and execution program.

Compensation belongs to the workflow step rather than globally to the tool. Undo semantics depend on business context, and the same primitive may require different compensation in different workflows.

### Approval as durable state

Approval must be modeled as a durable entity rather than as a CLI prompt embedded inside workflow execution.

The execution path creates an approval request, persists the exact proposed action or workflow intent being reviewed, records policy and permission evaluation, then transitions into a waiting state. A separate approval decision resumes execution.

The CLI is only one client of this primitive. In the automatic demo it can simulate or submit decisions, but the underlying model should map cleanly to a UI, webhook, Teams/Slack interaction, or enterprise approval service.

The approval record should capture at least:

- approval request ID
- run or attention item ID
- effective user
- requested approver
- current assigned approver
- action or workflow parameters under review
- policy reason for requiring approval
- allowed decision types
- created and resolved timestamps
- decision
- reviewer identity
- reviewer reason when supplied
- supersession or routing history

Approval must bind to the reviewed plan. A materially changed plan requires a new approval rather than reusing an old decision.

### Backup routing

Backup routing is policy-driven, not model-driven.

At the end-of-day deadline, if the approval remains unresolved and the primary approver's calendar says they are out of office the following day, policy reassigns the pending approval to the designated backup and records that routing decision in the audit log.

The exact demo path for direct approval versus forced backup escalation remains open for the next architecture round.

### Audit and telemetry

Keep business audit and runtime telemetry separate.

The append-only SQLite audit ledger is the source of truth for reconstructing what the agent saw, what it concluded, what policy allowed, who approved, which step ran, why it ran, and what happened in the target system.

Export the recorded Scenario A run as NDJSON for the deliverable.

Each meaningful audit event should carry correlation identifiers such as run ID and trace ID plus actor, effective user, event type, timestamp, evidence references, rationale, policy or permission outcome, approval reference, workflow or tool reference, and result.

Runtime telemetry should use Effect-native structured logs and spans with wide annotations. No external OTLP backend is required for the challenge demo.

## Open decisions

1. Whether the canonical Scenario A run demonstrates direct approval and leaves backup escalation to the failure suite, or deliberately drives the primary approval to timeout so the backup approves.
2. Whether an approval allows only approve/reject for executable plans or also permits edit. The current recommendation is approve/reject for deterministic workflow entry; edits should create a revised proposal and a new approval rather than mutate an approved workflow payload in place.
3. The exact workflow-definition API surface. It should feel as compact as Vercel Workflow while remaining explicit enough that persistence, idempotency, compensation, and versioning are visible during review.

## Consequences

The CLI can be automatic without making approval fake. It submits decisions to the same durable approval boundary that another external client would use.

A killed process can resume an in-flight workflow from persisted step state without repeating completed side effects.

The audit log remains readable as a business record instead of becoming an opaque dump of tracing spans.