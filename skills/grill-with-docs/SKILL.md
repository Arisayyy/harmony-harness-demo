---
name: grill-with-docs
description: Relentlessly clarify a change against the codebase, then preserve the decisions in project documentation.
---

# Grill With Docs

Use this skill before substantial implementation, architecture changes, or ambiguous product work.

## Goal

Turn a loose idea into a defendable implementation direction by resolving the decision tree before writing production code. This is the stateful counterpart to Matt Pocock’s grill-me approach: inspect the repository when code can answer a question, and preserve settled decisions for the next session.

## Process

1. Start with the user outcome, constraints, and definition of success.
2. Explore the codebase before asking anything the repository can answer.
3. Ask questions in dependency order. Ask one question at a time unless a small round of independent questions is clearer.
4. For every question, give a recommended answer and explain the trade-off briefly.
5. Mark unknowns honestly. If an answer needs a prototype, say so instead of inventing certainty.
6. Stop when the decision frontier is empty: no important behavior, ownership, data flow, failure mode, or rollout assumption remains implicit.

## Documentation outputs

- Update CONTEXT.md with the current problem, agreed constraints, open questions, and implementation boundary.
- Add an ADR in docs/adr/ for each consequential architectural choice. Include status, context, decision, alternatives, and consequences.
- Update docs/ARCHITECTURE.md when boundaries, responsibilities, or request flows change.

## Guardrails

- Do not mistake a long interview for progress. The target is clear decisions.
- Do not rush into a plan because the conversation has enough words.
- Do not use grilling to settle questions that require a prototype or measurement.
- Keep questions tied to a real decision and the smallest useful scope.

## Completion

Finish with a concise decision record, the files that must change, the risks to test, and any remaining experiment or rollout gate.