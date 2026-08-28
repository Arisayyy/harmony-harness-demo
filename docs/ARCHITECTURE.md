# Architecture

## Purpose

Harmony Harness Demo is organized so that planning, architectural decisions, and implementation stay traceable instead of becoming invisible chat history.

## Documentation-first decision flow

instructions.md is the repository entry point. It tells contributors where the operating conventions live.

skills/grill-with-docs/SKILL.md is the discovery and design gate for non-trivial work. It drives questions from outcomes and constraints to a bounded implementation decision.

CONTEXT.md is the living record for the active problem: scope, constraints, unanswered questions, and the accepted boundary. Create it when a substantial change begins.

docs/adr/ stores immutable Architecture Decision Records. Add an ADR whenever a choice changes a system boundary, data ownership, dependency, integration contract, security posture, or operational model.

## Change lifecycle

1. Frame the outcome and success criteria.
2. Inspect existing code and documentation.
3. Run Grill With Docs to resolve dependent decisions.
4. Record current context and consequential ADRs.
5. Implement the smallest coherent change.
6. Test the happy path, failure path, and rollback or migration path.
7. Refresh this document if the system boundary or request flow changed.

## Decision quality bar

Every non-trivial change should identify its owner, inputs and outputs, dependencies, failure behavior, observability, and rollback strategy. A decision is not complete until another engineer can understand why it exists without reopening the original conversation.