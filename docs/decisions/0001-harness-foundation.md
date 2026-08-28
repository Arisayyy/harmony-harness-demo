# ADR 0001: Harness foundation

- Status: Accepted
- Date: 2026-08-28

## Context

This repository is a three-day implementation challenge for an extendable enterprise agent harness. The submission should optimize for a small, credible system whose behavior can be defended under review rather than for feature breadth.

The near-term goal is to submit a strong challenge implementation while keeping the architecture credible for a RealTruck deployment in Guadalajara. That makes implementation speed important, but not at the expense of clear system boundaries or durable behavior.

## Decisions

### Runtime and application shape

Use Bun for the CLI application and runtime.

Build a single-process modular monolith. Do not introduce microservices or a workspace split unless the code later demonstrates a concrete need for one.

The repository should be domain-first rather than challenge-bullet-first. Purchasing and quality are visible business capabilities. Harness primitives remain separately replaceable, but the folder tree should not become a directory-per-requirement exercise.

### Repository style

Prefer small cohesive files, explicit imports, boring names, and strong schemas.

Avoid generic dumping grounds such as `utils.ts`, `helpers.ts`, and catch-all `types.ts` files. Avoid giant barrel files and unnecessary factories, managers, or dependency-container abstractions.

Do not add comments unless they explain something that the code cannot make obvious. When a comment is required, keep it short and written like a human engineer.

### Agent authority

The model proposes intent and parameters. It never receives direct authority to perform side effects.

For Scenario A, the free-form planner may decide that a purchase-order reroute is appropriate and provide validated workflow parameters. Once the workflow is entered, the deterministic workflow definition owns ordering and execution.

Scenario B intentionally exercises the bounded free-form tool path so both execution modes remain real.

### Enterprise model

Model the demo organization as `RealTruck` and place the modeled operation in Guadalajara, Mexico.

People, suppliers, parts, messages, production lines, and noise records created for the challenge are synthetic demo data. They should read like restrained enterprise data rather than synthetic filler and should not be presented as facts about RealTruck's actual systems or employees.

### CLI experience

The primary demo is automatic and guided. It should visibly stage events such as an incoming supplier email, detector execution, recommendation, gate, approval, workflow execution, clock advancement, follow-up, Scenario B, and failure cases.

The CLI should still expose useful operator controls where they improve the demo, including inspection and approval controls.

The visual language is sober: no ASCII branding, gradients, emoji-heavy status output, or hackathon styling. Prefer timestamps, run IDs, trace IDs, concise sections, and clear human-facing approval text.

### Scope cuts

Intentionally do not build a UI, production HTTP API, real ERP or Microsoft Graph connectors, distributed queues, vector memory, multi-tenant IAM, generic DAG orchestration, or production deployment.

Spend that time on the required harness behavior, deterministic workflow execution, durable state, auditability, permissions, approvals, restart safety, Scenario B, and meaningful failure cases.

The README must name these cuts and explain that they were deliberate choices under the challenge time box.

## Consequences

The codebase should remain small enough to understand in one review session while exposing clear seams for providers, tools, detectors, policy, planner, workflows, persistence, scheduling, audit, and telemetry.

A future production version can split these seams into processes or services without forcing the challenge implementation to pretend that distribution is free.