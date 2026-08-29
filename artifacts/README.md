# Recorded run artifacts

`bun run demo` writes `scenario-a.ndjson` here. That live/generated filename is ignored because every execution receives unique run and trace IDs.

`scenario-a.recorded.ndjson` is intentionally committed. It is an actual Scenario A audit exported by the green GitHub Actions end-to-end demo using `HARMONY_PLANNER=fixture`. The fixture planner is deterministic and replaces only the external LLM call; detection, permission-scoped providers, evidence capture, policy, approval, Effect Workflow execution, idempotent tools, persistence, and audit are the same production-path components used with OpenRouter.

The preserved recording shows the original `PO-77812` on `S-Y`, the proposed approved alternate `S-Z`, immutable policy/approval metadata, and successful `purchasing.reroute-po@1` execution.

CI also uploads the newly generated `scenario-a.ndjson` as the `scenario-a-audit` workflow artifact on every successful validation run, so reviewers can compare the committed recording with a fresh execution.

For a live OpenRouter trace, set `OPENROUTER_API_KEY` and run `bun run demo`; the same exporter writes the model-backed run in exactly the same NDJSON shape, with the configured model recorded in `planner.recommendation`.
