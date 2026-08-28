import { Context, Data, Effect, Layer } from "effect"
import type { ToolDefinition } from "./tool"

export class ToolNotFound extends Data.TaggedError("ToolNotFound")<{ readonly name: string }> {}

export class ToolCatalog extends Context.Service<ToolCatalog, {
  readonly get: (name: string) => Effect.Effect<ToolDefinition, ToolNotFound>
  readonly list: Effect.Effect<ReadonlyArray<ToolDefinition>>
}>()("harmony/tools/ToolCatalog") {}

export const layer = (tools: ReadonlyArray<ToolDefinition>) => Layer.succeed(
  ToolCatalog,
  ToolCatalog.of({
    get: (name) => {
      const tool = tools.find((candidate) => candidate.name === name)
      return tool === undefined ? Effect.fail(new ToolNotFound({ name })) : Effect.succeed(tool)
    },
    list: Effect.succeed(tools)
  })
)
