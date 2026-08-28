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
- Effect clocks and time abstractions so the demo clock can be deterministic
- scoped resources for database and runtime lifecycle
- structured logging, spans, annotations, and metrics for observability
- Effect test utilities where they improve deterministic tests

Do not force a functional abstraction where it makes the code less legible, but treat ordinary Promise-based TypeScript as the exception rather than the default.

### Services

Use Effect v4 `Context.Service` boundaries with explicit Layers.

Providers, repositories, policy, approvals, planner, workflow runtime, scheduler, audit, telemetry, clock, and model access should be replaceable through the Effect environment rather than a hand-built dependency-injection container.

### SQLite

Use one SQLite database for the demo.

Use `@effect/sql-sqlite-bun`, which is backed by Bun's `bun:sqlite`, instead of reaching for `bun:sqlite` directly throughout the application. This preserves the accepted choice of Bun + SQLite while keeping database work inside the Effect ecosystem.

Do not add an ORM.

Repository modules own SQL and expose typed Effect programs to the rest of the application.

The database holds the fake enterprise systems and harness durability state, including ERP data, mail, calendar, users and scopes, attention items, approvals, workflow instances, step state, scheduled work, idempotency records, and append-only audit events.

Fake ERP, Mail, and Calendar still expose distinct provider services even though they share a physical SQLite database. The harness must not know or depend on that implementation detail.

### Authorization at boundaries

Read filtering is enforced inside each provider. A caller cannot ask a provider for data outside the effective user's read scopes and receive it for later filtering.

Write scopes are enforced inside tools even when the plan has already passed the gate. The gate provides policy authorization; the tool boundary provides defense in depth.

Keep the permission model intentionally small: explicit per-system scopes plus, if useful, one restrained resource-level constraint to demonstrate where real deployments would extend the model.

### OpenRouter and Effect AI

Use OpenRouter through Effect's OpenRouter integration rather than a hand-written fetch client unless a concrete provider incompatibility forces a fallback.

The model is configurable through environment configuration, with GLM 5.3 Flash as the default target because it is inexpensive and supports agent-oriented workloads. Model output must cross a Schema-validated boundary before it can influence a gate, workflow, or tool.

The application must remain functional enough for tests and deterministic failure cases without making network calls.

## Consequences

This repository will look more Effect-heavy than ordinary TypeScript code by design. Reviewers should be able to see typed environments, failures, validation, scheduling, concurrency, resource ownership, and tracing as one coherent runtime model rather than separate libraries glued together.

Because Effect v4 is beta, dependency versions should be pinned and the README should state that production adoption would require an upgrade policy and compatibility testing.