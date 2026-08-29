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

const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  gray: "\u001b[90m",
  white: "\u001b[97m",
  blue: "\u001b[38;5;75m",
  violet: "\u001b[38;5;141m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  panel: "\u001b[48;5;235m",
  approve: "\u001b[48;5;29m",
  decline: "\u001b[48;5;88m",
  clear: "\u001b[2J\u001b[H"
} as const

const width = 92
const line = "─".repeat(width)
const truncate = (value: string, max = width - 8) => value.length <= max ? value : `${value.slice(0, max - 1)}…`
const pad = (value: string, size: number) => value.length >= size ? value : `${value}${" ".repeat(size - value.length)}`
const centerText = (value: string) => `${" ".repeat(Math.max(0, Math.floor((width - value.length) / 2)))}${value}`

const planLines = (recommendation: Recommendation): ReadonlyArray<string> => {
  switch (recommendation._tag) {
    case "EnterWorkflow":
      return [
        `Create replacement PO with approved supplier ${recommendation.parameters.alternateSupplierId}`,
        `Move ${recommendation.parameters.quantity} × ${recommendation.parameters.partId} off ${recommendation.parameters.originalPoId}`,
        `Cancel the original PO after replacement creation succeeds`,
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
].join("\n")
const centeredHarmonyAscii = harmonyAscii.split("\n").map(centerText).join("\n")

const dayPart = (hour: number) => hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night"

export const renderHome = (tasks: ReadonlyArray<HomeTask>, completed: ReadonlySet<HomeEvent>, now: string) => {
  const parsedHour = Number(now.slice(11, 13))
  const hour = Number.isFinite(parsedHour) ? parsedHour : 9
  const timeLabel = now.length >= 16 ? `${now.slice(0, 10)} ${now.slice(11, 16)}` : now
  const taskRows = tasks.length === 0
    ? `${ansi.green}${ansi.bold}${centerText("NO PENDING TASKS")}${ansi.reset}\n${ansi.gray}${centerText(`All quiet on the floor. Enjoy your ${dayPart(hour)}, partner.`)}${ansi.reset}`
    : `${ansi.yellow}${ansi.bold}${centerText(`${tasks.length} TASK${tasks.length === 1 ? "" : "S"} ON DECK`)}${ansi.reset}\n${tasks.map((task) => {
      const row = `[${task.key}] ${task.title}  ${task.detail}`
      return `${" ".repeat(Math.max(0, Math.floor((width - row.length) / 2)))}${ansi.white}[${task.key}] ${task.title}${ansi.reset}  ${ansi.gray}${task.detail}${ansi.reset}`
    }).join("\n")}`
  const eventState = (event: HomeEvent) => completed.has(event) ? `${ansi.green}✓${ansi.reset}` : " "
  return `${ansi.clear}\n\n${ansi.yellow}${ansi.bold}${centeredHarmonyAscii}${ansi.reset}

${" ".repeat(25)}${ansi.gray}GDL PLANT  /  VIRTUAL TIME ${timeLabel}${ansi.reset}
${ansi.gray}${line}${ansi.reset}

${taskRows}


${ansi.panel}${ansi.gray}  EVENTS${ansi.reset}${ansi.panel}  ${eventState("supplier")} ${ansi.white}${ansi.bold}E${ansi.reset}${ansi.panel} supplier   ${eventState("noise")} ${ansi.white}${ansi.bold}N${ansi.reset}${ansi.panel} harmless   ${eventState("quality")} ${ansi.white}${ansi.bold}H${ansi.reset}${ansi.panel} quality   ${eventState("time")} ${ansi.white}${ansi.bold}T${ansi.reset}${ansi.panel} +6 days   ${eventState("failure")} ${ansi.white}${ansi.bold}F${ansi.reset}${ansi.panel} crash / resume   ${ansi.gray}Q${ansi.reset}${ansi.panel} call it a day  ${ansi.reset}
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
}) => {
  const { approval, recommendation, title } = options
  const rows = planLines(recommendation).map((row) => `${ansi.panel}  ${ansi.gray}│${ansi.reset}${ansi.panel}${ansi.white}  ${pad(row, 74)}${ansi.reset}`).join("\n")
  const activity = recommendation._tag === "EnterWorkflow"
    ? [`Read  purchasing context`, `Read  supplier qualification`, `Plan  ${recommendation.workflow}`]
    : [`Read  quality allocation`, `Plan  ${recommendation._tag === "ProposedActions" ? `${recommendation.actions.length} bounded actions` : "no action"}`]
  const activityRows = activity.map((row) => `  ${ansi.green}✓${ansi.reset} ${ansi.gray}${row}${ansi.reset}`).join("\n")
  return `${ansi.clear}${ansi.panel}${ansi.bold}${ansi.white}  harmony / operator session${ansi.reset}${ansi.panel}${ansi.gray}${pad("", 38)}trace live  ·  Effect 4  ${ansi.reset}
${ansi.gray}${line}${ansi.reset}

  ${ansi.blue}▌${ansi.reset} ${ansi.gray}event${ansi.reset}   ${ansi.bold}Inbound enterprise signal requires attention${ansi.reset}
    ${ansi.gray}Mail M-001 · PO-77812 slips beyond the production window${ansi.reset}

  ${ansi.violet}◆  harmony${ansi.reset}
  ${truncate(recommendation.rationale)}

${activityRows}

  ${ansi.yellow}◇  policy gate${ansi.reset}  ${ansi.gray}Agent-originated writes require human approval${ansi.reset}

${ansi.panel}  ${ansi.yellow}${ansi.bold}PERMISSION REQUIRED${ansi.reset}${ansi.panel}  ${ansi.gray}durable approval · ${approval.approvalId.slice(0, 8)}${ansi.reset}
${ansi.panel}                                                                                ${ansi.reset}
${ansi.panel}  ${ansi.bold}${ansi.white}${title}${ansi.reset}${ansi.panel}                                                                  ${ansi.reset}
${ansi.panel}  ${ansi.gray}INTENT${ansi.reset}${ansi.panel}  ${ansi.white}${truncate(planIntent(recommendation), 72)}${ansi.reset}${ansi.panel}  ${ansi.reset}
${ansi.panel}                                                                                ${ansi.reset}
${ansi.panel}  ${ansi.gray}CHANGES TO AUTHORIZE${ansi.reset}${ansi.panel}                                                            ${ansi.reset}
${rows}
${ansi.panel}                                                                                ${ansi.reset}
${ansi.panel}  ${ansi.gray}${truncate(planImpact(recommendation), 78)}${ansi.reset}${ansi.panel}  ${ansi.reset}
${ansi.panel}  ${ansi.green}✓ approved supplier  ✓ compensation  ✓ idempotency  ✓ scope recheck${ansi.reset}${ansi.panel}       ${ansi.reset}
${ansi.panel}                                                                                ${ansi.reset}
${ansi.panel}  ${ansi.gray}${truncate(approval.policyReason, 78)}${ansi.reset}${ansi.panel}${" ".repeat(3)}${ansi.reset}
${ansi.panel}  ${ansi.gray}plan ${approval.planHash.slice(0, 12)}  ·  reviewer ${approval.assignedApproverId}${ansi.reset}${ansi.panel}${" ".repeat(38)}${ansi.reset}
${ansi.panel}                                                                                ${ansi.reset}
${ansi.panel}  ${ansi.approve}${ansi.bold}${ansi.white}  A  Approve  ${ansi.reset}${ansi.panel}   ${ansi.decline}${ansi.bold}${ansi.white}  D  Decline  ${ansi.reset}${ansi.panel}   ${ansi.gray}Q  dismiss${ansi.reset}${ansi.panel}${" ".repeat(24)}${ansi.reset}

`
}

export const renderDecision = (decision: DemoDecision, title: string) => {
  const approved = decision === "approved"
  const cancelled = decision === "cancelled"
  const color = approved ? ansi.green : cancelled ? ansi.yellow : ansi.red
  const symbol = approved ? "✓" : cancelled ? "·" : "×"
  const label = approved ? "Permission granted" : cancelled ? "Session dismissed" : "Permission declined"
  const detail = approved ? "Continuing through runtime scope checks and durable execution…" : cancelled ? "The approval remains pending. No proposed writes were executed." : "No proposed writes were executed. Decision recorded in the audit trail."
  return `${ansi.clear}${ansi.panel}${ansi.bold}${ansi.white}  harmony / operator session${ansi.reset}${ansi.panel}${ansi.gray}${pad("", 38)}trace live  ·  Effect 4  ${ansi.reset}
${ansi.gray}${line}${ansi.reset}

  ${color}${ansi.bold}${symbol}  ${label}${ansi.reset}

  ${ansi.bold}${title}${ansi.reset}
  ${ansi.gray}${detail}${ansi.reset}

  ${ansi.gray}${cancelled ? "approval.status " : "approval.decided"}${ansi.reset}  ${color}${cancelled ? "pending" : decision}${ansi.reset}
  ${ansi.gray}durability${ansi.reset}        ${cancelled ? "approval remains pending" : "persisted"}
  ${ansi.gray}next${ansi.reset}              ${approved ? "execute approved plan" : cancelled ? "return to task inbox" : "return to attention loop"}

${ansi.gray}${line}${ansi.reset}
`
}

export const renderExecutionComplete = (options: {
  readonly title: string
  readonly kind: "workflow" | "actions"
  readonly outcome: unknown
}) => `${ansi.clear}${ansi.panel}${ansi.bold}${ansi.white}  harmony / operator session${ansi.reset}${ansi.panel}${ansi.gray}${pad("", 38)}trace live  ·  Effect 4  ${ansi.reset}
${ansi.gray}${line}${ansi.reset}

  ${ansi.green}${ansi.bold}✓  Durable execution completed${ansi.reset}
  ${ansi.gray}${options.title} · approved decision persisted${ansi.reset}

  ${ansi.panel}  ${ansi.gray}EXECUTION${ansi.reset}${ansi.panel}  ${ansi.white}${options.kind === "workflow" ? "purchasing.reroute-po@1" : "bounded action set"}${ansi.reset}${ansi.panel}${" ".repeat(34)}${ansi.reset}
  ${ansi.panel}                                                                                ${ansi.reset}
  ${ansi.panel}  ${ansi.green}✓${ansi.reset}${ansi.panel}  approval revalidated                                                    ${ansi.reset}
  ${ansi.panel}  ${ansi.green}✓${ansi.reset}${ansi.panel}  runtime scopes checked                                                  ${ansi.reset}
  ${ansi.panel}  ${ansi.green}✓${ansi.reset}${ansi.panel}  idempotent writes committed                                             ${ansi.reset}
  ${ansi.panel}  ${ansi.green}✓${ansi.reset}${ansi.panel}  audit trail persisted                                                   ${ansi.reset}
  ${ansi.panel}                                                                                ${ansi.reset}
  ${ansi.panel}  ${ansi.gray}result${ansi.reset}${ansi.panel}  ${ansi.white}${truncate(JSON.stringify(options.outcome), 70)}${ansi.reset}${ansi.panel}  ${ansi.reset}

  ${ansi.violet}◆  harmony${ansi.reset}
  Execution is complete. The decision and side-effect trail are available in the audit log.

${ansi.gray}${line}${ansi.reset}
`

export const renderDeclined = (options: {
  readonly title: string
  readonly recommendation: Recommendation
  readonly reviewerId: string
}) => `${ansi.clear}${ansi.panel}${ansi.bold}${ansi.white}  harmony / operator session${ansi.reset}${ansi.panel}${ansi.gray}${pad("", 38)}trace live  ·  Effect 4  ${ansi.reset}
${ansi.gray}${line}${ansi.reset}

  ${ansi.red}${ansi.bold}×  Permission declined${ansi.reset}
  ${ansi.gray}${options.title} · rejected by ${options.reviewerId} · decision persisted${ansi.reset}

  ${ansi.panel}  ${ansi.gray}PROPOSED PLAN  ·  NOT EXECUTED${ansi.reset}${ansi.panel}${" ".repeat(48)}${ansi.reset}
  ${ansi.panel}                                                                                ${ansi.reset}
${planLines(options.recommendation).map((row) => `  ${ansi.panel}  ${ansi.gray}│${ansi.reset}${ansi.panel}${ansi.white}  ${pad(row, 72)}${ansi.reset}`).join("\n")}
  ${ansi.panel}                                                                                ${ansi.reset}
  ${ansi.panel}  ${ansi.red}${ansi.bold}0 writes executed${ansi.reset}${ansi.panel}${" ".repeat(59)}${ansi.reset}
  ${ansi.panel}  ${ansi.gray}ToolRuntime was never entered · enterprise state unchanged${ansi.reset}${ansi.panel}${" ".repeat(18)}${ansi.reset}

  ${ansi.violet}◆  harmony${ansi.reset}
  I recorded the decline and left enterprise state unchanged.

${ansi.gray}${line}${ansi.reset}
`

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

export const renderBanner = (mode: "interactive" | "auto") => `${ansi.bold}${ansi.cyan}HARMONY${ansi.reset} ${ansi.dim}operator harness${ansi.reset}
${line}
workspace            RealTruck · Guadalajara
runtime              Effect 4 · Bun · SQLite
mode                 ${mode === "auto" ? "deterministic auto" : "interactive approvals"}
${line}`
