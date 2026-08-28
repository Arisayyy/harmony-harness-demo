import { OpenRouterClient } from "@effect/ai-openrouter"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { AppConfig } from "../../infra/config/app-config"

export const layer = Layer.unwrap(
  Effect.map(AppConfig, (config) =>
    OpenRouterClient.layer({
      apiKey: config.openRouterApiKey,
      siteTitle: "Harmony Harness Demo"
    }).pipe(Layer.provide(FetchHttpClient.layer))
  )
)
