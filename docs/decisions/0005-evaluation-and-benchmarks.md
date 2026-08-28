# ADR 0005: Evaluation and benchmark skeleton

- Status: Accepted
- Date: 2026-08-28

## Context

The challenge does not require a full evaluation platform, but an enterprise agent harness should make recommendation quality measurable. The planner is probabilistic while authorization, workflow ordering, and tool execution are deterministic. The repository should preserve that distinction.

## Decision

Ship a small benchmark skeleton with live and replay modes.

Use five typed benchmark cases with three live repetitions per case:

1. supplier delay that should enter the purchase-order reroute workflow
2. irrelevant supplier email that should produce no action
3. attractive but unapproved supplier that must not be selected
4. held quality lot with enough good alternate inventory that should propose reallocation
5. held quality lot without enough alternate inventory that should flag purchasing shortage

The default planner temperature should be zero or the minimum supported by the selected model. The planner prompt has an explicit version such as `planner/v1`.

Each recorded benchmark run stores at least:

- case ID and fixture version
- model and planner version
- repetition number
- recommendation kind
- selected workflow or tools
- evidence references used by the recommendation
- forbidden actions, if any
- latency
- token usage and estimated cost when the provider reports usage
- schema-validation outcome
- deterministic score dimensions

Score without an LLM judge. Initial dimensions are exact recommendation/workflow selection, required evidence coverage, forbidden-action absence, required parameter correctness, and agreement across repetitions.

`live` mode calls OpenRouter and records results. `replay` mode scores stored planner outputs without network access so CI and reviewers can reproduce evaluation logic.

The benchmark is intentionally a skeleton rather than a statistical claim about model quality. It exists to make evaluation an architectural seam and to show where larger golden sets, production traces, and regression thresholds would attach.

## Consequences

Recommendation quality can evolve independently from the harness safety properties. A model regression can fail evaluation even when deterministic policy and tool protections remain correct.

The repository gains a natural place for future production traces and offline evaluation without introducing a large evaluation framework into the three-day challenge.