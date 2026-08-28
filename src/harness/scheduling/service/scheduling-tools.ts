import { Effect, Schema } from "effect"
import { defineTool } from "../../tools/catalog/tool"
import { ScheduledWorkService } from "./scheduled-work"

export class ScheduleArrivalCheckInput extends Schema.Class<ScheduleArrivalCheckInput>("ScheduleArrivalCheckInput")({
  workId: Schema.String,
  runAt: Schema.String,
  poId: Schema.String,
  partId: Schema.String,
  productionOrderId: Schema.String,
  principalId: Schema.String
}) {}

export class ScheduleArrivalCheckOutput extends Schema.Class<ScheduleArrivalCheckOutput>("ScheduleArrivalCheckOutput")({
  workId: Schema.String
}) {}

export class CancelScheduledWorkInput extends Schema.Class<CancelScheduledWorkInput>("CancelScheduledWorkInput")({
  workId: Schema.String
}) {}

export const makeSchedulingTools = Effect.gen(function*() {
  const scheduled = yield* ScheduledWorkService

  return [
    defineTool({
      name: "schedule.arrival-check",
      input: ScheduleArrivalCheckInput,
      output: ScheduleArrivalCheckOutput,
      requiredScopes: [],
      execute: Effect.fn("tool.schedule.arrival-check")(function*(_principal, input: ScheduleArrivalCheckInput) {
        yield* scheduled.schedule({
          workId: input.workId,
          runAt: input.runAt,
          kind: "purchase-order.arrival-check",
          payload: { poId: input.poId, partId: input.partId, productionOrderId: input.productionOrderId, principalId: input.principalId },
          dedupeKey: `arrival:${input.poId}`
        })
        return new ScheduleArrivalCheckOutput({ workId: input.workId })
      })
    }),
    defineTool({
      name: "schedule.cancel",
      input: CancelScheduledWorkInput,
      output: Schema.Void,
      requiredScopes: [],
      execute: (_principal, input: CancelScheduledWorkInput) => scheduled.cancel(input.workId)
    })
  ] as const
})
