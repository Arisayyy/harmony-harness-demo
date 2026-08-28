# ADR 0004: Demo flow, Scenario B, and failure validation

- Status: Accepted
- Date: 2026-08-28

## Context

The challenge is judged both as software and as a recorded demonstration. The demo should make durable behavior and safety boundaries visible without requiring a reviewer to manually assemble the story.

Scenario B should prove extension points rather than force edits to the harness core.

## Decisions

### One-command demo

The repository exposes one documented command that runs the complete challenge story.

The default run is automatic and guided. It stages simulated external events so the reviewer can follow causality, including a short visible countdown before the supplier-delay email arrives.

The demo presents, in order:

1. initial RealTruck Guadalajara state
2. detector activity
3. supplier-delay email arrival
4. cross-provider context gathering
5. model recommendation
6. permission and policy gate
7. durable approval request
8. direct approval in the canonical Scenario A path
9. deterministic PO-reroute workflow
10. clock advancement to the scheduled arrival check
11. Tuesday follow-up firing and re-checking shipment state
12. Scenario B
13. selected failure and edge cases
14. concise audit and benchmark summary

The automatic path submits deterministic approval decisions so the full story completes unattended. The CLI still exposes operator commands for inspecting runs, approvals, audit events, scheduled work, and workflow state and for approving or rejecting a pending plan manually.

### CLI implementation

Use Effect v4's CLI module rather than a third-party command parser.

Keep the terminal output sober and operational: timestamps, run and trace IDs, state transitions, compact tables where useful, and clear business-facing approval text. No decorative branding or hackathon styling.

### Scenario B as an extension proof

Scenario B adds quality and lot data, a detector, the required provider capability, at least one lot-reallocation tool, and a quality manager with a different scope set.

The planner, gate, audit layer, approval semantics, and generic free-form execution path should not require Scenario-B-specific edits.

If one of those core modules needs a change, the design documentation must call it out and explain whether that indicates a missing abstraction or a legitimate generalization.

### Failure cases

Prioritize a small group of failures that demonstrate real harness properties instead of a large synthetic matrix.

The preferred cases are:

- duplicate detector input is deduplicated
- the alternate supplier becomes invalid between proposal and execution
- write permission is removed before execution and the tool boundary refuses the action
- the process is killed after replacement PO creation and resumes without creating a duplicate PO
- a later deterministic workflow step fails and compensation executes
- an unanswered approval routes to the designated backup according to calendar policy
- the Tuesday follow-up observes that the shipment is still missing and re-enters the attention loop

The narrated demo may select four or five of these while focused tests cover the required invariants.

### Real restart demonstration

Do not simulate restart safety with an ordinary thrown exception alone.

For the restart case, launch workflow execution in a child Bun process, terminate that process after the replacement PO activity has durably completed, then launch a fresh process against the same SQLite database.

The second process must resume the same workflow execution, reuse the persisted completed activity, and proceed without creating a second replacement PO.

This demonstration should print the workflow execution ID and replacement PO ID before and after restart so the property is visible without reading source code.

### Approval-routing edge case

The canonical Scenario A path uses direct approval so the main story remains easy to follow.

A separate edge-case run leaves the approval unanswered through end of day, checks the current approver's next-day calendar state, observes the out-of-office event, and routes the unchanged approval request to the designated backup. The audit log records both assignment states and the policy reason for rerouting.

### Tests

Use Vitest with `@effect/vitest` and Effect-aware deterministic services.

At minimum, automated tests cover:

- permission and policy gating
- detector / trigger deduplication
- persisted workflow resumption after process interruption

Additional high-value tests cover approval routing, tool-level scope enforcement, compensation, plan-to-approval binding, and deferred follow-up.

### Recorded run

Scenario A emits a stable recorded run artifact containing the evidence snapshots, recommendation, gate, approval request and decision, workflow execution, tool outcomes, follow-up scheduling, and audit trail.

Use NDJSON because it is append-friendly, diffable, scriptable, and maps directly to the append-only audit model.

## Consequences

The demo acts as an executable architecture tour rather than a collection of isolated scripts.

The real process-kill case demonstrates that restart safety comes from durable workflow state rather than an in-memory retry trick.

Scenario B and the failure suite become concrete evidence for the replaceability and safety claims made in the README and design doc.