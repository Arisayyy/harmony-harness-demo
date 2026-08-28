import { Effect, Schema } from "effect"
import type { Principal } from "../../authorization/permissions/principal"

export type ToolDefinition = {
  readonly name: string
  readonly input: Schema.Top
  readonly output: Schema.Top
  readonly requiredScopes: ReadonlyArray<string>
  readonly execute: (principal: Principal, input: any) => Effect.Effect<any, unknown>
}

export const defineTool = (definition: ToolDefinition): ToolDefinition => definition
