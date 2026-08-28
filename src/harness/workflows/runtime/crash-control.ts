import { Context, Effect, Layer } from "effect"

export class CrashControl extends Context.Service<CrashControl, {
  readonly afterActivity: (name: string) => Effect.Effect<void>
}>()("harmony/workflows/CrashControl") {}

export const layerNoop = Layer.succeed(CrashControl, CrashControl.of({ afterActivity: () => Effect.void }))

export const layerProcessKill = (activityName: string) => Layer.succeed(
  CrashControl,
  CrashControl.of({
    afterActivity: (name) => name === activityName
      ? Effect.sync(() => process.kill(process.pid, "SIGKILL"))
      : Effect.void
  })
)
