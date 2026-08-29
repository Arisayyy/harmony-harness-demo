# Model and evaluation notes

## Planner boundary

The harness uses OpenRouter through Effect AI. The default model is:

```text
z-ai/glm-5.3-flash
```

It is configurable with `OPENROUTER_MODEL`; the API key is loaded as an Effect `Redacted` value from `OPENROUTER_API_KEY`.

The planner implementation lives in `src/integrations/openrouter/openrouter-planner.ts`. Its contract is `Planner`, not a tool executor. It receives only:

- the attention kind;
- the detector's attention payload;
- permission-filtered `EvidenceSnapshot` values.

It returns a schema-validated `Recommendation`:

- `NoAction`;
- `EnterWorkflow` for `purchasing.reroute-po`;
- `ProposedActions` using the explicitly enumerated quality/production/purchasing action schema.

The planner never receives a callable ERP, mail, calendar, approval, or tool object. There is therefore no direct model-to-side-effect capability to prompt-inject around.

## Prompt strategy

`planner/v1` uses a short system instruction. Its job is to constrain interpretation, not to encode security policy. The important instructions are:

- propose intent only;
- never execute or invent permissions;
- use the fixed purchasing workflow for supply risk;
- use the small bounded action vocabulary for quality holds;
- never cite evidence that is not in the supplied snapshots;
- use snapshot `sourceId` values verbatim.

The request uses structured generation against the Effect Schema for `Recommendation`. Temperature is fixed at `0`.

After generation the harness independently validates every `evidenceRef` against the supplied evidence set. Unknown references fail the planner call. The model therefore cannot create a fabricated evidence identifier and have it silently enter the audit trail.

Security rules deliberately do **not** depend on the prompt. The model can still make a bad recommendation; the deterministic gate must reject it.

## Why evidence references instead of copied evidence

The LLM returns evidence IDs, not copies of ERP/email/calendar payloads. Full snapshots are already durable in the run/audit layer. This has three benefits:

1. the recommendation cannot subtly rewrite an observed fact;
2. plan hashes remain small and stable;
3. evaluation can score grounding independently from prose quality.

## Deterministic guardrails after the model

For the purchasing path the gate verifies, in code:

- required write scopes;
- the alternate supplier exists;
- supplier approval covers the exact part;
- an approved price exists;
- replacement PO value against the effective user's monetary authority;
- the correct approver when the value exceeds that authority.

At execution time `ToolRuntime` repeats the current scope check. This is important because permissions can be revoked between recommendation/approval and execution.

The approval is bound to a SHA-256 hash of the typed recommendation. Before execution, policy is evaluated again and both the plan hash and currently required reviewer must still match the durable approval.

## Benchmark

`src/harness/evaluation/cases/benchmark-cases.ts` contains five versioned fixtures:

| Case | Expected behavior |
| --- | --- |
| `purchasing-delay-reroute` | enter `purchasing.reroute-po` with the required supply/e-mail evidence |
| `irrelevant-email-no-action` | refuse to invent a business action from unrelated mail |
| `unapproved-supplier-is-forbidden` | choose the approved supplier and never emit the tempting `S-Q` supplier |
| `quality-hold-reallocate` | propose lot reallocation + production notification |
| `quality-hold-shortage` | flag shortage when the good lot cannot cover demand |

A live benchmark performs three repetitions per case. Each run stores:

- fixture version;
- model;
- planner version;
- structured output + score;
- latency;
- input/output token counts when reported;
- estimated model cost under the estimator constants in the runner;
- creation time.

The scorer is deterministic and checks recommendation type, workflow/action tags, required evidence IDs, and explicitly forbidden strings. It does not grade prose style.

```bash
bun run benchmark
bun run benchmark:replay
```

`benchmark:replay` performs no model calls. It decodes stored recommendations with the current schema and applies the current scorer. This makes changes to scoring auditable separately from changes to model output.

## Reproducibility

Exact bit-for-bit LLM output is not promised. Reproducibility here means:

- fixed typed fixture inputs;
- fixed planner version;
- temperature `0`;
- model name captured per run;
- structured output schema;
- three repetitions to expose instability;
- stored outputs that can be rescored offline;
- deterministic policy/execution after the recommendation.

For submission validation, CI intentionally does not require an external model secret. It validates the deterministic harness, authorization, idempotency, workflow replay, and real crash recovery. Live model behavior is exercised with `bun run benchmark` or `bun run demo` when `OPENROUTER_API_KEY` is supplied.

## Changing models safely

A model change should be treated as a planner-version/evaluation event, not a transparent dependency bump. The recommended process is:

1. change `OPENROUTER_MODEL` or the default config;
2. run the live benchmark three times per case;
3. inspect any disagreement or forbidden-output failure;
4. keep deterministic policy unchanged unless the business rule itself changed;
5. update `plannerVersion` when the prompt/schema semantics change;
6. retain benchmark rows so the old and new planner can be compared.
