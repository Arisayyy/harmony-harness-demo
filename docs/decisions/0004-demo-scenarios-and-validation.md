# ADR 0004: Demo flow, Scenario B, and failure validation

- Status: Accepted
- Date: 2026-08-28

## Context

The challenge is judged both as software and as a recorded demonstration. The demo should make durable behavior and safety boundaries visible without requiring a reviewer to manually assemble the story.

Scenario B should prove extension points rather than force edits to the harness core.

## Decisions

### One-command demo

The repository will expose one documented command that runs the complete challenge story.

The default run is automatic and guided. It should stage events in a way a reviewer can follow, including a short visible countdown before simulated external events such as the supplier email arrive.

The demo should present, in order:

1. initial RealTruck Guadalajara state
2. detector activity
3. supplier-delay email arrival
4. cross-provider context gathering
5. model recommendation
6. permission and policy gate
7. approval lifecycle
8. deterministic PO-reroute workflow
9. clock advancement to the scheduled arrival check
10. Tuesday follow-up firing and re-checking shipment state
11. Scenario B
12. selected failure cases
13. concise audit summary and location of the recorded NDJSON run

The automatic path may submit deterministic decisions so the full story completes unattended, but the CLI should also expose operator commands for inspecting runs, approvals, audit events, scheduled work, and workflow state.

### Scenario B as an extension proof

Scenario B adds quality and lot data, a detector, the required provider capability, at least one tool for lot reallocation, and a quality manager with a different scope set.

The planner, gate, audit layer, scheduler, and generic execution kernel should not require Scenario-B-specific edits.

If one of those core modules does need a change, the design documentation must call it out and explain whether that indicates a missing abstraction or a legitimate generalization.

### Failure cases

Prioritize a small group of failures that demonstrate the harness properties instead of a large synthetic test matrix.

The preferred cases are:

- duplicate detector input is deduplicated
- the alternate supplier becomes invalid between proposal and execution
- write permission is removed before execution and the tool boundary refuses the action
- the process is killed after replacement PO creation and resumes without creating a duplicate PO
- a later deterministic workflow step fails and compensation executes
- an unanswered approval routes to the designated backup according to calendar policy
- the Tuesday follow-up observes that the shipment is still missing and re-enters the attention loop

The final implementation may select four or five of these for the narrated demo while retaining focused automated tests for the required gate, trigger dedupe, and workflow resumption behavior.

### Tests

Use Effect-aware test utilities and deterministic services where possible.

At minimum, tests must cover:

- permission and policy gating
- detector or trigger deduplication
- persisted workflow resumption after interruption

Additional high-value tests should cover approval routing, tool-level scope enforcement, compensation, and deferred follow-up.

### Recorded run

Scenario A must emit a stable recorded run artifact containing the approval request, decision, workflow execution, and audit trail.

Prefer NDJSON because it is append-friendly, diffable, scriptable, and maps directly to the append-only audit model.

## Consequences

The demo acts as an executable architecture tour rather than a collection of isolated scripts.

Scenario B and the failure suite become evidence for replaceability and durability claims made in the README and design doc.