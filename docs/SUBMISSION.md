# Submission reviewer guide

## Thesis

This repo demonstrates an enterprise agent harness where the LLM is allowed to be useful without being trusted as the authorization or execution engine.

The shortest way to evaluate that claim is to inspect three boundaries and one failure proof:

1. **Model boundary:** `src/integrations/openrouter/openrouter-planner.ts`
   - structured recommendation only;
   - no callable enterprise tools;
   - evidence-ID validation after generation.
2. **Safety boundary:** `src/harness/authorization/policy/gate.ts` and `src/harness/tools/runtime/tool-runtime.ts`
   - supplier qualification, scopes, monetary approval, plan hash;
   - write scopes rechecked at execution time;
   - side effects persisted under idempotency keys.
3. **Durability boundary:** `src/domain/purchasing/workflows/reroute-purchase-order.ts`
   - six named durable activities;
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
bun install
bun run demo
```

The demo narrates two distinct agent behaviors: a fixed high-risk purchasing workflow and bounded free-form quality actions. It also includes approval routing, future scheduled re-entry, runtime permission revocation, and the process crash fixture.

## Automated validation

No external model secret is needed to verify the safety kernel:

```bash
bun run check
```

Submission CI proof: https://github.com/Arisayyy/harmony-harness-demo/actions/runs/33222366304

At commit `da7c2e0`, GitHub Actions on Ubuntu/Bun 1.4.0 passed dependency install, `tsc --noEmit`, and all five integration tests.

## What is intentionally deterministic

The model is not asked to reproduce business code. These are deterministic:

- read/write permission enforcement;
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

The repository includes six ADRs capturing the architecture decisions, a full design document, model/evaluation notes, a deterministic benchmark/replay harness, a strict Effect Layer composition, a SQL-backed workflow engine, and a native Bun integration suite. These are not separate presentation-only artifacts; each one corresponds to a code path exercised by the demo or validation suite.
