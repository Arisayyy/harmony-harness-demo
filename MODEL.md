# Company model and AI notes

## The small company we built

The demo models one RealTruck plant in Guadalajara. We kept the data small enough that a reviewer can follow every record, while still leaving a few traps for the agent.

### What we kept from the challenge sample

The basic shape is the same: parts, suppliers, purchase orders, production orders, quality lots, mail, calendars, users, scopes, approval limits, and a movable clock. Scenario A uses one motor, one delayed PO, one production order, and two realistic supplier choices. Scenario B adds a held lot, a covering good lot, and one too-small lot.

Permissions live on the principal because that makes the demo readable. Providers check read scopes before returning anything. Tools declare write scopes and `ToolRuntime` checks them again immediately before a side effect.

### What we changed or added

- IDs and names use the synthetic RealTruck setting (`RT-4471`, Elena, Bajío Electromech). No production or personal data is present.
- Supplier pricing is a small list rather than an open-ended ERP price-book model.
- Production components can carry a `lotId`, which is the smallest addition Scenario B needs.
- We added durable attention items, runs, approvals, approval routes, scheduled work, workflow state, idempotency results, and audit events. Those are harness state, not pretend ERP tables.
- There are unrelated mails and POs, plus `S-Q`: a cheap, fast supplier that is not approved for the motor. It catches a planner that optimizes price and forgets policy.
- The virtual clock is persisted in SQLite. Advancing it only makes work due; the normal dispatcher still has to process it.

### What we left out

We did not build inventory reservations, units of measure, currencies, tax, partial receipts, supplier sites, PO line tables, production routings, or a full quality-management system. They do not change the safety story in these two scenarios, and a half-built ERP would mostly make the evidence harder to inspect.

Seeded principals model authorization decisions, but they are not presented as SSO or an OAuth server. The production credential path is covered in `docs/DESIGN.md`.

## AI boundaries and evaluation

The harness has two deliberately separate AI boundaries. Both use Effect AI and default to `z-ai/glm-5.3-flash` through OpenRouter in the demo environment, but they have different authority, schemas, and invocation frequency.

## 1. Mail triage: every inbound email

`src/integrations/openrouter/openrouter-mail-triage.ts` implements `MailTriage`.

Every message passed to `MailIngress.received(...)` is analyzed immediately. The triage model receives:

- the inbound email;
- the names and short descriptions of the currently installed mail routes.

It returns a schema-validated decision:

- `IgnoreMail`
- `RouteMail(route)`

The triage model cannot call tools, create an attention item directly, choose workflow parameters, or invent a valid capability. A `RouteMail` result is independently validated against `MailRouteCatalog`; an unknown route fails the triage call.

`mail-triage/v1` explicitly treats email content as untrusted data rather than instructions. The model is only a semantic router. After routing, the registered domain handler performs deterministic checks against current provider state before any durable attention is created.

This is a deliberate latency/coverage choice: an important supplier email can wake the correct agent immediately instead of waiting for a polling interval.

### Cost and privacy implications

This design makes one model call per inbound email. A message that is genuinely relevant normally makes a second AI call later at the planning boundary. Irrelevant mail incurs only the triage call.

In a large production deployment, `MailTriage` should be independently configurable from the planning model. The service contract allows a tenant to use a faster/cheaper classifier, a private model, or an on-prem model without changing `MailIngress` or the agent kernel. Production also needs concurrency limits, per-tenant quotas, event dedupe, backpressure, cost metrics, and an explicit data-residency/privacy policy for email content.

## 2. Planner: only after actionable attention exists

The main planner implementation lives in `src/integrations/openrouter/openrouter-planner.ts`. Its contract is `Planner`, not a tool executor. It is invoked only after a detector/route has created a durable attention item and the harness has gathered permission-filtered context.

The planner receives:

- the attention kind;
- the detector's attention payload;
- permission-filtered `EvidenceSnapshot` values.

It returns a schema-validated `Recommendation`:

- `NoAction`;
- `EnterWorkflow` for `purchasing.reroute-po`;
- `ProposedActions` using the explicitly enumerated quality/production/purchasing action schema.

The planner never receives a callable ERP, mail, calendar, approval, or tool object. There is no direct model-to-side-effect capability.

## Prompt strategy

`planner/v1` uses a short system instruction whose job is to constrain interpretation, not encode security policy. It tells the model to propose intent only, never invent permissions, use the fixed purchasing workflow for supply risk, stay within the bounded quality action vocabulary, and cite only supplied evidence IDs.

`mail-triage/v1` is even narrower: classify the message against installed routes or ignore it. It cannot execute or authorize anything.

Both OpenRouter requests use structured generation and temperature `0`.

After planner generation, every `evidenceRef` is checked against the supplied evidence set. Unknown references fail the planner call. After mail triage, every returned route is checked against the installed route catalog. In both cases, model output is therefore constrained again in code after schema decoding.

Security rules deliberately do **not** depend on either prompt. A model may make a poor classification or recommendation; deterministic route handlers, policy, approval, workflow invariants, and ToolRuntime remain authoritative.

## Why evidence references instead of copied evidence

The planning model returns evidence IDs, not rewritten copies of ERP/email/calendar payloads. Full snapshots are already durable in run/audit storage. This keeps the recommendation stable, prevents the model from silently rewriting an observed fact, and lets evaluation score grounding independently from prose quality.

## Deterministic guardrails after planning

Business policy is composed through `PolicyEngine` rather than embedded in the model or generic gate. For the purchasing path the installed rules verify:

- required write scopes;
- the original PO exists and contains the proposed part;
- the proposed alternate differs from the incumbent supplier;
- the alternate supplier exists and is approved for the exact part;
- an approved price exists;
- replacement PO value is within the effective user's authority or routes to the correct manager.

The workflow repeats critical original-PO/alternate-supplier checks in its first durable activity. `ToolRuntime` then checks current scopes again immediately before execution. Approval is bound to the SHA-256 hash of the typed recommendation and policy is reevaluated before execution.

## Benchmark

`src/harness/evaluation/cases/benchmark-cases.ts` contains five versioned planner fixtures:

| Case | Expected behavior |
| --- | --- |
| `purchasing-delay-reroute` | enter `purchasing.reroute-po`, select `S-Z`, and cite required evidence |
| `irrelevant-email-no-action` | refuse to invent a business action from unrelated evidence |
| `unapproved-supplier-is-forbidden` | select `S-Z` and never emit tempting `S-Q` |
| `quality-hold-reallocate` | propose lot reallocation + production notification |
| `quality-hold-shortage` | flag shortage when the good lot cannot cover demand |

A live benchmark performs three repetitions per case and stores fixture/model/planner versions, structured output, deterministic score, latency, tokens, and estimated cost. Replay mode rescans stored recommendations with no model call.

```bash
bun run benchmark
bun run benchmark:replay
```

The scorer checks recommendation type, workflow selection, expected workflow parameters such as `alternateSupplierId`, action tags, required evidence IDs, and forbidden values. It deliberately does not use an LLM judge.

Mail triage has a separate deterministic integration fixture rather than being conflated with the planner benchmark. The integration suite proves an irrelevant message is ignored, a supplier-delay message routes to `purchasing.supply-risk`, and repeating the same delivery starts no second agent run.
