# Harmony Harness Demo

A durable, policy-gated enterprise agent harness built with **Effect 4**, **Bun**, **SQLite**, **Effect Workflow**, and **OpenRouter**.

The demo is intentionally not a chat wrapper around tools. It models the harder part of enterprise agents: detecting an operational issue from disconnected systems, collecting evidence under the user's permissions, asking an LLM for a bounded recommendation, enforcing deterministic policy in code, obtaining durable human approval, executing through idempotent tool boundaries, surviving a process crash, and leaving an auditable record of what happened and why.

[![CI](https://github.com/Arisayyy/harmony-harness-demo/actions/workflows/ci.yml/badge.svg?branch=architecture%2Fharness-foundation)](https://github.com/Arisayyy/harmony-harness-demo/actions/workflows/ci.yml)

## Reviewer quick path

If you have five minutes, read these files in order:

1. `src/harness/agent/execution/agent-harness.ts` — the proposal/approval/execution boundary.
2. `src/harness/authorization/policy/gate.ts` — deterministic policy and approval routing.
3. `src/harness/tools/runtime/tool-runtime.ts` — runtime scope checks and write idempotency.
4. `src/domain/purchasing/workflows/reroute-purchase-order.ts` — the durable six-step workflow and compensation.
5. `test/harness.integration.test.ts` — the executable safety and restart claims.
6. `docs/DESIGN.md` — the complete design rationale.
7. `MODEL.md` — model, prompt, evaluation, and reproducibility notes.

The latest submission validation on commit `da7c2e0` passed install, strict TypeScript, and all five Bun-native integration tests, including a real `SIGKILL` followed by workflow replay in a fresh process: https://github.com/Arisayyy/harmony-harness-demo/actions/runs/33222366304

## What the demo shows

### Scenario A — supplier delay → durable PO reroute

The synthetic plant is RealTruck Guadalajara. A supplier email says `PO-77812` for part `RT-4471` will arrive too late for production order `4812`.

The harness:

- detects the new supply risk without a user prompt;
- deduplicates repeated detector scans;
- gathers ERP + mail evidence using the effective user's read scopes;
- gives the LLM only typed evidence snapshots and asks for a recommendation, never direct execution;
- rejects the intentionally tempting cheap but unapproved supplier `S-Q` in deterministic policy;
- routes the replacement PO through a plan-level human approval;
- executes the fixed `purchasing.reroute-po@1` workflow;
- rechecks write scopes again at every tool invocation;
- creates the replacement PO idempotently, cancels the old PO, notifies production, and schedules a Tuesday follow-up;
- persists a complete audit trail and evidence snapshot.

The workflow is deliberately killed immediately after durable step 03 in a separate fixture. A fresh Bun process opens the same SQLite state and resumes without creating a second replacement PO.

### Scenario B — quality hold → bounded free-form actions

A quality hold lands on a lot allocated to an upcoming production order. The planner may choose only the small action vocabulary exposed in its schema: reallocate a good lot and notify production, or flag a shortage when no valid lot covers demand. This demonstrates that the harness can support both a high-risk deterministic workflow and a lower-risk bounded action path without giving the model arbitrary tool access.

## Architecture

```text
ERP / Mail / Calendar
        │
        ▼
 scoped provider adapters        ← read authorization is enforced here
        │
        ▼
    detectors ── dedupe ──► durable attention items
        │
        ▼
 context gatherer ──► immutable evidence snapshots
        │
        ▼
 OpenRouter planner              ← recommendation only; evidence IDs only
        │
        ▼
 deterministic policy gate       ← scopes, supplier approval, value limits
        │
        ▼
 durable approval workflow       ← plan hash + approver identity
        │
        ▼
 agent run snapshot              ← recommendation/evidence/gate persisted
        │
        ├──── high-risk ──► Effect Workflow
        │                    │
        └──── bounded ────► action sequence
                             │
                             ▼
                        ToolRuntime
                   scope recheck + idempotency
                             │
                             ▼
                       enterprise writes

Every meaningful transition ───────────────► append-only audit log
```

The important boundary is **planner vs. executor**. The LLM cannot directly call enterprise tools. It emits one of three typed intents:

- `NoAction`
- `EnterWorkflow` for the versioned purchasing workflow
- `ProposedActions` from a small schema-defined action set

Policy and authorization are code, not prompt instructions.

## Run it

### Requirements

- Bun 1.4.x
- an OpenRouter API key for the live planner

```bash
cp .env.example .env
# set OPENROUTER_API_KEY in .env
bun install
bun run check
bun run demo
```

Default configuration:

```text
DATABASE_PATH=.data/harmony.db
OPENROUTER_MODEL=z-ai/glm-5.3-flash
```

`bun run demo` resets only the synthetic demo dataset, then narrates Scenario A, the approval, the deterministic reroute, backup-approver routing, the Tuesday follow-up, Scenario B, a revoked-scope write denial, and the independent process-crash fixture. Scenario A's audit is exported to `artifacts/scenario-a.ndjson`.

Useful operator commands are also available:

```bash
bun run src/cli/main.ts approval show <approval-id>
bun run src/cli/main.ts approval approve <approval-id> <reviewer-id>
bun run src/cli/main.ts approval reject <approval-id> <reviewer-id>
bun run src/cli/main.ts run resume <run-id>
bun run src/cli/main.ts audit export <run-id> <path>
bun run src/cli/main.ts clock advance <iso-instant>
```

## Validation

The test suite runs under Bun so it exercises the same `bun:sqlite` implementation as the application.

```bash
bun run typecheck
bun run test
```

The integration suite proves five properties:

| Property | What is asserted |
| --- | --- |
| Trigger dedupe | the same durable attention key cannot be inserted twice |
| Supplier policy | an unapproved supplier is rejected before any write |
| Runtime authorization | revoking `erp:po:create` blocks the write at `ToolRuntime`, even after a plan exists |
| Workflow identity | replaying the same agent run returns the same result; a new run receives a distinct workflow execution |
| Crash durability | a child process is really killed with `SIGKILL`, a fresh process resumes the workflow, and no duplicate replacement PO is created |

CI uses the same commands on Ubuntu with Bun 1.4.0.

## Evaluation

The LLM path has a small deterministic benchmark rather than relying on a single demo prompt.

```bash
bun run benchmark          # five cases × three live repetitions
bun run benchmark:replay   # re-score stored outputs without another model call
```

The five fixtures cover the happy-path reroute, irrelevant-mail no-op behavior, resistance to an unapproved cheap supplier, quality-lot reallocation, and quality shortage. Scoring checks the recommendation variant, workflow/action selection, required evidence references, and forbidden values. Live runs also persist latency, input/output tokens, model name, planner version, and an estimated cost. See `MODEL.md` and `src/harness/evaluation/`.

## Repository layout

```text
src/
  app/                    composition-facing catalogs
  cli/                    reviewer/operator surface
  domain/
    purchasing/           purchasing models, detectors, tools, durable workflow
    quality/              quality models, detector, bounded tools
  harness/
    agent/                attention, execution, planner contract
    approvals/            durable approval state and backup routing
    audit/                evidence + append-only event trail + export
    authorization/        principals, scopes, deterministic policy
    evaluation/           benchmark fixtures, scoring, reporting
    memory/               durable agent-run records
    scheduling/           virtual business clock + follow-up work
    tools/                catalog + runtime authorization/idempotency
    workflows/            generic workflow runtime/versioning support
  infra/
    config/               Effect Config
    database/             SQLite client, schema migration, seed/reset
    runtime/              full Effect Layer composition
    workflow/             SQL-backed Effect Workflow engine
  integrations/
    erp/                  permission-aware fake ERP adapter
    mail/                 permission-aware fake mail adapter
    calendar/             permission-aware fake calendar adapter
    openrouter/           Effect AI OpenRouter client + planner
  scenarios/              narrated demo events and crash fixture

test/                     Bun-native integration suite
docs/decisions/           ADRs from the architecture grill
docs/DESIGN.md            submission design document
MODEL.md                   model/evaluation disclosure
```

The extra depth under `harness/` is intentional: generic harness concerns have ownership instead of becoming a single utility folder. Domain workflows remain in their domain; infrastructure is kept out of both.

## Safety invariants

The implementation is built around a few invariants that are easy to inspect in code:

- **No model-to-tool path.** The model emits a typed recommendation only.
- **Read permissions are enforced before data reaches the planner.** ERP/mail/calendar adapters reject unauthorized reads.
- **Write permissions are checked twice.** The policy gate checks the proposed plan; `ToolRuntime` checks the current principal again immediately before execution.
- **Approvals bind to an immutable plan hash.** Execution recomputes policy and refuses stale or differently-routed approval.
- **Writes are idempotent outside the workflow engine too.** `tool_idempotency` protects side effects from retries/replay.
- **Workflow identity includes the durable agent run.** A clean new demo run cannot accidentally replay an older completed execution.
- **Evidence is snapshotted.** Audit records preserve what the agent observed when it made the recommendation.
- **The failure proof uses a real process death.** It is not an exception pretending to be a restart.

## Deliberate tradeoffs

This is a compact submission, not a production ERP integration. The enterprise systems are separate provider interfaces over one local SQLite fixture so the demo is portable and deterministic. In production, each adapter would use the real system's delegated auth and API. SQLite is also the workflow persistence substrate here; the boundaries allow a production SQL service to replace it without changing planner/policy/domain code.

The model is intentionally used for ambiguous interpretation and recommendation, while authorization, monetary limits, supplier qualification, approval routing, idempotency, and workflow order remain deterministic. That split is the central design choice of the project.

For the longer rationale, threat model, failure semantics, and production path, see `docs/DESIGN.md`.
