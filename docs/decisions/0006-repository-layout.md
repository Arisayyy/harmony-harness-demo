# ADR 0006: Repository layout

- Status: Accepted
- Date: 2026-08-28

## Context

The repository should make the architecture readable from the folder tree without collapsing unrelated harness concerns into a shallow namespace or creating generic dumping grounds.

The harness is the core product surface, so it should have enough hierarchy to make ownership obvious. Infrastructure should also be explicit rather than hidden inside application or harness modules.

## Decision

Use a domain-first modular monolith with a deliberately layered harness and a dedicated infrastructure boundary.

The target shape is:

```text
src/
  app/
  cli/
  domain/
    purchasing/
      model/
      detectors/
      workflows/
      tools/
    quality/
      model/
      detectors/
      tools/
  harness/
    agent/
      context/
      planning/
      execution/
    authorization/
      permissions/
      policy/
    approvals/
      model/
      routing/
      service/
    audit/
      model/
      repository/
      export/
    evaluation/
      cases/
      scoring/
      reporting/
    memory/
      run/
      durable/
    scheduling/
      model/
      service/
    telemetry/
      tracing/
      metrics/
    tools/
      catalog/
      runtime/
    workflows/
      definition/
      runtime/
      versioning/
  integrations/
    erp/
    mail/
    calendar/
    openrouter/
  infra/
    database/
      migrations/
      repositories/
      seed/
    workflow/
    config/
    runtime/
  scenarios/
    scenario-a/
    scenario-b/
    failures/
```

This is a target ownership map, not a requirement that every directory exist before it contains meaningful code. Empty folders should not be committed just to mirror the diagram.

Business-specific workflow definitions live with the domain that owns them. Generic Effect Workflow conventions, version binding, and runtime integration live under `harness/workflows`. SQL, migrations, persistence adapters, Effect Cluster/SingleRunner wiring, and other implementation infrastructure live under `infra`.

Do not create generic `utils`, `helpers`, or catch-all `types` directories. Shared code should have a concrete owner and name.

## Consequences

A reviewer can identify business logic, harness behavior, connector boundaries, and infrastructure without reading implementation files first.

The additional harness subfolders make extension points explicit while avoiding a separate top-level package for every challenge requirement.

The `infra` boundary gives production-facing implementation details a clear home without letting them leak into domain modules.