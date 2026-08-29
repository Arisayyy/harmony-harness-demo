# Submission reviewer guide

## Thesis

This repo demonstrates an enterprise agent harness where AI is allowed to interpret enterprise events immediately without being trusted as the authorization or execution engine.

The shortest evaluation path is now four boundaries plus one failure proof:

1. **Event/triage boundary:** `src/harness/events/runtime/mail-ingress.ts` + `src/integrations/openrouter/openrouter-mail-triage.ts`
   - every inbound email is analyzed immediately;
   - AI can only ignore it or select an installed route;
   - routed mail can start the appropriate domain agent without polling.
2. **Agent/model boundary:** `src/harness/agent/execution/agent-harness.ts` + `src/integrations/openrouter/openrouter-planner.ts`
   - generic harness resolves context through a catalog rather than importing purchasing/quality;
   - planner emits a structured recommendation only;
   - no callable enterprise tools and evidence IDs are validated after generation.
3. **Safety boundary:** `src/harness/authorization/policy/gate.ts`, `src/harness/authorization/policy/policy-engine.ts`, and `src/harness/tools/runtime/tool-runtime.ts`
   - generic gate + composed business policy rules;
   - supplier/PO/scopes/monetary authority are deterministic;
   - write scopes are rechecked at execution time and side effects are idempotent/auditable.
4. **Durability boundary:** `src/domain/purchasing/workflows/reroute-purchase-order.ts`
   - six fixed durable activities;
   - critical business invariants repeated inside the workflow;
   - compensations and persisted workflow identity.
5. **Failure proof:** `src/scenarios/failures/crash-resume.ts` + `test/harness.integration.test.ts`
   - the worker receives real `SIGKILL` after PO creation;
   - a separate Bun process resumes from the same durable state;
   - duplicate PO creation is rejected by the test.

## One-command experience

With an OpenRouter API key:

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run demo
```

Scenario A first receives an irrelevant email and demonstrates immediate AI triage with no domain agent. The supplier-delay email then arrives, is AI-routed to `purchasing.supply-risk`, deterministically validated against ERP/production state, and immediately launches the full agent planning path. There is no purchasing polling step.

The demo continues through durable approval, the fixed reroute workflow, backup approver routing, Tuesday scheduled re-entry, Scenario B, runtime permission revocation, and the process-crash fixture.

For a no-secret deterministic reviewer run:

```bash
HARMONY_PLANNER=fixture bun run demo
```

The fixture environment replaces both AI boundaries—the mail triage model and planner—while preserving the same `MailIngress`, catalogs, policy, approval, workflow, tool, persistence, and audit code.

## Automated validation

```bash
bun run check
```

GitHub Actions is the executable submission proof. It uses Bun 1.4.0, a frozen lockfile, strict TypeScript, Bun-native integration tests, the complete deterministic demo, and Scenario A artifact generation.

The integration suite covers eight core properties:

- every inbound email crosses triage; irrelevant mail starts no agent while supplier-delay mail immediately starts the purchasing agent;
- redelivered mail/durable attention are deduplicated;
- unapproved suppliers are rejected;
- a no-op reroute to the incumbent supplier is rejected;
- revoked execution-time scope blocks a write;
- unanswered approval routes to the configured backup when the primary is OOO;
- workflow replay is idempotent while a new run gets distinct workflow identity;
- real process death resumes without duplicate PO creation.

## Recorded Scenario A

`artifacts/scenario-a.recorded.ndjson` is generated from the deterministic CI environment. The current exporter records both the `mail:M-001` ingress identity and the spawned agent run, so the trace can contain:

- `mail.received`;
- `mail.triaged`;
- `mail.routed`;
- ERP/mail/calendar evidence snapshots;
- recommendation of approved alternate `S-Z` instead of original supplier `S-Y`;
- deterministic policy result and immutable plan hash;
- durable human approval;
- individual tool operations with idempotency keys;
- `purchasing.reroute-po@1` completion.

The CI environment uses deterministic AI fixtures so no model secret is stored. Live OpenRouter runs traverse the same kernel with the configured models identified in audit/model metadata.

## Reusable harness vs demo environment

The RealTruck/SQLite setup is now explicitly an environment under `src/environments/demo/`.

`AgentHarness` does not import the purchasing or quality context implementations or purchasing workflow. Domain selection is provided through `ContextResolverCatalog`, `MailRouteCatalog`, `RecommendationExecutor`, `PolicyEngine`, and `ToolCatalog`. The generic `Gate` no longer imports ERP or contains purchasing rules.

A real mail connector can therefore use Microsoft Graph/Gmail webhook events to call `MailIngress.received`; a real ERP adapter can replace SQLite; and a private model can replace OpenRouter triage/planning without editing the generic harness kernel.

## What is intentionally deterministic

AI is used for semantic mail routing and evidence-backed intent selection. The following remain deterministic:

- installed route validation;
- domain checks before actionable attention is created;
- read/write permission enforcement;
- original PO and true alternate-supplier checks;
- supplier qualification and price lookup;
- monetary approval threshold and reviewer assignment;
- plan hashing and stale approval rejection;
- workflow ordering;
- tool idempotency;
- compensation;
- scheduled follow-up persistence;
- audit persistence.

## Engineering depth

The repository includes seven ADRs, including ADR 0007 for event-driven AI ingress and capability composition; a full design document; separate model/triage notes; deterministic planner benchmark/replay; SQL-backed Effect Workflow durability; explicit live vs deterministic demo environments; and Bun-native integration tests.

`docs/DESIGN.md` also addresses identity/authentication, long-term memory, scaling to thousands of employees—including the implications of AI-triaging every incoming email—and how a graph-first deterministic workflow engine would differ from this code-first Effect Workflow implementation.