# ADR 0002: Effect-native runtime and data layer

- Status: Accepted
- Date: 2026-08-28

## Context

The implementation should be intentionally Effect-native rather than conventional Promise-based TypeScript with Effect used only for dependency injection or error wrapping.

Effect v4 is the target even though it is still beta. The repository should make that choice obvious and use the library deeply enough that the architecture benefits from its model.

## Decisions

### Effect v4

Use the Effect v4 beta line and pin compatible Effect ecosystem packages to the same version.

Prefer Effect abstractions whenever they meaningfully model the problem:

- `Effect` for application logic and side effects
- `Context.Service` and `Layer` for service boundaries and wiring
- `Schema` for domain values, external inputs, persisted payloads, tool inputs, planner outputs, and audit payloads
- typed failures instead of thrown application errors
- `Schedule` for retry and repeat policies
- fibers and structured concurrency where work is genuinely concurrent
- Effect time abstractions and durable workflow clocks for deterministic and deferred work
- scoped resources for database and runtime lifecycle
- structured logging, spans, annotations, and metrics for observability
- `effect/unstable/cli` for the CLI surface
- `effect/unstable/process` where process control is part of the restart demo
- `@effect/vitest` for Effect-native tests

Ordinary Promise-based TypeScript is the exception rather than the default. Do not introduce a non-Effect abstraction when Effect already models the problem cleanly.

### Services

Use Effect v4 `Context.Service` boundaries with explicit Layers.

Providers, repositories, policy, approvals, planner, workflow coordination, audit, telemetry, clock, and model access should be replaceable through the Effect environment rather than a hand-built dependency-injection container.

### SQLite

Use one SQLite database for the demo.

Use `@effect/sql-sqlite-bun`, backed by Bun's `bun:sqlite`, instead of reaching for `bun:sqlite` directly throughout the application.

Do not add an ORM.

Repository modules own application SQL and expose typed Effect programs. Effect Workflow's SQL-backed single-runner infrastructure may use the same SQLite database for durable workflow mailbox and reply state while remaining logically separate from application tables.

The application tables hold fake ERP, mail, calendar, users and scopes, attention items, approvals, benchmark runs, and the append-only audit ledger.

Fake ERP, Mail, and Calendar expose distinct provider services even though they share a physical SQLite database. The harness must not know or depend on that implementation detail.

### Authorization at boundaries

Read filtering is enforced inside each provider. A caller cannot ask a provider for data outside the effective user's read scopes and receive it for later filtering.

Write scopes are enforced inside tools even when a plan has already passed the gate. The gate provides policy authorization; the tool boundary provides defense in depth.

Keep the permission model intentionally small: explicit per-system scopes plus, if useful, one restrained resource-level constraint to demonstrate where a real deployment would extend the model.

### OpenRouter and Effect AI

Use OpenRouter through Effect's AI integration rather than a hand-written fetch client unless a concrete provider incompatibility forces a fallback.

The model is configurable through environment configuration. The default model is `z-ai/glm-5.3-flash` because the challenge benefits more from inexpensive repeatable planner calls than from maximizing model cost.

Model output must cross a `Schema`-validated boundary before it can influence a gate, workflow, or tool.

The application must remain testable and able to exercise deterministic failure cases without a network call.

## Consequences

This repository will look more Effect-heavy than ordinary TypeScript code by design. Reviewers should be able to see typed environments, failures, validation, durable execution, scheduling, concurrency, resource ownership, CLI composition, and tracing as one coherent runtime model rather than separate libraries glued together.

Because Effect v4 and several selected modules are beta or unstable, dependency versions are pinned. The README and design doc must state that production adoption would require an explicit upgrade and compatibility policy.