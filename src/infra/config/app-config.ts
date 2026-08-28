import { Config, Context, Effect, Layer, Redacted } from "effect"

export class AppConfig extends Context.Service<AppConfig, {
  readonly databasePath: string
  readonly openRouterApiKey: Redacted.Redacted<string>
  readonly openRouterModel: string
}>()("harmony/infra/AppConfig") {}

export const layer = Layer.effect(
  AppConfig,
  Effect.all({
    databasePath: Config.string("DATABASE_PATH").pipe(Config.withDefault(".data/harmony.db")),
    openRouterApiKey: Config.redacted("OPENROUTER_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
    openRouterModel: Config.string("OPENROUTER_MODEL").pipe(Config.withDefault("z-ai/glm-5.3-flash"))
  })
)
