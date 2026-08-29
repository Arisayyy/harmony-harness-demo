import { Effect, Schema } from "effect"
import type { Principal } from "../../authorization/permissions/principal"

export type ToolSchema = Schema.Codec<any, any, never, never>

export type ToolDefinition = {
  readonly name: string
  readonly input: ToolSchema
  readonly output: ToolSchema
  readonly requiredScopes: ReadonlyArray<string>
  readonly execute: (principal: Principal, input: any) => Effect.Effect<any, unknown>
}

export const defineTool = (definition: ToolDefinition): ToolDefinition => definition
