# Submission reviewer guide

## Thesis

This repo demonstrates an enterprise agent harness where the LLM is allowed to be useful without being trusted as the authorization or execution engine.

The shortest way to evaluate that claim is to inspect three boundaries and one failure proof:

1. **Model boundary:** `src/integrations/openrouter/openrouter-planner.ts`
   - structured recommendation only;
   - no callable enterprise tools;
   - evidence-ID validation after generation.
2. **Safety boundary:** `src/harness/authorization/policy/gate.ts` and `src/harness/tools/runtime/tool-runtime.ts`
   - original-PO validation, true alternate-supplier qualification, scopes, monetary approval, plan hash;
   - write scopes rechecked at execution time;
   - side effects persisted under idempotency keys.
3. **Durability boundary:** `src/domain/purchasing/workflows/reroute-purchase-order.ts`
   - six named durable activities;
   - business invariants rechecked inside the workflow;
   - compensations;
   - workflow identity includes the durable agent run.
4. **Failure proof:** `src/scenarios/failures/crash-resume.ts` + `test/harness.integration.test.ts`
   - a worker is killed with real `SIGKILL` after PO creation;
   - a separate process resumes from SQLite;
   - duplicate PO creation is rejected by the test.

## One-command experience

With an OpenRouter API key:

```bash
cp .env.example .env
bun install --frozen-lockfile
bun run demo
```

The demo narrates two distinct agent behaviors: a fixed high-risk purchasing workflow and bounded free-form quality actions. It also includes approval routing, future scheduled re-entry, runtime permission revocation, and the process crash fixture.

For a no-secret deterministic reviewer run:

```bash
HARMONY_PLANNER=fixture bun run demo
```

## Automated validation

No external model secret is needed to verify the safety kernel:

```bash
bun run check
```

GitHub Actions is the executable submission proof. On every branch/PR update it uses Bun 1.4.0, installs from the committed lockfile with `--frozen-lockfile`, runs strict TypeScript, runs seven Bun-native integration tests, executes the full deterministic demo, and fails if the Scenario A audit artifact is not produced.

The seven regression properties cover trigger dedupe, unapproved supplier rejection, no-op incumbent-supplier reroute rejection, execution-time scope revocation, backup approver routing, workflow replay/run identity, and real process death/recovery.

## Recorded Scenario A

`artifacts/scenario-a.recorded.ndjson` is an actual output preserved from a successful CI execution. It records:

- ERP, mail, and calendar evidence snapshots;
- original PO `PO-77812` on `S-Y`;
- recommendation of approved alternate `S-Z`;
- deterministic gate result and immutable plan hash;
- durable human approval;
- `purchasing.reroute-po@1` execution completion.

The committed recording uses the deterministic CI planner so no model secret is stored. Live OpenRouter runs traverse the same harness and emit the same audit shape with the configured model recorded in the planner event.

## What is intentionally deterministic

The model is not asked to reproduce business code. These are deterministic:

- read/write permission enforcement;
- original PO and true alternate-supplier checks;
- approved-supplier checks;
- monetary approval threshold and reviewer assignment;
- plan hashing and stale approval rejection;
- workflow ordering;
- tool idempotency;
- compensation;
- scheduled follow-up persistence;
- audit event persistence.

The model is used where it adds value: interpreting mixed evidence and selecting a bounded intent.

## Evidence of engineering depth

The repository includes six ADRs capturing the architecture decisions, a full design document, model/evaluation notes, a deterministic benchmark/replay harness, a strict Effect Layer composition, a SQL-backed Effect Workflow engine, and a native Bun integration suite. These are not separate presentation-only artifacts; each one corresponds to a code path exercised by the demo or validation suite.

`docs/DESIGN.md` explicitly covers identity/authentication, long-term memory, scaling to thousands of employees, and how a graph-first deterministic workflow engine would differ from this code-first Effect Workflow implementation.
