import { describe, expect, test } from "bun:test"
import { ApprovalRecord } from "../src/harness/approvals/model/approval"
import { EnterWorkflow, ReroutePurchaseOrderParameters } from "../src/harness/agent/planning/recommendation"
import { renderApproval, renderBanner, renderDecision, renderDeclined, renderExecutionComplete, renderHome, type HomeEvent } from "../src/cli/ui/demo-ui"

const recommendation = new EnterWorkflow({
  _tag: "EnterWorkflow",
  workflow: "purchasing.reroute-po",
  rationale: "Supply risk requires a durable reroute before the production window closes.",
  confidence: 1,
  evidenceRefs: ["RT-4471", "PO-77812", "S-Z"],
  parameters: new ReroutePurchaseOrderParameters({
    partId: "RT-4471",
    originalPoId: "PO-77812",
    productionOrderId: "4812",
    alternateSupplierId: "S-Z",
    quantity: 400
  })
})

const approval = new ApprovalRecord({
  approvalId: "approval-12345678",
  runId: "run-1",
  effectiveUserId: "u-101",
  requestedApproverId: "u-101",
  assignedApproverId: "u-101",
  planHash: "1234567890abcdef",
  planJson: "{}",
  policyReason: "Agent-originated writes require human approval before execution.",
  status: "pending",
  createdAt: "2026-09-02T09:00:00-06:00"
})

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
const longestVisibleLine = (value: string) => Math.max(...stripAnsi(value).split("\n").map((line) => line.length))

const outputsAt = (columns: number) => [
  renderHome([
    { key: "1", title: "Supplier reroute", detail: "PO-77812 delay threatens production order 4812" },
    { key: "2", title: "Quality hold response", detail: "Held lot L-2093 is allocated to production order 4820" }
  ], new Set<HomeEvent>(["noise"]), "2026-09-02T09:00:00-06:00", columns),
  renderApproval({ title: "Supplier reroute", recommendation, approval }, columns),
  renderDecision("approved", "Supplier reroute", columns),
  renderExecutionComplete({ title: "Supplier reroute", kind: "workflow", outcome: { status: "completed", detail: "replacement purchase order committed without duplicate writes" } }, columns),
  renderDeclined({ title: "Supplier reroute", recommendation, reviewerId: "u-101" }, columns),
  renderBanner("interactive", columns)
]

describe("operator TUI layout", () => {
  for (const columns of [80, 60]) {
    test(`keeps every rendered line inside a ${columns}-column terminal`, () => {
      for (const output of outputsAt(columns)) {
        expect(longestVisibleLine(output)).toBeLessThan(columns)
      }
    })
  }

  test("uses a compact Harmony title when the terminal is too narrow for the ASCII wordmark", () => {
    const output = stripAnsi(renderHome([], new Set<HomeEvent>(), "2026-09-02T09:00:00-06:00", 60))
    expect(output).toContain("HARMONY")
    expect(output).not.toContain("██╗")
  })
})
