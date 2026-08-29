import { Data, Effect } from "effect"
import type { Recommendation } from "../../harness/agent/planning/recommendation"
import type { ApprovalRecord } from "../../harness/approvals/model/approval"

export type DemoDecision = "approved" | "rejected" | "cancelled"
export type HomeEvent = "supplier" | "noise" | "quality" | "time" | "failure"
export type HomeAction = HomeEvent | "task-1" | "task-2" | "quit"
export interface HomeTask {
  readonly key: "1" | "2"
  readonly title: string
  readonly detail: string
}

export class InteractiveTerminalRequired extends Data.TaggedError("InteractiveTerminalRequired")<{
  readonly message: string
}> {}

const colorEnabled = process.stdout.isTTY && process.env.TERM !== "dumb" && process.env.NO_COLOR === undefined
const terminalCode = (value: string) => colorEnabled ? value : ""
const ansi = {
  reset: terminalCode("\u001b[0m"),
  bold: terminalCode("\u001b[1m"),
  dim: terminalCode("\u001b[2m"),
  gray: terminalCode("\u001b[90m"),
  white: terminalCode("\u001b[97m"),
  blue: terminalCode("\u001b[38;5;75m"),
  violet: terminalCode("\u001b[38;5;141m"),
  cyan: terminalCode("\u001b[36m"),
  green: terminalCode("\u001b[32m"),
  red: terminalCode("\u001b[31m"),
  yellow: terminalCode("\u001b[33m"),
  panel: terminalCode("\u001b[48;5;235m"),
  clear: terminalCode("\u001b[2J\u001b[H")
} as const

const maxWidth = 92
const layoutWidth = (columns: number | undefined = process.stdout.columns) => Math.max(1, Math.min(maxWidth, (columns ?? maxWidth + 1) - 1))
const lineFor = (width: number) => "─".repeat(width)
const truncate = (value: string, max: number) => {
  if (max <= 0) return ""
  if (value.length <= max) return value
  if (max === 1) return "…"
  return `${value.slice(0, max - 1)}…`
}
const pad = (value: string, size: number) => value.length >= size ? value : `${value}${" ".repeat(size - value.length)}`
const centerText = (value: string, width: number) => {
  const text = truncate(value, width)
  return `${" ".repeat(Math.max(0, Math.floor((width - text.length) / 2)))}${text}`
}
const panelRow = (value: string, width: number, tone: string = ansi.white) => `${ansi.panel}${tone}${pad(truncate(value, width), width)}${ansi.reset}`
const plainRow = (value: string, width: number, tone: string = ansi.white) => `${tone}${truncate(value, width)}${ansi.reset}`
const operatorHeader = (width: number) => {
  const left = "  harmony / operator session"
  const right = "trace live  ·  Effect 4  "
  const gap = width - left.length - right.length
  const value = gap >= 1 ? `${left}${" ".repeat(gap)}${right}` : left
  return panelRow(value, width, `${ansi.bold}${ansi.white}`)
}

const planLines = (recommendation: Recommendation): ReadonlyArray<string> => {
  switch (recommendation._tag) {
    case "EnterWorkflow":
      return [
        `Create replacement PO with approved supplier ${recommendation.parameters.alternateSupplierId}`,
        `Move ${recommendation.parameters.quantity} × ${recommendation.parameters.partId} off ${recommendation.parameters.originalPoId}`,
        "Cancel the original PO after replacement creation succeeds",
        `Notify production order ${recommendation.parameters.productionOrderId} and schedule arrival check`
      ]
    case "ProposedActions":
      return recommendation.actions.map((action, index) => {
        const prefix = String(index + 1).padStart(2, "0")
        switch (action._tag) {
          case "quality.reallocate-lot":
            return `${prefix} Move ${action.quantity} × ${action.partId}: lot ${action.fromLotId} → ${action.toLotId}`
          case "production.notify":
            return `${prefix} Notify production order ${action.productionOrderId} about the allocation change`
          case "purchasing.flag-shortage":
            return `${prefix} Flag ${action.quantity} × ${action.partId} shortage for order ${action.productionOrderId}`
        }
      })
    case "NoAction":
      return ["action     no write proposed"]
  }
}

const planIntent = (recommendation: Recommendation) => {
  switch (recommendation._tag) {
    case "EnterWorkflow":
      return `Prevent order ${recommendation.parameters.productionOrderId} delay: replace ${recommendation.parameters.originalPoId} supply with approved ${recommendation.parameters.alternateSupplierId}.`
    case "ProposedActions":
      return recommendation.rationale
    case "NoAction":
      return "Record the assessment without changing enterprise state."
  }
}

const planImpact = (recommendation: Recommendation) => recommendation._tag === "EnterWorkflow"
  ? "Impact: preserve start · Writes: replacement/cancel PO, notice, follow-up"
  : recommendation._tag === "ProposedActions"
    ? `Expected: remove held inventory from production · Writes: ${recommendation.actions.length} bounded actions`
    : "Expected: no operational change · Writes: none"

const harmonyAscii = [
  "██╗  ██╗ █████╗ ██████╗ ███╗   ███╗ ██████╗ ███╗   ██╗██╗   ██╗",
  "██║  ██║██╔══██╗██╔══██╗████╗ ████║██╔═══██╗████╗  ██║╚██╗ ██╔╝",
  "███████║███████║██████╔╝██╔████╔██║██║   ██║██╔██╗ ██║ ╚████╔╝ ",
  "██╔══██║██╔══██║██╔══██╗██║╚██╔╝██║██║   ██║██║╚██╗██║  ╚██╔╝  ",
  "██║  ██║██║  ██║██║  ██║██║ ╚═╝ ██║╚██████╔╝██║ ╚████║   ██║   ",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   "
] as const
const renderHarmony = (width: number) => width >= 70
  ? harmonyAscii.map((row) => centerText(row, width)).join("\n")
  : `${ansi.bold}${centerText("HARMONY", width)}${ansi.reset}`

const dayPart = (hour: number) => hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night"

export const renderHome = (tasks: ReadonlyArray<HomeTask>, completed: ReadonlySet<HomeEvent>, now: string, columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  const parsedHour = Number(now.slice(11, 13))
  const hour = Number.isFinite(parsedHour) ? parsedHour : 9
  const timeLabel = now.length >= 16 ? `${now.slice(0, 10)} ${now.slice(11, 16)}` : now
  const taskRows = tasks.length === 0
    ? `${ansi.green}${ansi.bold}${centerText("NO PENDING TASKS", width)}${ansi.reset}\n${ansi.gray}${centerText(`All quiet on the floor. Enjoy your ${dayPart(hour)}, partner.`, width)}${ansi.reset}`
    : `${ansi.yellow}${ansi.bold}${centerText(`${tasks.length} TASK${tasks.length === 1 ? "" : "S"} ON DECK`, width)}${ansi.reset}\n${tasks.map((task) => `${ansi.white}${centerText(`[${task.key}] ${task.title}  ${task.detail}`, width)}${ansi.reset}`).join("\n")}`
  const state = (event: HomeEvent, key: string, label: string) => `${completed.has(event) ? "✓" : " "} ${key} ${label}`
  const eventRows = [
    `EVENTS  ${state("supplier", "E", "supplier")}   ${state("noise", "N", "harmless")}   ${state("quality", "H", "quality")}`,
    `        ${state("time", "T", "+6 days")}   ${state("failure", "F", "crash/resume")}   Q quit`
  ].map((row) => panelRow(row, width, ansi.gray)).join("\n")

  return `${ansi.clear}\n\n${ansi.yellow}${ansi.bold}${renderHarmony(width)}${ansi.reset}

${ansi.gray}${centerText(`GDL PLANT  /  VIRTUAL TIME ${timeLabel}`, width)}${ansi.reset}
${ansi.gray}${line}${ansi.reset}

${taskRows}


${eventRows}
`
}

export const requestHomeAction = (tasks: ReadonlyArray<HomeTask>, completed: ReadonlySet<HomeEvent>, now: string): Effect.Effect<HomeAction, InteractiveTerminalRequired> => Effect.callback<HomeAction, InteractiveTerminalRequired>((resume) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    resume(Effect.fail(new InteractiveTerminalRequired({ message: "Interactive demo requires a TTY. Run `bun run demo:auto` for automation." })))
    return
  }
  process.stdout.write(renderHome(tasks, completed, now))
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  const cleanup = () => {
    process.stdin.off("data", onData)
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  const onData = (key: string) => {
    const action: HomeAction | undefined = key === "1" && tasks.some((task) => task.key === "1") ? "task-1"
      : key === "2" && tasks.some((task) => task.key === "2") ? "task-2"
      : key.toLowerCase() === "e" ? "supplier"
      : key.toLowerCase() === "n" ? "noise"
      : key.toLowerCase() === "h" ? "quality"
      : key.toLowerCase() === "t" ? "time"
      : key.toLowerCase() === "f" ? "failure"
      : key.toLowerCase() === "q" || key === "\u0003" ? "quit"
      : undefined
    if (action === undefined || (action !== "quit" && action !== "task-1" && action !== "task-2" && completed.has(action))) return
    cleanup()
    resume(Effect.succeed(action))
  }
  process.stdin.on("data", onData)
  return Effect.sync(cleanup)
})

export const waitForHome = Effect.callback<void, InteractiveTerminalRequired>((resume) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    resume(Effect.fail(new InteractiveTerminalRequired({ message: "Interactive demo requires a TTY. Run `bun run demo:auto` for automation." })))
    return
  }
  process.stdout.write(`${ansi.gray}\n  press any key to return to control terminal${ansi.reset}`)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  const cleanup = () => {
    process.stdin.off("data", onData)
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  const onData = () => {
    cleanup()
    resume(Effect.void)
  }
  process.stdin.on("data", onData)
  return Effect.sync(cleanup)
})

export const renderApproval = (options: {
  readonly title: string
  readonly recommendation: Recommendation
  readonly approval: ApprovalRecord
}, columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  const { approval, recommendation, title } = options
  const rows = planLines(recommendation).map((row) => panelRow(`  │  ${row}`, width)).join("\n")
  const activity = recommendation._tag === "EnterWorkflow"
    ? ["Read  purchasing context", "Read  supplier qualification", `Plan  ${recommendation.workflow}`]
    : ["Read  quality allocation", `Plan  ${recommendation._tag === "ProposedActions" ? `${recommendation.actions.length} bounded actions` : "no action"}`]
  const activityRows = activity.map((row) => plainRow(`  ✓ ${row}`, width, ansi.gray)).join("\n")
  return `${ansi.clear}${operatorHeader(width)}
${ansi.gray}${line}${ansi.reset}

${plainRow("  ▌ event   Inbound enterprise signal requires attention", width, ansi.blue)}
${plainRow("    Mail M-001 · PO-77812 slips beyond the production window", width, ansi.gray)}

${plainRow("  ◆  harmony", width, ansi.violet)}
${plainRow(`  ${recommendation.rationale}`, width)}

${activityRows}

${plainRow("  ◇  policy gate  Agent-originated writes require human approval", width, ansi.yellow)}

${panelRow(`  PERMISSION REQUIRED  durable approval · ${approval.approvalId.slice(0, 8)}`, width, `${ansi.yellow}${ansi.bold}`)}
${panelRow("", width)}
${panelRow(`  ${title}`, width, `${ansi.bold}${ansi.white}`)}
${panelRow(`  INTENT  ${planIntent(recommendation)}`, width)}
${panelRow("", width)}
${panelRow("  CHANGES TO AUTHORIZE", width, ansi.gray)}
${rows}
${panelRow("", width)}
${panelRow(`  ${planImpact(recommendation)}`, width, ansi.gray)}
${panelRow("  ✓ approved supplier  ✓ compensation  ✓ idempotency  ✓ scope recheck", width, ansi.green)}
${panelRow("", width)}
${panelRow(`  ${approval.policyReason}`, width, ansi.gray)}
${panelRow(`  plan ${approval.planHash.slice(0, 12)}  ·  reviewer ${approval.assignedApproverId}`, width, ansi.gray)}
${panelRow("", width)}
${panelRow("  [A] Approve   [D] Decline   [Q] dismiss", width, `${ansi.bold}${ansi.white}`)}

`
}

export const renderDecision = (decision: DemoDecision, title: string, columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  const approved = decision === "approved"
  const cancelled = decision === "cancelled"
  const color = approved ? ansi.green : cancelled ? ansi.yellow : ansi.red
  const symbol = approved ? "✓" : cancelled ? "·" : "×"
  const label = approved ? "Permission granted" : cancelled ? "Session dismissed" : "Permission declined"
  const detail = approved ? "Continuing through runtime scope checks and durable execution…" : cancelled ? "The approval remains pending. No proposed writes were executed." : "No proposed writes were executed. Decision recorded in the audit trail."
  return `${ansi.clear}${operatorHeader(width)}
${ansi.gray}${line}${ansi.reset}

${plainRow(`  ${symbol}  ${label}`, width, `${color}${ansi.bold}`)}

${plainRow(`  ${title}`, width, ansi.bold)}
${plainRow(`  ${detail}`, width, ansi.gray)}

${plainRow(`  ${cancelled ? "approval.status " : "approval.decided"}  ${cancelled ? "pending" : decision}`, width, color)}
${plainRow(`  durability        ${cancelled ? "approval remains pending" : "persisted"}`, width, ansi.gray)}
${plainRow(`  next              ${approved ? "execute approved plan" : cancelled ? "return to task inbox" : "return to attention loop"}`, width, ansi.gray)}

${ansi.gray}${line}${ansi.reset}
`
}

export const renderExecutionComplete = (options: {
  readonly title: string
  readonly kind: "workflow" | "actions"
  readonly outcome: unknown
}, columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  return `${ansi.clear}${operatorHeader(width)}
${ansi.gray}${line}${ansi.reset}

${plainRow("  ✓  Durable execution completed", width, `${ansi.green}${ansi.bold}`)}
${plainRow(`  ${options.title} · approved decision persisted`, width, ansi.gray)}

${panelRow(`  EXECUTION  ${options.kind === "workflow" ? "purchasing.reroute-po@1" : "bounded action set"}`, width, ansi.gray)}
${panelRow("", width)}
${panelRow("  ✓  approval revalidated", width, ansi.green)}
${panelRow("  ✓  runtime scopes checked", width, ansi.green)}
${panelRow("  ✓  idempotent writes committed", width, ansi.green)}
${panelRow("  ✓  audit trail persisted", width, ansi.green)}
${panelRow("", width)}
${panelRow(`  result  ${JSON.stringify(options.outcome)}`, width)}

${plainRow("  ◆  harmony", width, ansi.violet)}
${plainRow("  Execution is complete. The decision and side-effect trail are available in the audit log.", width)}

${ansi.gray}${line}${ansi.reset}
`
}

export const renderDeclined = (options: {
  readonly title: string
  readonly recommendation: Recommendation
  readonly reviewerId: string
}, columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  const rows = planLines(options.recommendation).map((row) => panelRow(`  │  ${row}`, width)).join("\n")
  return `${ansi.clear}${operatorHeader(width)}
${ansi.gray}${line}${ansi.reset}

${plainRow("  ×  Permission declined", width, `${ansi.red}${ansi.bold}`)}
${plainRow(`  ${options.title} · rejected by ${options.reviewerId} · decision persisted`, width, ansi.gray)}

${panelRow("  PROPOSED PLAN  ·  NOT EXECUTED", width, ansi.gray)}
${panelRow("", width)}
${rows}
${panelRow("", width)}
${panelRow("  0 writes executed", width, `${ansi.red}${ansi.bold}`)}
${panelRow("  ToolRuntime was never entered · enterprise state unchanged", width, ansi.gray)}

${plainRow("  ◆  harmony", width, ansi.violet)}
${plainRow("  I recorded the decline and left enterprise state unchanged.", width)}

${ansi.gray}${line}${ansi.reset}
`
}

export const requestApproval = (options: {
  readonly title: string
  readonly recommendation: Recommendation
  readonly approval: ApprovalRecord
}): Effect.Effect<DemoDecision, InteractiveTerminalRequired> => Effect.callback<DemoDecision, InteractiveTerminalRequired>((resume) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    resume(Effect.fail(new InteractiveTerminalRequired({ message: "Interactive demo requires a TTY. Run `bun run demo:auto` for automation." })))
    return
  }

  process.stdout.write(renderApproval(options))
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")

  const cleanup = () => {
    process.stdin.off("data", onData)
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  const onData = (key: string) => {
    const normalized = key.toLowerCase()
    if (normalized === "a" || normalized === "y" || key === "\r") {
      cleanup()
      process.stdout.write(renderDecision("approved", options.title))
      resume(Effect.succeed("approved"))
    } else if (normalized === "d" || normalized === "n") {
      cleanup()
      process.stdout.write(renderDecision("rejected", options.title))
      resume(Effect.succeed("rejected"))
    } else if (normalized === "q" || key === "\u0003") {
      cleanup()
      process.stdout.write(renderDecision("cancelled", options.title))
      resume(Effect.succeed("cancelled"))
    }
  }
  process.stdin.on("data", onData)

  return Effect.sync(cleanup)
})

export const renderBanner = (mode: "interactive" | "auto", columns?: number) => {
  const width = layoutWidth(columns)
  const line = lineFor(width)
  return `${ansi.bold}${ansi.cyan}HARMONY${ansi.reset} ${ansi.dim}operator harness${ansi.reset}
${line}
${truncate("workspace            RealTruck · Guadalajara", width)}
${truncate("runtime              Effect 4 · Bun · SQLite", width)}
${truncate(`mode                 ${mode === "auto" ? "deterministic auto" : "interactive approvals"}`, width)}
${line}`
}
