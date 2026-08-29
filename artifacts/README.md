# Generated run artifacts

`bun run demo` writes `scenario-a.ndjson` here. The file is ignored locally because live planner runs produce unique run/trace IDs.

CI runs the complete demo with the explicitly selected deterministic fixture planner (`HARMONY_PLANNER=fixture`) and uploads the generated `scenario-a.ndjson` as the `scenario-a-audit` workflow artifact. This gives reviewers an actual end-to-end recorded trace without requiring the repository to contain a fabricated static run or CI to hold an external model secret.

For a live OpenRouter trace, set `OPENROUTER_API_KEY` and run `bun run demo`; the same exporter writes the model-backed run in exactly the same NDJSON shape.
