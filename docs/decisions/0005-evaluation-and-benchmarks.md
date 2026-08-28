# ADR 0005: Evaluation and benchmark skeleton

- Status: Proposed
- Date: 2026-08-28

## Context

The harness should be benchmarkable even though the challenge time box does not justify building a full agent-evaluation platform.

We want enough structure to answer a practical question after changing a prompt, model, provider, or context strategy: did recommendation quality get better or worse, did it stay safe, and what did the run cost?

The benchmark layer must not blur deterministic correctness with model quality. Permissions, policy, workflow order, approval binding, and tool safety are code invariants and should fail tests rather than be treated as fuzzy model scores.

## Proposed decision

Add a small evaluation package and CLI command from the beginning rather than retrofitting it after the demo works.

### Case format

Benchmark cases are schema-validated fixtures. A case contains:

- case ID and scenario family
- effective user
- clock value
- input enterprise state or seed reference
- attention item
- expected recommendation class
- expected workflow or allowed tool set
- expected critical evidence IDs
- expected important parameters
- optional forbidden actions or suppliers

Start with a handful of cases derived from Scenario A, Scenario B, and meaningful negatives instead of generating a large synthetic suite.

Useful initial cases include:

- supplier delay should enter the PO-reroute workflow
- irrelevant supplier email should produce no action
- attractive but unapproved supplier must not be proposed as executable
- quality-held allocated lot with sufficient alternate lot should propose reallocation
- quality-held lot with no sufficient alternate should flag purchasing shortage

### Runner modes

Support two modes behind one benchmark service:

- `live`: call the configured OpenRouter model and record real latency, usage, cost, and output
- `replay`: score previously recorded planner outputs without spending tokens

The demo may run only a small live set. CI and tests should not require network access.

### Metrics

Record at least:

- schema-valid output
- recommendation class correctness
- workflow / tool selection correctness
- key parameter correctness
- required evidence coverage
- forbidden-action violations
- end-to-end planner latency
- input and output token counts when the provider exposes them
- estimated model cost
- model identifier
- prompt / planner version

Keep scoring intentionally transparent. Prefer discrete pass/fail checks and a simple aggregate score over an opaque judge model.

### Run artifact

Persist benchmark runs in SQLite and export a compact NDJSON or JSON summary under `artifacts/benchmarks/`.

Each run records enough identity to compare it later:

- benchmark suite version
- planner version
- model
- timestamp
- case results
- latency and usage
- aggregate pass rate

Do not make benchmark results part of the business audit ledger. They are evaluation artifacts, not enterprise actions.

### CLI

Expose a command along the lines of:

`bun run cli bench`

Useful options may include model override, case filter, live/replay mode, and repeat count, but the first implementation should stay small.

### What is deliberately not built

Do not build an LLM-as-judge pipeline, statistical significance framework, hosted dashboard, prompt optimizer, dataset management service, or broad adversarial eval suite within the challenge time box.

The value here is the seam: planner behavior is already represented as typed inputs and outputs that can be evaluated repeatedly.

## Consequences

Prompt and model changes become measurable instead of anecdotal.

The benchmark skeleton reinforces the architecture: the free-form planner is a replaceable component with a typed contract, while deterministic safety behavior remains covered by normal tests.

This ADR remains proposed until the exact initial case set and live-run repeat count are locked.